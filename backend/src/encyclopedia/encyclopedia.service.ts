import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EncyclopediaTerm } from './encyclopedia.entity';

@Injectable()
export class EncyclopediaService {
  constructor(
    @InjectRepository(EncyclopediaTerm)
    private readonly repo: Repository<EncyclopediaTerm>,
  ) {}

  // locale==='en' 이면 영어 필드를 definition/example/body/advanced 자리에 얹어 반환.
  // 영어가 비어 있으면 한국어로 폴백. 프론트는 기존 키만 읽으면 됨.
  private localize(t: EncyclopediaTerm, locale?: string) {
    if (locale !== 'en') return t;
    const nonEmpty = (v: any) =>
      v !== undefined &&
      v !== null &&
      !(typeof v === 'string' && v.trim() === '') &&
      !(Array.isArray(v) && v.length === 0);
    return {
      ...t,
      definition: nonEmpty(t.definitionEn) ? t.definitionEn : t.definition,
      example: nonEmpty(t.exampleEn) ? t.exampleEn : t.example,
      body: nonEmpty(t.bodyEn) ? t.bodyEn : t.body,
      advanced: nonEmpty(t.advancedEn) ? t.advancedEn : t.advanced,
    };
  }

  async findAll(category?: string, q?: string, locale?: string) {
    const qb = this.repo.createQueryBuilder('t').where('t.published = true');
    if (category) qb.andWhere('t.category = :category', { category });
    if (q) {
      qb.andWhere(
        '(t.termKo ILIKE :q OR t.termEn ILIKE :q OR t.definition ILIKE :q)',
        { q: `%${q}%` },
      );
    }
    qb.orderBy('t.termKo', 'ASC');
    const rows = await qb.getMany();
    return rows.map((t) => this.localize(t, locale));
  }

  async findOne(id: string, locale?: string) {
    const term = await this.repo.findOne({ where: { id } });
    if (!term) return null;
    const related =
      term.seeAlso && term.seeAlso.length
        ? await this.repo.find({ where: { id: In(term.seeAlso) } })
        : [];
    return {
      ...this.localize(term, locale),
      related: related.map((r) => ({
        id: r.id,
        termKo: r.termKo,
        termEn: r.termEn,
        category: r.category,
      })),
    };
  }

  // 자동 링크에서 제외할 너무 흔한 일반어(오탐 방지)
  private static readonly LINK_STOP = new Set<string>([
    '중독', '치료', '회복', '부정', '대처', '개입', '예방', '강화',
  ]);

  // 표제어 -> 안전한 별칭 목록
  private linkAliases(termKo: string): string[] {
    const out = new Set<string>();
    const t = (termKo || '').trim();
    if (t) out.add(t);
    // 괄호 앞부분: '지연 할인(만족 지연의 실패)' -> '지연 할인'
    const paren = t.match(/^([^(]+)\(/);
    if (paren) out.add(paren[1].trim());
    // 가운뎃점 분리: '펜타닐·합성 아편류' -> '펜타닐', '합성 아편류'
    if (t.includes('·')) {
      for (const part0 of t.split('·')) {
        const part = part0.replace(/\(.*\)/, '').trim();
        if (part.length >= 3) out.add(part);
      }
    }
    // STOP 및 2자 미만 제거
    return [...out].filter(
      (a) => a && a.length >= 2 && !EncyclopediaService.LINK_STOP.has(a),
    );
  }

  // 기사 본문 용어 자동 링크용: { 별칭: id } 맵
  // 별칭 충돌 시, 더 짧은 표제어(더 대표적인 항목)를 우선한다.
  async linkMap() {
    const rows = await this.repo.find({
      where: { published: true },
      select: ['id', 'termKo'],
    });
    // 표제어가 짧은 순으로 정렬 -> 대표 항목이 먼저 별칭을 차지
    rows.sort((a, b) => (a.termKo?.length || 0) - (b.termKo?.length || 0));
    const map: Record<string, string> = {};
    for (const r of rows) {
      for (const a of this.linkAliases(r.termKo)) {
        if (!(a in map)) map[a] = r.id; // 먼저 온(더 짧은) 것 우선
      }
    }
    return map;
  }

  // definition/example/body/advanced 만 수정 허용
  async update(id: string, patch: any) {
    const term = await this.repo.findOne({ where: { id } });
    if (!term) {
      throw new NotFoundException(`encyclopedia term not found: ${id}`);
    }
    if (patch.definition !== undefined) {
      term.definition = String(patch.definition);
    }
    if (patch.example !== undefined) {
      term.example = String(patch.example);
    }
    if (patch.body !== undefined) {
      if (!Array.isArray(patch.body)) {
        throw new BadRequestException('body must be an array of {h,p}');
      }
      term.body = patch.body;
    }
    if (patch.advanced !== undefined) {
      if (!Array.isArray(patch.advanced)) {
        throw new BadRequestException('advanced must be an array of {h,p}');
      }
      term.advanced = patch.advanced;
    }
    term.updatedAt = new Date();
    return this.repo.save(term);
  }
}

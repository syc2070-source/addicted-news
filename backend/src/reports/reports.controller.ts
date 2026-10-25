import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fieldProfile } from '../crawler/field_profile';
import {
  OWNER_ID_PREFIX,
  loadOwnerMaterials,
  mergeReportLists,
  ownerReportCard,
} from './owner_materials';

const EMPTY_LIST = { count: 0, items: [] };
const NOT_FOUND = { found: false, item: null };

@Controller('reports')
export class ReportsController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  async listReports(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('scope') scope?: string,
    @Query('domain') domain?: string,
    @Query('region') region?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const lim = Number.isFinite(parsedLimit) ? parsedLimit : 50;
    const off = Number.isFinite(parsedOffset) ? parsedOffset : 0;
    // NEWS-Q16 ■5: 오너 공개 자료(스위치 sources.owner_materials.enabled · 꺼져 있거나 공개 항목이 없으면 응답은 예전 그대로)
    // scope · domain · region 으로 좁힌 목록에는 섞지 않음(Statory 거르기 칸)
    const narrowed = !!(scope?.trim() || domain?.trim() || region?.trim());
    const cards = narrowed ? [] : this.ownerCards();
    // 실패 = 예전엔 EMPTY_LIST · 성공 = Statory 응답 그대로(오너 카드가 있을 때만 섞음)
    const failed = () => (cards.length ? mergeReportLists(null, cards, lim, off) : EMPTY_LIST);
    const ok = (statory: any) => (cards.length ? mergeReportLists(statory, cards, lim, off) : statory);

    const base = this.config.get<string>('STATORY_API_URL')?.trim();
    if (!base) return failed();

    try {
      const params = new URLSearchParams();
      params.set('scenario_id', fieldProfile().statory_scenario_id);
      params.set('limit', String(lim));
      params.set('offset', String(off));
      if (scope?.trim()) params.set('scope', scope.trim());
      if (domain?.trim()) params.set('domain', domain.trim());
      if (region?.trim()) params.set('region', region.trim());

      const url = `${base.replace(/\/+$/, '')}/api/reports?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return failed();
      return ok(await res.json());
    } catch {
      return failed();
    }
  }

  private warnedRejected = false;

  /** 공개 오너 카드(스위치 꺼짐 · 설정 못 읽음 = []) · 꼴이 틀린 항목은 처음 한 번 로그. */
  private ownerCards() {
    try {
      const owner = loadOwnerMaterials();
      if (owner.rejected.length && !this.warnedRejected) {
        this.warnedRejected = true;
        Logger.warn(
          `오너 공개 자료 꼴 틀림 ${owner.rejected.length}건(내보내지 않음): ${owner.rejected.map((r) => `#${r.index} ${r.id || '-'} ${r.errors.join('/')}`).join(' · ')}`,
          'ReportsController',
        );
      }
      return owner.items.map((m) => ownerReportCard(m, fieldProfile().statory_scenario_id));
    } catch {
      return [];
    }
  }

  @Get(':id')
  async getReport(
    @Param('id') id: string,
    @Query('include_sections') includeSections?: string,
  ) {
    // NEWS-Q16 ■5: owner-<id> = 오너 공개 자료(스위치 켜짐일 때만 · 공개 항목만) · 본문은 body_ko · 꺼져 있으면 예전처럼 Statory 로
    if (id?.trim().startsWith(OWNER_ID_PREFIX)) {
      let owner: ReturnType<typeof loadOwnerMaterials> | null = null;
      try {
        owner = loadOwnerMaterials();
      } catch {
        owner = null;
      }
      if (owner?.enabled) {
        const m = owner.items.find((x) => `${OWNER_ID_PREFIX}${x.id}` === id.trim());
        if (!m) return NOT_FOUND;
        return { found: true, item: { ...ownerReportCard(m, fieldProfile().statory_scenario_id), body_ko: m.body ?? null } };
      }
    }

    const base = this.config.get<string>('STATORY_API_URL')?.trim();
    if (!base || !id?.trim()) return NOT_FOUND;

    try {
      const include =
        includeSections === 'true' || includeSections === '1';
      const params = new URLSearchParams();
      params.set('include_sections', String(include));
      const url = `${base.replace(/\/+$/, '')}/api/reports/${encodeURIComponent(id.trim())}?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return NOT_FOUND;
      return await res.json();
    } catch {
      return NOT_FOUND;
    }
  }
}

// ============================================================
// keyword_groups.ts (NEWS-Q11 ■3) — 핵심어 묶음별 수(분야 설정 keywords.groups).
// 기사 하나가 어느 묶음 낱말을 품었나(제목 + 첫 LEAD_CHARS 자 · 소문자 부분 맞춤 · 여럿 가능 · 없으면 OTHER_GROUP).
// 실행마다 묶음별 후보·저장·보관·거부 수를 per_source.__run.keywordGroups 에 남긴다(스키마 0) → health lastRun 요약.
// ============================================================
import { fieldProfile } from './field_profile';

export const OTHER_GROUP = '기타';
export const LEAD_CHARS = 300;

export type GroupCount = {
  candidates: number;
  saved: number;
  archived: number;
  rejected: number;
};
export type GroupCounts = Record<string, GroupCount>;

let cache: { key: unknown; groups: Array<[string, string[]]> } | null = null;

/** 설정의 묶음(이름 → 소문자 낱말). '_' 로 시작하는 칸은 설명이라 뺀다. */
export function keywordGroups(): Array<[string, string[]]> {
  const raw = fieldProfile().keywords.groups;
  if (cache && cache.key === raw) return cache.groups;
  const groups: Array<[string, string[]]> = Object.entries(raw || {})
    .filter(([name, words]) => !name.startsWith('_') && Array.isArray(words))
    .map(([name, words]) => [
      name,
      (words as string[]).map((w) => w.toLowerCase()).filter(Boolean),
    ]);
  cache = { key: raw, groups };
  return groups;
}

/** 이름만(방송 관문 하위 주제 후보 · 기타 포함). 설정에 묶음이 없으면 []. */
export function keywordGroupNames(): string[] {
  const names = keywordGroups().map(([n]) => n);
  return names.length ? [...names, OTHER_GROUP] : [];
}

/** 제목 + 첫 문단 → 묶음 이름들. 설정에 묶음이 없으면 [](세지 않음). */
export function keywordGroupsOf(title: string, body = ''): string[] {
  const groups = keywordGroups();
  if (!groups.length) return [];
  const text =
    `${title || ''}\n${(body || '').slice(0, LEAD_CHARS)}`.toLowerCase();
  const hit = groups
    .filter(([, words]) => words.some((w) => text.includes(w)))
    .map(([n]) => n);
  return hit.length ? hit : [OTHER_GROUP];
}

/** 실행 하나의 묶음별 수. */
export class GroupCounter {
  readonly counts: GroupCounts = {};

  add(groups: string[] | undefined, field: keyof GroupCount, n = 1): void {
    for (const g of groups || []) {
      const c = (this.counts[g] ||= {
        candidates: 0,
        saved: 0,
        archived: 0,
        rejected: 0,
      });
      c[field] += n;
    }
  }

  /** 기록용(후보 많은 순) — 빈 묶음은 뺀다. */
  toJSON(): GroupCounts {
    return Object.fromEntries(
      Object.entries(this.counts)
        .filter(([, c]) => c.candidates + c.saved + c.archived + c.rejected > 0)
        .sort(
          (a, b) =>
            b[1].candidates - a[1].candidates || a[0].localeCompare(b[0]),
        ),
    );
  }
}

/** health 한 줄 요약: 「묶음 후보/저장」(보관·거부는 runs 에). */
export function groupSummary(counts: unknown): Record<string, string> | null {
  if (!counts || typeof counts !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [g, c] of Object.entries(
    counts as Record<string, Partial<GroupCount>>,
  )) {
    if (!c || typeof c !== 'object') continue;
    out[g] = `${Number(c.candidates || 0)}/${Number(c.saved || 0)}`;
  }
  return Object.keys(out).length ? out : null;
}

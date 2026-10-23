// ============================================================
// breaker_summary.ts (NEWS-Q14 ■3) — 본문 추출 단락기로 본문을 못 읽은 기사의 RSS 요약 판정(LLM 호출 수 그대로).
// 단락기(NEWS-Q12 ■3)가 건너뛴 기사는 본문이 RSS 글(description)뿐이라 「본문 부실」로 판정 없이 빠졌다.
// RSS 요약에서 제목 되풀이 · 매체 이름을 뺀 글이 분야 설정 gate.breaker_summary_min_chars 자 이상이면
// 그 요약으로 판정한다(관문 DeepSeek 1번 그대로 · 추가 네트워크 0). 짧으면 옛 규칙(건너뜀).
// 실측(10-24): 구글 site: 검색 피드의 description = 「<a>제목</a> 매체」 뿐 → 그 피드에는 효과 0(보고서).
// ============================================================

function squashLen(s: string): number {
  return s.replace(/[^\p{L}\p{N}]/gu, '').length;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * RSS 요약에서 제목(꼬리 「 - 매체」 붙은 것 · 뗀 것) · 매체 이름을 뺀 글(공백 정리).
 * 제목 앞 30자가 요약에 그대로 있으면 그 문장도 되풀이로 본다(구글은 제목을 잘라 넣기도 함).
 */
export function summaryBeyondTitle(
  summary: string,
  title: string,
  source?: string | null,
): string {
  let rest = ` ${summary || ''} `;
  const parts = (title || '').split(/\s[-–—]\s+/);
  const bare = parts.length > 1 ? parts.slice(0, -1).join(' - ') : title || '';
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  for (const t of [title, bare, tail, source || '']
    .map((x) => (x || '').trim())
    .filter((x) => x.length >= 2)
    .sort((a, b) => b.length - a.length)) {
    rest = rest.replace(new RegExp(escapeRe(t), 'gi'), ' ');
  }
  const head = bare.trim().slice(0, 30);
  if (head.length >= 10) {
    rest = rest.replace(new RegExp(`${escapeRe(head)}[^.!?…]*`, 'gi'), ' ');
  }
  return rest.replace(/\s+/g, ' ').trim();
}

/**
 * 단락기로 본문 추출을 건너뛴 기사 → 판정에 쓸 요약(제목 뺀 글이 minChars 자 이상) · 아니면 null(옛 규칙: 본문 부실 건너뜀).
 * minChars 0 · 없음 = 끔.
 */
export function breakerSummaryOf(
  summary: string,
  title: string,
  source: string | null | undefined,
  minChars: number | undefined,
): string | null {
  if (!(Number(minChars) > 0)) return null;
  const rest = summaryBeyondTitle(summary, title, source);
  return squashLen(rest) >= Number(minChars) ? rest : null;
}

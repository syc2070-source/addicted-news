// ============================================================
// text_utils.ts (v5.4.1) — 저장 직전 텍스트 정리 + 크로스매체 유사도.
// ============================================================
import * as he from 'he';

// & 가 소실된 고아 엔티티 잔존물(예: "감사장hellip;")까지 복원할 매핑.
const ORPHAN_ENTITY: Record<string, string> = {
  hellip: '…', mldr: '…', quot: '"', apos: "'", amp: '&', lt: '<', gt: '>',
  nbsp: ' ', middot: '·', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', deg: '°', copy: '©', reg: '®', trade: '™',
};

/**
 * HTML 엔티티 디코딩(제목·요약 저장 직전).
 * 1) he.decode 로 표준(&hellip; &#39; 등) + 숫자 엔티티 처리.
 * 2) & 가 이미 소실돼 남은 고아 엔티티(hellip; quot; #39; 등)도 복원.
 */
export function decodeEntities(input: string): string {
  if (!input) return input;
  let s = he.decode(input);
  // 고아 명명 엔티티: 앞에 & 가 없이 남은 것
  s = s.replace(/&?([a-zA-Z][a-zA-Z0-9]{1,10});/g, (m, name) => {
    const v = ORPHAN_ENTITY[String(name).toLowerCase()];
    return v !== undefined ? v : m;
  });
  // 고아 숫자 엔티티: (&)?#39; (&)?#x2026;
  s = s.replace(/&?#(\d+);/g, (m, n) => {
    try { return String.fromCodePoint(Number(n)); } catch { return m; }
  });
  s = s.replace(/&?#x([0-9a-fA-F]+);/g, (m, h) => {
    try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; }
  });
  return s.replace(/\s+/g, ' ').trim();
}

/** 제목에 엔티티 잔존물이 있는지(보정 대상 판별용) */
export function hasEntityArtifact(s: string): boolean {
  return /&?(hellip|quot|amp|nbsp|lt|gt|apos|middot|mdash|ndash|lsquo|rsquo|ldquo|rdquo|mldr);|&?#x?[0-9a-fA-F]+;/.test(s || '');
}

// ── 크로스매체 동일 사건 유사도(3-2) ─────────────────────────
const CM_STOPWORDS = new Set([
  '기자', '종합', '단독', '속보', '뉴스', '보도', '영상', '사진', '인터뷰',
  '오늘', '내일', '어제', '올해', '지난', '이번', '최근',
]);

/** 제목 정규화: 괄호류·매체명 접두/접미·특수문자 제거 후 토큰화 재료로. */
export function normalizeTitleForCrossMedia(title: string): string {
  let s = decodeEntities(title || '');
  s = s.replace(/[\[\(【<〈《][^\]\)】>〉》]*[\]\)】>〉》]/g, ' '); // 괄호류 내용 제거([단독],(종합) 등)
  s = s.replace(/^[^\s=\]]{2,10}\s*[=\]·|]\s*/, ' ');            // "세계일보=" "뉴시스]" 접두 매체표기
  s = s.replace(/[-–—·|]\s*[가-힣A-Za-z]{2,10}\s*$/, ' ');         // "- 뉴시스" 접미 매체표기
  s = s.replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ');                   // 특수문자
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function crossMediaTokens(title: string): Set<string> {
  return new Set(
    normalizeTitleForCrossMedia(title)
      .split(' ')
      .filter((w) => w.length >= 2 && !CM_STOPWORDS.has(w)),
  );
}

/** 두 제목의 토큰 자카드 유사도(0~1). 매체만 다른 동일 사건 탐지용. */
export function crossMediaSimilarity(a: string, b: string): number {
  const ta = crossMediaTokens(a), tb = crossMediaTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

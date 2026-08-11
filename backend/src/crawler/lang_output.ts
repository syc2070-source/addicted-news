// ============================================================
// lang_output.ts (LANG-GUARD-1 작업1-1) — 최종 산출물이 한국어인지 판별.
//
// 배경: 파이프라인에 "산출물이 한국어인가"를 검사하는 단계가 없어, 중국어 입력의
//       산출물이 중국어 그대로 게재됐다(F1 2건). 요약 생성 성공 = 언어 무관 통과였다.
//
// 순수 함수. DB·네트워크 의존 없음(테스트·스크립트에서 공용).
//
// ── 임계값 측정 근거(감으로 정하지 않음) ────────────────────────────
// 표본 A: 백과 본문 60건(정의+예시+본문, 한국어 산문)
//   한글비율 min 0.835 / p5 0.860 / p50 0.929 / max 0.962
//   한자비율 전 구간 0.000 · 라틴비율 max 0.069
// 표본 B: 백과 표제어 60건(짧은 제목)
//   한글비율 min 0.667 / p5 0.875 / p50 1.000 · 한자 0.000
// 표본 C: 한국어 뉴스 제목 최악 사례(기관 약어·수치 다수) — 통과해야 하는 쪽
//   "WHO, ICD-11 게임이용장애 등재"        ko 0.444 lat 0.333
//   "AA·NA·GA 자조모임 전국 확대"          ko 0.500 lat 0.375
//   "SBIRT 1차의료 시범사업 확대"          ko 0.600 lat 0.333
//   → 정상 한국어의 최저 한글비율 = 0.444
// 대조군(차단 대상):
//   F1 중국어 ①                            ko 0.000 han 0.955
//   F1 중국어 ②                            ko 0.000 han 0.857
//   영어 전문                               ko 0.000 lat 1.000
//   일본어                                  ko 0.000 han 0.412
//   → 비한국어의 한글비율 = 0.000 (4/4)
//
// 결론: [0.000, 0.444] 사이가 완전히 비어 있다. 임계를 그 한가운데보다 낮게 잡아
//   한국어 쪽 여유를 크게 둔다.
//     KO_MIN   = 0.30  (정상 한국어 최저 0.444보다 0.144 아래, 비한국어보다 0.30 위)
//     HANJA_MAX= 0.15  (한국어 표본 한자비율 0.000, 중국어 0.857~0.955, 일본어 0.412)
// ============================================================

export const KO_MIN = Number(process.env.LANG_KO_MIN || 0.30);
export const HANJA_MAX = Number(process.env.LANG_HANJA_MAX || 0.15);
/** 이보다 짧으면 비율 통계가 불안정 → 한글이 하나라도 있으면 통과로 본다. */
export const MIN_CHARS_FOR_RATIO = 8;

export interface LangRatio {
  ko: number;    // 한글 음절(가-힣) 비율
  hanja: number; // CJK 통합 한자 비율
  latin: number; // 라틴 문자 비율
  total: number; // 공백 제외 문자 수
}

/** 공백을 제외한 문자 구성비. */
export function langRatio(text: string): LangRatio {
  const s = String(text || '');
  let ko = 0, hanja = 0, latin = 0, total = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    const c = ch.codePointAt(0) as number;
    total++;
    if (c >= 0xac00 && c <= 0xd7af) ko++;
    else if (c >= 0x4e00 && c <= 0x9fff) hanja++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++;
  }
  return total
    ? { ko: ko / total, hanja: hanja / total, latin: latin / total, total }
    : { ko: 0, hanja: 0, latin: 0, total: 0 };
}

export interface LangCheck {
  ok: boolean;
  reason?: 'empty' | 'hanja_dominant' | 'low_korean';
  field?: 'title' | 'summary';
  ratio?: LangRatio;
}

/** 문자열 하나가 한국어 산출물인지. */
export function isKoreanText(text: string): LangCheck {
  const r = langRatio(text);
  if (r.total === 0) return { ok: false, reason: 'empty', ratio: r };
  // 한자 우세 = 중국어/일본어 산출물
  if (r.hanja >= HANJA_MAX) return { ok: false, reason: 'hanja_dominant', ratio: r };
  // 너무 짧으면 비율이 불안정 → 한글이 하나라도 있으면 통과
  if (r.total < MIN_CHARS_FOR_RATIO) {
    return r.ko > 0 ? { ok: true, ratio: r } : { ok: false, reason: 'low_korean', ratio: r };
  }
  if (r.ko < KO_MIN) return { ok: false, reason: 'low_korean', ratio: r };
  return { ok: true, ratio: r };
}

/**
 * 최종 산출물(제목·요약) 언어 검사. 둘 다 한국어여야 통과(fail-closed).
 * 어느 필드가 왜 걸렸는지 함께 돌려준다(격리 사유 로깅용).
 */
export function isKoreanOutput(title: string, summary: string): LangCheck {
  const t = isKoreanText(title);
  if (!t.ok) return { ...t, field: 'title' };
  const s = isKoreanText(summary);
  if (!s.ok) return { ...s, field: 'summary' };
  return { ok: true };
}

/** 로그·리포트용 한 줄 요약. */
export function describeLangCheck(c: LangCheck): string {
  if (c.ok) return 'ok';
  const r = c.ratio;
  const nums = r ? `ko=${r.ko.toFixed(3)} hanja=${r.hanja.toFixed(3)} latin=${r.latin.toFixed(3)} chars=${r.total}` : '';
  return `${c.field ?? '?'}/${c.reason ?? '?'} ${nums}`;
}

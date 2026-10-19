// ============================================================
// public_redact.ts (NEWS-Q10 ■1) — 공개 health·runs 응답의 글에서 접속 정보를 가린다(한 함수).
// 가리는 것: 주소(scheme://…) · 키=값 열쇠·접속 칸 · 열쇠 꼴(sk-… · AIza… · JWT · Bearer) · 사용자·DB 이름(user "…" · database "…")
//            · 사용자@호스트 · IP(v4·v6)와 포트 · 호스트 이름(점 낱말 · Render 내부 dpg-…) · 파일 경로(C:\… · /a/b…).
// 시각(ISO) · commit SHA(소문자 16진 40) · 소스 id(kr-google-…) · 상태 코드([404])는 그대로 둔다.
// ============================================================

const HOST_TOKEN = '<host>';

const RULES: Array<[RegExp, string | ((m: string) => string)]> = [
  // 주소 전부(접속 문자열 postgres://user:pass@host:port/db 포함)
  [/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)\]]+/gi, '<url>'],
  // 키=값 · 키: 값 (열쇠·접속 칸)
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|key|user(?:name)?|host(?:name)?|port|database|dbname|db)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
    '$1=<hidden>',
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer <key>'],
  // 열쇠 꼴
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '<key>'],
  [/\bAIza[0-9A-Za-z_-]{10,}/g, '<key>'],
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '<key>'],
  [
    /\b(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g,
    '<key>',
  ],
  // 사용자·DB 이름(PostgreSQL 오류 꼴: for user "x" · database "x" does not exist · role "x")
  [/\b(user|role|database|db)\s+"[^"]*"/gi, '$1 "<hidden>"'],
  // 사용자@호스트
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?::\d+)?/g, `<user>@${HOST_TOKEN}`],
  // IPv4(+포트)
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, HOST_TOKEN],
  // IPv6(+포트) — 콜론으로 이은 16진 묶음 중 글자(a-f)나 「::」가 있는 것만(시각 03:00:39 은 숫자뿐이라 그대로)
  [
    /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{1,4}(?![\w:])/gi,
    (m) => (/[a-f]/i.test(m) || m.includes('::') ? HOST_TOKEN : m),
  ],
  // getaddrinfo ENOTFOUND <이름> · connect ECONNREFUSED <이름> (점 없는 내부 호스트 이름)
  [
    /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\s+(?!<)[^\s;,)]+/g,
    `$1 ${HOST_TOKEN}`,
  ],
  // Render 내부 DB 호스트(dpg-…)
  [/\bdpg-[a-z0-9]+(?:-[a-z0-9]+)*\b/gi, HOST_TOKEN],
  // 호스트 이름(점 낱말 · 끝이 글자 2~24) + 포트
  [
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{1,5})?\b/gi,
    HOST_TOKEN,
  ],
  // 파일 경로(윈도 · 유닉스 두 마디 이상)
  [/\b[A-Za-z]:\\[^\s'"<>|]*/g, '<path>'],
  [/(^|[\s('"=])\/(?:[\w.@-]+\/)+[\w.@-]*/g, '$1<path>'],
  // 남은 「호스트:포트」(<host>:5432) · 「port 5432」
  [/<host>:\d{1,5}/g, HOST_TOKEN],
  [/\bport\s+\d{2,5}\b/gi, 'port <hidden>'],
];

/** 공개 응답에 나가는 글 하나에서 접속 정보·열쇠를 가린다. 길이는 그대로 둠(자르는 것은 부르는 쪽). */
export function redactPublicText(s: string): string {
  let out = String(s ?? '');
  for (const [re, to] of RULES)
    out = typeof to === 'string' ? out.replace(re, to) : out.replace(re, to);
  return out;
}

/** 시각(ISO) · commit SHA 는 가리지 않는다(배포 확인 · 실행 시각). */
function keepAsIs(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s) ||
    /^[0-9a-f]{40}$/.test(s)
  );
}

/** 공개 응답 전체(객체·배열)를 돌며 글마다 redactPublicText. 원본은 바꾸지 않는다(기억 캐시 보호). */
export function redactPublic<T>(v: T): T {
  if (typeof v === 'string')
    return (keepAsIs(v) ? v : redactPublicText(v)) as unknown as T;
  if (Array.isArray(v))
    return (v as unknown[]).map((x) => redactPublic(x)) as unknown as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      out[k] = redactPublic(x);
    return out as T;
  }
  return v;
}

import { redactPublic, redactPublicText } from './public_redact';
import { safeError } from './cleanup_runs';

// NEWS-Q10 ■1: 공개 health·runs 응답의 오류 글에서 호스트·포트·사용자·DB 이름·경로·열쇠 꼴을 가린다(가짜 오류 다섯)
describe('public_redact — 공개 응답 가리기(NEWS-Q10 ■1)', () => {
  const leaks = (s: string, words: string[]) =>
    words.filter((w) => s.includes(w));

  it('① DB 호스트 이름(Render 외부·내부) — getaddrinfo ENOTFOUND', () => {
    const out = redactPublicText(
      'getaddrinfo ENOTFOUND dpg-cr4abc12def34g-a.oregon-postgres.render.com',
    );
    expect(leaks(out, ['dpg-', 'oregon', 'render.com', 'postgres'])).toEqual(
      [],
    );
    expect(redactPublicText('getaddrinfo EAI_AGAIN dpg-cr4abc12def34g-a')).toBe(
      'getaddrinfo EAI_AGAIN <host>',
    );
  });

  it('② 사용자 이름 — password authentication failed for user "…"', () => {
    const out = redactPublicText(
      'password authentication failed for user "addiction_owner"',
    );
    expect(out).toBe('password authentication failed for user "<hidden>"');
  });

  it('③ IP·포트(v4·v6) — connect ECONNREFUSED / ETIMEDOUT / ENETUNREACH', () => {
    const out = redactPublicText(
      'spec-001 (The Fix): connect ETIMEDOUT 138.199.46.69:443; connect ENETUNREACH 2400:52e0:1500::747:1:443 - Local (:::0)',
    );
    expect(leaks(out, ['138.199', ':443', '2400:52e0', '747'])).toEqual([]);
    expect(out.startsWith('spec-001 (The Fix): connect ETIMEDOUT <host>')).toBe(
      true,
    );
    expect(redactPublicText('connect ECONNREFUSED 10.0.3.17:5432')).toBe(
      'connect ECONNREFUSED <host>',
    );
  });

  it('④ DB 이름 · 접속 문자열(사용자·비밀번호·호스트·포트) · 키=값', () => {
    const out = redactPublicText(
      'database "addiction_news" does not exist (postgres://admin:hunter2@db.internal:5432/addiction_news) host=db.internal port=5432 user=admin',
    );
    expect(
      leaks(out, ['addiction_news', 'admin', 'hunter2', 'db.internal', '5432']),
    ).toEqual([]);
  });

  it('⑤ 파일 경로(유닉스·윈도) · 열쇠 꼴(sk- · AIza · JWT · Bearer · key=)', () => {
    const out = redactPublicText(
      "ENOENT: no such file or directory, open '/opt/render/project/src/backend/data/x.json' C:\\Users\\My\\secret.txt " +
        'DEEPSEEK key=sk-abcdef1234567890abcdef YT AIzaSyA1234567890abcdefghijklmnopqrstu ' +
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
    );
    expect(
      leaks(out, [
        '/opt/render',
        'C:\\Users',
        'sk-abcdef',
        'AIzaSy',
        'eyJhbGci',
        'c2lnbmF0dXJl',
      ]),
    ).toEqual([]);
  });

  it('지금 공개 칸 꼴은 그대로(소스 id · 상태 코드 · 시각 · commit SHA)', () => {
    for (const s of [
      'broadcast:mbc_pd_note [404]',
      'wp-wpr-002 (The Washington Post) [502]: Request failed with status code 502',
      'kr-google-site-pressian',
    ]) {
      expect(redactPublicText(s)).toBe(s);
    }
    const v = {
      commit: 'a32a5e1fb6e0f157967da26a404bf9df94b35059',
      startedAt: '2026-10-18T03:00:38.278Z',
      n: 3,
      ok: true,
      x: null,
    };
    expect(redactPublic(v)).toEqual(v);
    expect(redactPublicText('읽기 03:00:39 끝')).toBe('읽기 03:00:39 끝');
  });

  it('redactPublic 은 객체·배열 안의 글을 모두 가리고 원본(기억 캐시)은 바꾸지 않는다', () => {
    const run = {
      failedFeeds: ['x (y): connect ETIMEDOUT 1.2.3.4:443'],
      progress: { note: 'host=db.internal' },
    };
    const out = redactPublic([run]);
    expect(out[0].failedFeeds[0]).toBe('x (y): connect ETIMEDOUT <host>');
    expect(out[0].progress.note).toBe('host=<hidden>');
    expect(run.failedFeeds[0]).toContain('1.2.3.4');
  });

  it('safeError(정리 cron 기록)도 같은 함수 · 200자', () => {
    const e = new Error(
      `getaddrinfo ENOTFOUND dpg-abc123-a.oregon-postgres.render.com ${'x'.repeat(300)}`,
    );
    const s = safeError(e);
    expect(s).not.toContain('render.com');
    expect(s.length).toBe(200);
  });
});

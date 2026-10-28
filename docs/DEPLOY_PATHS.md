# 배포 길 (NEWS-Q19 ■1 · 2026-10-26 실측)

중독뉴스는 **두 곳**으로 나뉘어 배포된다. 같은 저장소 `main` 가지에서 나가지만 서비스 · 확인 방법이 다르다.

| | 백엔드(API · 수집) | 프런트(손님 화면) |
|---|---|---|
| 폴더 | `backend/` | `frontend/` |
| 호스팅 | Render 웹 서비스 `addicted-news-backend.onrender.com` | Vercel 정적 호스팅 `www.addictionnews.net` (`addictionnews.net` → 308 → `www`) |
| 만드는 법 | NestJS 빌드 · 기동 | 빌드 없음 — `frontend/vercel.json`(`buildCommand: null` · `outputDirectory: "."`)대로 폴더를 그대로 냄 |
| 언제 나감 | `main` push 마다 자동 · 커밋 제목에 `[skip render]` 가 있으면 건너뜀 | `main` push 뒤 Vercel 이 냄(Vercel 프로젝트 설정 · 연결 방식은 이 저장소에서 읽을 수 없음 — 미측) |
| 섰는지 보는 법 | `GET /api/health` 의 `commit` · `startedAt` | 실화면의 `assets/js/main.js` · `assets/css/style.css` 를 받아 저장소 커밋 파일과 대조 |
| 손님 쪽 기억 | — | `assets/*` 는 `Cache-Control: public, max-age=86400`(vercel.json) · `index.html` 은 `max-age=0` |

- 백엔드가 프런트를 정적으로 내지 않는다(`backend/src` 에 정적 제공 코드 0).
- 프런트가 부르는 API 주소는 `frontend/assets/js/config.js` 의 `window.API_BASE`(Render 주소) 하나다.
- `[skip render]` 는 Render 만 건너뛴다. Vercel 은 그 표식을 읽지 않는다(문서 · 보고서만 바뀐 커밋이라 화면 결과는 같음).

## 주의 — 하루 기억

`index.html` 이 `assets/js/main.js` · `assets/css/style.css` 를 판 표식 없이 부르므로, 한 번 들른 손님 브라우저는 새 배포 뒤에도 **최대 하루** 옛 JS · CSS 를 쓸 수 있다(새 HTML + 옛 JS 섞임 가능). 처음 오는 손님 · 시크릿 창은 바로 새 판.

## 판 꼬리표 (NEWS-Q20 ■1)

프런트는 빌드가 없어(`buildCommand: null`) 배포 때 커밋 해시를 넣을 길이 없다 → 저장소 파일 하나로 둔다.

| 무엇 | 어디 | 기억 |
|---|---|---|
| 판 파일 | `frontend/version.json` → `https://www.addictionnews.net/version.json` (`commit` 짧은 해시 · `built` KST 시각) | `assets/` 밖이라 하루 기억에 안 걸림(`index.html` 과 같은 기본 · 바로 새 판) |
| 바닥글 작은 글씨 | 쪽마다 `#footer-build` ← `assets/js/footer.js` 가 `version.json` 을 `no-store` 로 읽어 「판 b96f29a · 2026-10-26 16:22」 | `footer.js` 자체는 `assets/` 라 하루 기억 — 옛 JS 를 쓰는 손님에겐 판 표시가 비어 보임(그 자체가 「옛 JS」 표시) |

- **고치는 때**: 프런트를 바꾼 코드 커밋(ⓑ)을 push 한 뒤, 보고서 커밋(ⓒ)에서 `version.json` 의 `commit` · `built` 를 그 ⓑ 커밋으로 고친다(자기 해시는 커밋 전에 알 수 없음). 프런트를 안 바꾼 판은 그대로 둔다.
- **섰는지 보는 법(프런트)**: `GET https://www.addictionnews.net/version.json` 의 `commit` 이 그 ⓑ 와 같으면 A. 그다음 `main.js` · `style.css` 바이트 대조(위 표)로 자산까지 확인.
- 백엔드 판은 그대로 `GET /api/health` 의 `commit`(Render 가 기동한 커밋 · 따로 만들지 않음).

## 10-28 실측 (NEWS-Q19 가 섰는지 · NEWS-Q20 ■0)

| 무엇 | 값 | 판정 |
|---|---|---|
| health `commit` | `b96f29a…` · `startedAt` 2026-10-26T07:23:01Z(16:23 KST) | A — Q19 코드 기동 |
| 실화면 `main.js` · `style.css` | 저장소 `ddd9417` 의 두 파일과 git 해시 같음(`28feec1` · `d036586` · Q18 `style.css` `4152dfb` 와 다름) | A — Q19 프런트 섬 |
| 실화면 1440 / 390 | 폰 머리 단추 둘이 로고 아래 줄 · 가로 넘침 0 | A |

캡처: `docs/reports/202610/NEWS-Q20_live_{desktop,phone}.png`.

## 10-26 실측 (NEWS-Q18 이 섰는지)

| 무엇 | 값 | 판정 |
|---|---|---|
| health `commit` | `9e4dadc…` · `startedAt` 04:53:31Z(13:53 KST) | A — Q18 코드 기동 |
| 실화면 `main.js` · `style.css` | 저장소 `c56a966` 의 두 파일과 바이트 같음(`cmp` 0) | A — Q18 프런트 섬 |
| 실화면 1440 / 390 | 1위 그림 + 2·3위 한 줄 카드(`top-news-mini`) 보임 · 가로 넘침 0 | A |

캡처: `docs/reports/202610/NEWS-Q19_live_{desktop,phone}.png`.

# 중독백과 영상 자동생성 파이프라인

172개 백과 항목 → 각 1편의 영상(1920×1080, 한국어, 자막). 데스크탑(GPU 불필요, Edge-TTS는 인터넷만)에서 실행.

## 설치 (C:\addicted-news\video_pipeline\ 에 이 폴더를 둔 뒤)
```
pip install -r requirements.txt
```
ffmpeg는 이미 설치됨(8.1.2 확인). DB는 backend/.env 의 DB_* 를 자동으로 읽음.

## 실행
```
python build.py twelve-step        # 샘플 1개 (먼저 이걸로 품질 확인)
python build.py --all --limit 5    # 앞 5개 테스트
python build.py --all              # 172개 전체
python build.py --all --resume     # 중단 후 이어서 (만든 건 건너뜀)
```
산출물: scripts/ audio/ subs/ images/ video/  (id.mp4 가 최종 영상)

## 4단계 구조
fetch(DB) → script(대본) → tts(음성+타임스탬프) → subs(SRT) → render(ffmpeg MP4)

- 낭독 규칙: definition 스킵 / example 포함 / 소제목(h)은 낭독 안 함(화면 챕터·자막용)
- **음성 교체 지점: lib/tts.py 의 synth(text, out_mp3) -> word_marks**
  나중에 '내 목소리' 로컬 클론으로 바꿀 때 이 함수만 같은 시그니처로 교체하면
  script/subs/render 는 손대지 않아도 된다.

## 배경 이미지
- 기본: 카테고리별 그라디언트 자동 생성 (키 없이 즉시 동작)
- 업그레이드: 환경변수 PEXELS_API_KEY 설정 시 스톡 사진 자동 검색(상업적 무료)
  ```
  set PEXELS_API_KEY=xxxx   (PowerShell: $env:PEXELS_API_KEY="xxxx")
  ```
  샘플 몇 개 돌려보고 사진이 나은지 그라디언트가 나은지 판단해 결정.

## 음성 설정 (lib/tts.py)
- VOICE = ko-KR-InJoonNeural (남성) / ko-KR-SunHiNeural (여성)
- RATE 로 낭독 속도 조절 ("-10%" = 느리게)

## 백과 영상 연결 (나중, 선택)
DB encyclopedia_terms 에 video_url/video_status 컬럼이 이미 있음.
렌더 완료 후 video_status='ready', video_url=... 로 UPDATE 하면 백과 프론트에 붙일 수 있음.
(이번 범위 밖 — 필요 시 별도 지시)

---

# v2 — 다중 배경 전환 + 여성 음성 + 유튜브 업로드 + 백과 임베드

`build.py`(v1)는 배경 1장·남성 음성. `build_v2.py`(v2)는 **장면마다 배경이 바뀌고
(0.5초 크로스페이드) 여성 음성**으로 재생성한다. v1 파일·산출물은 그대로 두고
산출물만 `audio_v2/ subs_v2/ video_v2/` 로 분리한다.

## 사전 요구사항 (새 데스크톱에서 처음 한 번)

### 1) 파이썬 의존성
`video_pipeline/requirements.txt` 를 설치한다.
```
cd C:\addicted-news\video_pipeline
pip install -r requirements.txt
```
포함 패키지: `edge-tts`(음성), `psycopg2-binary`(DB), `Pillow`(이미지),
`google-api-python-client`·`google-auth-oauthlib`(유튜브 업로드).

### 2) ffmpeg 설치 (필수 — 렌더/오디오 결합에 사용)
```
winget install Gyan.FFmpeg
```
> ⚠️ 설치 후 **반드시 새 터미널(PowerShell) 창을 열어야** PATH 가 반영된다.
> 확인: `ffmpeg -version` 이 버전을 출력하면 OK. (`ffmpeg 를 찾을 수 없음` 이면
> 새 창을 안 연 것.)

### 3) PEXELS_API_KEY (배경 사진)
장면별 실제 사진을 받으려면 Pexels 키가 필요하다. **`backend/.env` 에 한 줄** 넣으면
`build_v2` 가 자동으로 읽는다(환경변수로 넣어도 됨 — 환경변수 우선).
```
# backend/.env
PEXELS_API_KEY=발급받은키
```
> ⏱ **시간당 200회 한도**. 항목당 장면 수만큼 호출하므로 전량(172개) 재생성은
> 한도에 걸릴 수 있다. v2 는 **429(한도 초과) 시 60초 대기 후 최대 3회 재시도**하고,
> 그래도 실패하면 그 항목을 실패 목록에 남긴다(조용한 폴백 없음). 실패분은 나중에
> `--resume` 로 다시 돌리면 된다.
> 키 진단: `python pexels_check.py` (키 출처·HTTP 상태 확인).

### 4) DB / DeepSeek
`backend/.env` 의 `DB_*`(Supabase), `DEEPSEEK_API_KEY`(장면 검색어 생성)를 그대로 사용.
DeepSeek 키가 없으면 카테고리 기본 검색어로 폴백(경고 출력).

### 5) DB 스키마 (임베드용, 1회)
Supabase SQL Editor 에서 `deploy/v2_youtube_video_id.sql` 실행
(`encyclopedia_terms.youtube_video_id` 컬럼 추가, 멱등).

## 실행 명령 요약
```
# 영상 재생성 (v2)
python build_v2.py twelve-step          # 샘플 1편 (품질 확인용)
python build_v2.py --all                # 172개 전체
python build_v2.py --all --limit 5      # 앞 5개 테스트
python build_v2.py --all --resume       # 중단/실패분 이어서 (video_v2/{id}.mp4 있으면 skip)

# 유튜브 업로드 (하루 페이싱)
python upload_youtube.py --dry-run      # 업로드 없이 메타데이터만 (구글 인증 불필요)
python upload_youtube.py                # 오늘 최대 5편 업로드(공개)
python upload_youtube.py --daily-limit 3
python upload_youtube.py --private      # 비공개
python upload_youtube.py twelve-step    # 특정 1편만
```
- 로그: `build_v2.py` 는 화면 + `logs/build_v2_<시각>.log`(UTF-8)에 동시 기록.
  콘솔·파일 모두 UTF-8 강제라 한글이 깨지지 않는다(`PYTHONIOENCODING`·`Tee-Object` 불필요).
  파일 없이 화면만: `--no-log`.
- 배경 소싱이 **절반 이상 그라디언트 폴백이면 빌드를 중단**하고 장면별 사유(HTTP 상태·
  키 유무)를 출력한다. 의도적으로 그라디언트를 허용하려면 `ALLOW_GRADIENT_FALLBACK=1`.

## 유튜브 업로드 준비 (한 번)
1. Google Cloud 콘솔: **YouTube Data API v3** 사용 설정 + **OAuth 클라이언트(데스크톱 앱)**
   생성 → `client_secret.json` 을 `video_pipeline/` 에 저장(**커밋 금지**, `.gitignore` 처리됨).
2. 첫 실행 시 브라우저 인증(표준뉴스 소유 계정) → `token.json` 자동 캐시.
3. 쿼터: 업로드 1건 = 1,600 units, 하루 10,000 → **최대 6편/일**(기본 5편).
   `upload_state.json` 에 완료분 기록 → 재실행 시 자동 스킵(멱등). 172편 ≈ 35일.
4. 업로드 성공 시 재생목록 "중독백과" 에 추가하고 `encyclopedia_terms.youtube_video_id`
   를 채운다 → 백과 항목 페이지에 유튜브 임베드가 자동 노출(youtube-nocookie.com).
   (Windows 작업 스케줄러로 매일 1회 `python upload_youtube.py` 등록 가능. 시작 위치는
    `video_pipeline` 폴더로.)

## v2 파일 맵
- `build_v2.py` — v2 진입점(샘플/전량/재개/로그)
- `lib/scenes.py` — 층 경계 장면 분할(최소 3장면, 60초 문단 분할) + 목차
- `lib/scene_keywords.py` — 항목당 DeepSeek 1회로 전 장면 검색어
- `lib/images_v2.py` — 장면별 Pexels(키 .env 로딩·429 재시도) → 폴백
- `lib/render_v2.py` — 다중 이미지 크로스페이드 + 자막 + 제목
- `lib/logutil.py` — UTF-8 강제 + 로그 파일 Tee
- `upload_youtube.py` — 유튜브 업로드(OAuth·재생목록·멱등·DB 반영)

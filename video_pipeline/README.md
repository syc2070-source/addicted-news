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

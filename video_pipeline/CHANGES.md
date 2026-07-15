# 수정 내역 (v2)

이번 판에서 고친 것 — 재생성해서 반영됨:

1. **자막 문장 완결** (lib/subs.py)
   - 기존: 22자마다 뚝 끊어 문장 중간이 잘림.
   - 변경: 문장 종결부호(. ! ?)에서만 자막을 마감. 긴 문장만 쉼표에서 보조 분할(40자↑).

2. **"예:" 제거** (lib/script.py)
   - example의 "예:"/"예시:"/"예)" 접두어를 떼고,
   - 별도 챕터로 띄우지 않고 본문 마지막에 자연스럽게 이어붙임.

3. **배경 사진** (lib/images.py)
   - PEXELS_API_KEY 있으면 항목 영어명(term_en)으로 검색 → 항목마다 다른 사진.
   - 결과 없으면 카테고리 키워드로 폴백, 그것도 실패하면 그라디언트.
   - fetch.py 가 term_en 을 함께 읽도록 수정됨.

4. **Pexels Cloudflare 1010** (로컬 패치)
   - API·이미지 다운로드에 User-Agent 헤더 추가.

## 재생성 방법 (데스크탑)
PowerShell에서 키 설정 후 먼저 1개로 확인:
```
$env:PEXELS_API_KEY="발급받은키"
cd C:\addicted-news\video_pipeline
python build.py twelve-step
```
video/twelve-step.mp4 열어서 자막·"예:"·배경 사진 확인.
좋으면 전체 재생성(이번엔 resume 없이 덮어쓰기 — 이전 172개를 새 버전으로):
```
python build.py --all
```
(주의: --resume 을 빼야 기존 mp4 를 새 버전으로 덮어씀. 붙이면 건너뜀.)

같은 PowerShell 창에서 실행해야 $env 키가 유지됨. 창을 새로 열면 키를 다시 set.

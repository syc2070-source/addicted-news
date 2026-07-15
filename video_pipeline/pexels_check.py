"""
pexels_check.py — Pexels 키/요청만 단독 진단.
사용: (키 설정한 같은 PowerShell 창에서)
    python pexels_check.py
403의 원인이 키인지, 형식인지, 헤더인지 가려낸다.
"""
import os
import sys
import urllib.parse
import urllib.request

key = os.environ.get("PEXELS_API_KEY", "")

print("=== 1) 환경변수 확인 ===")
if not key:
    print("  [X] PEXELS_API_KEY 가 비어 있음.")
    print("      → 이 창에서 다음을 실행 후 다시 시도:")
    print('        $env:PEXELS_API_KEY="발급받은키"')
    sys.exit(1)

print(f"  키 길이: {len(key)} 자")
print(f"  앞 4자: {key[:4]}...  뒤 4자: ...{key[-4:]}")
if key != key.strip():
    print("  [!] 앞뒤에 공백/줄바꿈이 있음 → 이게 403 원인일 수 있음.")
    key = key.strip()
    print("      (진단에서는 자동으로 trim 함)")

print("\n=== 2) Pexels API 실제 호출 ===")
url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({
    "query": "recovery hope", "per_page": 1, "orientation": "landscape",
})
req = urllib.request.Request(url, headers={
    "Authorization": key,
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        code = r.getcode()
        body = r.read(400).decode(errors="replace")
        # 남은 요청 수 헤더
        remain = r.headers.get("X-Ratelimit-Remaining")
        limit = r.headers.get("X-Ratelimit-Limit")
    print(f"  [OK] HTTP {code}")
    if limit:
        print(f"  이번 달 한도: {limit}, 남은 요청: {remain}")
    print("  → 키 정상. build.py 를 그대로 다시 실행하면 사진 배경이 나옵니다.")
except urllib.error.HTTPError as e:
    print(f"  [X] HTTP {e.code} {e.reason}")
    detail = e.read(400).decode(errors="replace")
    print("  응답 본문:", detail[:300])
    if e.code == 403:
        print("\n  403 해석:")
        print("   - 키가 틀렸거나 비활성/미승인 상태.")
        print("   - pexels.com/api 에서 키를 다시 복사(전체, 공백 없이) 했는지 확인.")
        print("   - 로그인한 계정의 키가 맞는지 확인.")
    elif e.code == 429:
        print("   - 요청 한도 초과. 잠시 후 재시도.")
except Exception as e:
    print("  [X] 네트워크/기타 오류:", e)

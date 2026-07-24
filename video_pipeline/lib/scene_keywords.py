"""
scene_keywords.py — 한 항목의 모든 장면 배경 검색어를 DeepSeek '한 번'에 생성. (v2 지시서 1-2)

원칙:
  - 항목당 DeepSeek 호출 1회 (장면마다 호출 X — 비용/속도).
  - 반환은 장면 수와 정확히 같은 길이의 '영어 스톡사진 검색어' 리스트.
  - 가이드라인(프롬프트에 포함):
      * 추상적/차분한 이미지 선호.
      * 마약/주사기/음주 등 직접 묘사 금지(유튜브 정책 + 백과 톤).
      * 자연/빛/손/뒷모습/상징적 사물 선호.
  - 실패(키 없음·네트워크·파싱)해도 예외를 던지지 않고 카테고리 기본 검색어로 폴백.
    → images_v2 가 다시 Pexels 실패 시 카테고리 기본 이미지로 폴백하므로 2중 안전망.

DEEPSEEK_API_KEY / DEEPSEEK_MODEL 은 backend/.env 또는 환경변수에서 읽는다(fetch.py 방식).
"""
import os
import json
import urllib.request
from pathlib import Path

try:
    from images import CATEGORY_QUERY
except Exception:  # 단독 실행 대비
    CATEGORY_QUERY = {}

DEFAULT_QUERY = "abstract calm background soft light"
API_URL = "https://api.deepseek.com/chat/completions"

GUIDE = (
    "You pick calming, abstract stock-photo search keywords for a Korean addiction "
    "encyclopedia video. Rules: (1) prefer abstract, calm, tasteful imagery; "
    "(2) NEVER depict drugs, syringes, pills close-up, alcohol/drinking, smoking, or "
    "any explicit substance use (YouTube policy + encyclopedic tone); "
    "(3) prefer nature, light, hands, a person seen from behind, symbolic objects, "
    "textures, cityscapes, calm interiors; "
    "(4) each keyword is 2-4 English words suitable for a stock photo search."
)


def _load_env():
    env_path = Path(__file__).resolve().parents[2] / "backend" / ".env"
    conf = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            conf[k.strip()] = v.strip().strip('"').strip("'")
    return conf


def _api_key():
    return (os.environ.get("DEEPSEEK_API_KEY")
            or _load_env().get("DEEPSEEK_API_KEY", "")).strip()


def _model():
    return (os.environ.get("DEEPSEEK_MODEL")
            or _load_env().get("DEEPSEEK_MODEL", "deepseek-chat")).strip() or "deepseek-chat"


def _fallback(item, n):
    cat = item.get("category", "")
    q = CATEGORY_QUERY.get(cat, DEFAULT_QUERY)
    return [q] * n


def _parse_keywords(content, n):
    """모델 응답에서 검색어 리스트(길이 n) 추출."""
    txt = (content or "").strip()
    # ```json ... ``` 코드펜스 제거
    if txt.startswith("```"):
        txt = txt.strip("`")
        if txt.lower().startswith("json"):
            txt = txt[4:]
    # 배열 부분만 잘라 파싱 시도
    start = txt.find("[")
    end = txt.rfind("]")
    kws = None
    if start != -1 and end != -1 and end > start:
        try:
            arr = json.loads(txt[start:end + 1])
            if isinstance(arr, list):
                kws = [str(x).strip() for x in arr if str(x).strip()]
        except Exception:
            kws = None
    if not kws:
        # 줄 단위 폴백
        kws = [ln.strip(" -*0123456789.").strip() for ln in txt.splitlines()]
        kws = [k for k in kws if k]
    if not kws:
        return None
    # 길이 정규화
    if len(kws) < n:
        kws = kws + [kws[-1]] * (n - len(kws))
    return kws[:n]


def scene_keywords(item, scenes, timeout=40):
    """항목 + 장면들 → 장면 수만큼의 영어 검색어 리스트 (DeepSeek 1회)."""
    n = len(scenes)
    if n == 0:
        return []
    key = _api_key()
    if not key:
        return _fallback(item, n)

    lines = []
    for i, sc in enumerate(scenes):
        lines.append(f"{i+1}. layer={sc.get('kind','body')} title={sc.get('title','')}")
    user = (
        f"Encyclopedia term (Korean): {item.get('term_ko','')} "
        f"(English: {item.get('term_en','')}), category: {item.get('category','')}.\n"
        f"Definition: {(item.get('definition') or '')[:300]}\n\n"
        f"There are {n} scenes in the video, in order:\n" + "\n".join(lines) + "\n\n"
        f"Return ONLY a JSON array of exactly {n} English stock-photo search keywords, "
        f"one per scene, in the same order. No prose, no explanation."
    )
    body = json.dumps({
        "model": _model(),
        "messages": [
            {"role": "system", "content": GUIDE},
            {"role": "user", "content": user},
        ],
        "temperature": 0.4,
        "max_tokens": 400,
    }).encode("utf-8")
    req = urllib.request.Request(
        API_URL, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
        content = data["choices"][0]["message"]["content"]
        kws = _parse_keywords(content, n)
        if not kws:
            return _fallback(item, n)
        return kws
    except Exception as e:
        print(f"  [scene_keywords] DeepSeek 실패 → 카테고리 폴백:", e)
        return _fallback(item, n)


if __name__ == "__main__":
    demo_item = {"term_ko": "12단계 프로그램", "term_en": "Twelve-step program",
                 "category": "recovery", "definition": "회복 공동체의 12단계 접근."}
    demo_scenes = [{"kind": "body", "title": "정의"},
                   {"kind": "advanced", "title": "기전"},
                   {"kind": "outro", "title": "중독뉴스"}]
    print(scene_keywords(demo_item, demo_scenes))

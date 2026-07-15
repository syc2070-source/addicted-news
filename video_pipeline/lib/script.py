"""
script.py — 백과 항목 dict → 낭독 대본 + 챕터 구조.

확정 규칙:
  - definition 스킵 (body와 중복)
  - example 포함하되 "예:" 접두어 제거, 별도 챕터 없이 본문 흐름에 자연스럽게 이어붙임
  - 소제목(h)은 낭독하지 않음 → 화면 챕터/자막 타이틀로만 사용
  - 모든 항목 끝에 아웃트로(사이트 안내) 한 줄
"""
import re

# 아웃트로: 낭독은 사이트 주소를 한글 발음으로(TTS가 깨지지 않게),
# 자막/화면은 실제 주소로 보이게 pronounce 역치환이 처리한다.
OUTRO_TEXT = "더 많은 중독 정보는 중독뉴스, addictionnews.net에서 확인하세요."


def _clean(t):
    if not t:
        return ""
    t = t.replace("\u200b", "").strip()
    t = re.sub(r"[ \t]+", " ", t)
    return t


def _strip_example_prefix(t):
    """'예:', '예 :', '예)', '예시:' 등 앞머리 제거."""
    t = _clean(t)
    t = re.sub(r"^\s*(예시|예)\s*[:：)\.]\s*", "", t)
    return t.strip()


def build_script(item):
    """항목 dict → (chapters, full_text)."""
    chapters = []

    body = item.get("body", [])
    for idx, sec in enumerate(body):
        p = _clean(sec.get("p"))
        if not p:
            continue
        chapters.append({
            "title": _clean(sec.get("h")) or item["term_ko"],
            "text": p,
            "kind": "body",
        })

    # example: "예:" 떼고 본문 마지막 챕터에 이어붙임(별도 챕터 X)
    ex = _strip_example_prefix(item.get("example"))
    if ex:
        if chapters:
            chapters[-1]["text"] = chapters[-1]["text"].rstrip() + " " + ex
        else:
            chapters.append({"title": item["term_ko"], "text": ex, "kind": "body"})

    # 심화(advanced)
    for sec in item.get("advanced", []):
        p = _clean(sec.get("p"))
        if not p:
            continue
        chapters.append({
            "title": _clean(sec.get("h")) or "심화",
            "text": p,
            "kind": "advanced",
        })

    # 아웃트로 — 모든 항목 끝에 사이트 안내 (과하지 않게 한 줄)
    chapters.append({
        "title": "중독뉴스",
        "text": OUTRO_TEXT,
        "kind": "outro",
    })

    full_text = "\n".join(c["text"] for c in chapters)
    return chapters, full_text


if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from fetch import fetch_one
    tid = sys.argv[1] if len(sys.argv) > 1 else "twelve-step"
    item = fetch_one(tid)
    chapters, full = build_script(item)
    print(f"=== {item['term_ko']} : {len(chapters)} 챕터, 낭독 {len(full)}자 ===")
    for i, c in enumerate(chapters):
        print(f"[{i}] ({c['kind']}) {c['title']}  — {len(c['text'])}자")

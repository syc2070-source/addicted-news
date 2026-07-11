# -*- coding: utf-8 -*-
"""Extract en_behavioral_manual.json from agent transcript or user paste."""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).with_name("en_behavioral_manual.json")
EXPECTED = {
    "behavioral-addiction",
    "compulsive-computer-use",
    "compulsive-shopping",
    "crypto-trading-addiction",
    "cybersex-addiction",
    "exercise-addiction",
    "food-addiction",
    "gaming-disorder",
    "hypersexuality",
    "loot-boxes",
    "online-gambling",
    "pathological-gambling",
    "sexual-addiction",
    "short-form-video",
    "smartphone-addiction",
    "social-media-addiction",
    "work-addiction",
}

TRANSCRIPT = Path(
    r"C:\Users\Song\.cursor\projects\c-statory-qaicle-v2-recovery"
    r"\agent-transcripts\227db6b2-453c-4e11-8689-9bbd085a08db"
    r"\227db6b2-453c-4e11-8689-9bbd085a08db.jsonl"
)


def try_parse_object(s: str, start: int):
    """Parse JSON object starting at start index; return (obj, end) or None."""
    if start < 0 or start >= len(s) or s[start] != "{":
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                chunk = s[start : i + 1]
                try:
                    return json.loads(chunk), i + 1
                except json.JSONDecodeError:
                    return None
    return None


def extract_from_text(text: str):
    # Prefer the marker phrase from Claude manual
    needle = '"behavioral-addiction"'
    pos = 0
    candidates = []
    while True:
        idx = text.find(needle, pos)
        if idx < 0:
            break
        # walk back to nearest {
        start = text.rfind("{", 0, idx)
        if start >= 0:
            parsed = try_parse_object(text, start)
            if parsed:
                obj, _ = parsed
                if isinstance(obj, dict) and "behavioral-addiction" in obj:
                    keys = set(obj.keys())
                    if "definition_en" in obj.get("behavioral-addiction", {}):
                        candidates.append(obj)
                    elif all(k in EXPECTED for k in keys) and "definition_en" in next(iter(obj.values()), {}):
                        candidates.append(obj)
        pos = idx + 1
    # pick the one with most expected keys
    best = None
    best_n = 0
    for obj in candidates:
        n = len(set(obj.keys()) & EXPECTED)
        if n > best_n:
            best = obj
            best_n = n
    return best, best_n


def main():
    if not TRANSCRIPT.exists():
        print("transcript missing", TRANSCRIPT, file=sys.stderr)
        sys.exit(1)
    best = None
    best_n = 0
    with TRANSCRIPT.open(encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            if "behavioral-addiction" not in line or "definition_en" not in line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            # flatten all string leaves
            texts = []

            def walk(o):
                if isinstance(o, str):
                    texts.append(o)
                elif isinstance(o, dict):
                    for v in o.values():
                        walk(v)
                elif isinstance(o, list):
                    for v in o:
                        walk(v)

            walk(rec)
            for t in texts:
                if "behavioral-addiction" not in t or "definition_en" not in t:
                    continue
                obj, n = extract_from_text(t)
                if obj and n > best_n:
                    best, best_n = obj, n
                    print(f"candidate line {line_no}: {n} keys")

    if not best or best_n < 17:
        print(f"FAIL: best keys={best_n}", file=sys.stderr)
        if best:
            print("got:", sorted(best.keys()), file=sys.stderr)
        sys.exit(1)

    # keep only expected
    out = {k: best[k] for k in sorted(EXPECTED) if k in best}
    if len(out) != 17:
        print(f"incomplete {len(out)}", file=sys.stderr)
        sys.exit(1)
    # validate structure
    for k, v in out.items():
        for field in ("definition_en", "example_en", "body_en", "advanced_en"):
            if field not in v:
                print(f"{k} missing {field}", file=sys.stderr)
                sys.exit(1)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK wrote {OUT} with {len(out)} entries")


if __name__ == "__main__":
    main()

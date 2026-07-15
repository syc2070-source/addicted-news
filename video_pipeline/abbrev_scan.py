"""
abbrev_scan.py — 백과 172개 영어 약어 전수 조사 (read-only).
실행: cd video_pipeline && python abbrev_scan.py
출력: abbrev_report.txt
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from fetch import _connect  # noqa: E402

# DSM-5, ICD-11 등 하이픈+숫자 조합 우선, 그다음 순수 대문자 약어
ABBR_RE = re.compile(
    r"(?<![A-Za-z0-9])"
    r"(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]{1,})"
    r"(?![A-Za-z0-9])"
)


def _jsonb(val):
    if val is None:
        return []
    if isinstance(val, list):
        return val
    try:
        return json.loads(val)
    except Exception:
        return []


def _text_chunks(row):
    """항목 1행에서 조사 대상 텍스트 조각 목록."""
    chunks = []
    for field in ("term_ko", "definition", "example"):
        t = (row.get(field) or "").strip()
        if t:
            chunks.append(t)
    for key in ("body", "advanced"):
        for sec in _jsonb(row.get(key)):
            if not isinstance(sec, dict):
                continue
            for sub in ("h", "p"):
                t = (sec.get(sub) or "").strip()
                if t:
                    chunks.append(t)
    return chunks


def _context_snippet(text, abbr, width=36):
    """약어가 들어 있는 맥락 한 줄."""
    text = re.sub(r"\s+", " ", text).strip()
    pos = text.find(abbr)
    if pos < 0:
        pos = text.upper().find(abbr)
    if pos < 0:
        return text[:width] + ("…" if len(text) > width else "")
    start = max(0, pos - 12)
    end = min(len(text), pos + len(abbr) + 20)
    snippet = text[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet = snippet + "…"
    return snippet


def main():
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, term_ko, definition, example, body, advanced
                FROM encyclopedia_terms
                WHERE published = true
                ORDER BY id
                """
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            entries = [dict(zip(cols, r)) for r in rows]

    freq = defaultdict(int)
    first_id = {}
    first_ctx = {}

    for row in entries:
        tid = row["id"]
        for chunk in _text_chunks(row):
            found = set()
            for m in ABBR_RE.finditer(chunk):
                abbr = m.group(0)
                if abbr.isdigit():
                    continue
                found.add(abbr)
            for abbr in found:
                freq[abbr] += 1
                if abbr not in first_id:
                    first_id[abbr] = tid
                    first_ctx[abbr] = _context_snippet(chunk, abbr)

    ranked = sorted(freq.items(), key=lambda x: (-x[1], x[0]))
    out_path = Path(__file__).resolve().parent / "abbrev_report.txt"
    lines = [f"# 백과 영어 약어 전수 조사 (총 {len(ranked)}종, 항목 {len(entries)}개)"]
    lines.append(f"{'약어':<14}{'빈도':<8}{'예시항목':<28}(맥락 한 줄)")
    for abbr, count in ranked:
        eid = first_id[abbr]
        ctx = first_ctx[abbr]
        lines.append(f"{abbr:<14}{count:<8}{eid:<28}{ctx}")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"저장: {out_path} ({len(ranked)}종)")
    print(out_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()

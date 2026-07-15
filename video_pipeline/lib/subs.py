"""
subs.py — 단어 타임스탬프(word_marks) → SRT 자막.

[수정] 문장 완결 단위로 자막을 끊는다.
  - 원칙: 문장 종결 부호(. ! ?)에서 한 자막을 마감.
  - 한 문장이 너무 길면(> MAX_CHARS) 쉼표(,)에서만 보조 분할.
  - 문장 중간을 글자수로 뚝 끊지 않는다.
"""

MAX_CHARS = 40          # 이보다 긴 문장만 쉼표에서 보조 분할
END_PUNCT = ".!?。！？"   # 문장 종결
SOFT_PUNCT = ",，、;:"    # 보조 분할(긴 문장일 때만)

# 자막 표시용 역치환: 음성용 발음 → 원문 약어
try:
    from pronounce import ABBR, COMPOUND_READ2ORIG
    _READ2ABBR = {v: k for k, v in ABBR.items()}
except Exception:
    _READ2ABBR = {}
    COMPOUND_READ2ORIG = {}


def _restore_abbr(text):
    # 복합형 먼저(긴 발음부터) — "디에스엠 5" → "DSM-5"
    for read in sorted(COMPOUND_READ2ORIG, key=len, reverse=True):
        text = text.replace(read, COMPOUND_READ2ORIG[read])
    # 이니셜리즘 — "에이에이" → "AA"
    for read, abbr in _READ2ABBR.items():
        text = text.replace(read, abbr)
    return text


def _fmt(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def group_marks(marks):
    """word_marks → [ {start, end, text} ]. 문장 단위 우선, 긴 문장만 쉼표 분할."""
    lines = []
    cur = []
    cur_len = 0
    for m in marks:
        w = m["word"]
        cur.append(m)
        cur_len += len(w)
        last = w[-1] if w else ""
        if last in END_PUNCT:
            lines.append(cur); cur = []; cur_len = 0
        elif last in SOFT_PUNCT and cur_len >= MAX_CHARS:
            lines.append(cur); cur = []; cur_len = 0
    if cur:
        lines.append(cur)

    out = []
    for grp in lines:
        text = " ".join(x["word"] for x in grp).strip()
        if not text:
            continue
        text = _restore_abbr(text)      # 자막엔 원문 약어로 표시
        out.append({"start": grp[0]["start"], "end": grp[-1]["end"], "text": text})
    return out


def write_srt(marks, out_srt):
    lines = group_marks(marks)
    with open(out_srt, "w", encoding="utf-8") as f:
        for i, ln in enumerate(lines, 1):
            f.write(f"{i}\n")
            f.write(f"{_fmt(ln['start'])} --> {_fmt(ln['end'])}\n")
            f.write(ln["text"] + "\n\n")
    return len(lines)


if __name__ == "__main__":
    demo = [
        {"word":"중독은","start":0.0,"end":0.5},{"word":"통제력을","start":0.5,"end":1.0},
        {"word":"잃고","start":1.0,"end":1.4},{"word":"반복하게","start":1.4,"end":1.9},
        {"word":"되는","start":1.9,"end":2.2},{"word":"상태입니다.","start":2.2,"end":2.9},
        {"word":"뇌의","start":2.9,"end":3.2},{"word":"보상","start":3.2,"end":3.5},
        {"word":"회로가","start":3.5,"end":3.9},{"word":"변한다.","start":3.9,"end":4.4},
    ]
    n = write_srt(demo, "sample.srt")
    print("SRT 줄 수:", n)
    print(open("sample.srt", encoding="utf-8").read())

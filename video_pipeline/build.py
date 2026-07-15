"""
build.py — 중독백과 영상 파이프라인 메인.

사용법 (C:\addicted-news\video_pipeline\ 에서):
  python build.py twelve-step        # 한 항목만 (샘플)
  python build.py --all              # 172개 전체 배치
  python build.py --all --limit 5    # 앞 5개만 (테스트)
  python build.py --all --resume     # 이미 만든 video/{id}.mp4 는 건너뜀

4단계: fetch → script → tts(음성·타임스탬프) → subs(SRT) → render(MP4)
음성 교체 시 lib/tts.py 의 synth() 만 바꾸면 나머지는 그대로.
"""
import sys
import os
import argparse
import traceback
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE / "lib"))

from fetch import fetch_one, fetch_all_ids          # noqa
from script import build_script                     # noqa
from tts import synth                               # noqa
from subs import write_srt                          # noqa
from images import get_background                   # noqa
from render import render                           # noqa

DIRS = {k: BASE / k for k in ["scripts", "audio", "subs", "images", "video"]}
for d in DIRS.values():
    d.mkdir(exist_ok=True)


def build_one(term_id, resume=False):
    out_mp4 = DIRS["video"] / f"{term_id}.mp4"
    if resume and out_mp4.exists():
        print(f"  건너뜀(이미 있음): {term_id}")
        return True

    item = fetch_one(term_id)
    if not item:
        print(f"  [!] 항목 없음: {term_id}")
        return False

    # 1) 대본
    chapters, full_text = build_script(item)
    if not full_text.strip():
        print(f"  [!] 대본 비어있음: {term_id}")
        return False
    (DIRS["scripts"] / f"{term_id}.txt").write_text(full_text, encoding="utf-8")

    # 2) 음성 + 타임스탬프  [교체 지점]
    audio = DIRS["audio"] / f"{term_id}.mp3"
    marks = synth(full_text, str(audio))

    # 3) 자막
    srt = DIRS["subs"] / f"{term_id}.srt"
    n_lines = write_srt(marks, str(srt))

    # 4) 배경 + 렌더
    bg = DIRS["images"] / f"{term_id}.jpg"
    get_background(item, str(bg))
    _, dur = render(str(bg), str(audio), str(srt), item["term_ko"], str(out_mp4))

    print(f"  ✓ {term_id} | {item['term_ko']} | {len(chapters)}챕터 "
          f"| 자막 {n_lines}줄 | {dur:.0f}초 → {out_mp4.name}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("term_id", nargs="?", help="단일 항목 id (예: twelve-step)")
    ap.add_argument("--all", action="store_true", help="172개 전체")
    ap.add_argument("--limit", type=int, default=0, help="--all 시 앞 N개만")
    ap.add_argument("--resume", action="store_true", help="이미 만든 건 건너뜀")
    args = ap.parse_args()

    if args.all:
        ids = fetch_all_ids()
        if args.limit:
            ids = ids[: args.limit]
        print(f"=== 배치 시작: {len(ids)}개 ===")
        ok = fail = 0
        for i, tid in enumerate(ids, 1):
            print(f"[{i}/{len(ids)}] {tid}")
            try:
                if build_one(tid, resume=args.resume):
                    ok += 1
                else:
                    fail += 1
            except Exception:
                fail += 1
                print(f"  [x] 실패: {tid}")
                traceback.print_exc()
        print(f"=== 완료: 성공 {ok} / 실패 {fail} ===")
    elif args.term_id:
        build_one(args.term_id, resume=args.resume)
    else:
        print("사용법: python build.py twelve-step  또는  python build.py --all")


if __name__ == "__main__":
    main()

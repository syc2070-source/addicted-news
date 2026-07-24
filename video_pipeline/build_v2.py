"""
build_v2.py — 중독백과 영상 파이프라인 v2 (다중 배경 전환 + 여성 음성).

기존 build.py 를 대체하지 않고 추가(add-only). 대본(scripts/)은 그대로 재사용하고
음성/자막/배경/영상만 v2 로 재생성한다.

흐름:
  fetch → script(챕터) → 챕터별 TTS(길이 측정) → 오디오 이어붙이기 + 마크 오프셋
        → SRT → 장면 분할(scenes) → 장면 검색어(DeepSeek 1회) → 장면별 배경(images_v2)
        → 크로스페이드 렌더(render_v2)

사용법 (video_pipeline/ 에서):
  python build_v2.py twelve-step          # 샘플 1편
  python build_v2.py --all                # 전체 배치
  python build_v2.py --all --limit 5      # 앞 5개
  python build_v2.py --all --resume       # video_v2/{id}.mp4 있으면 건너뜀

음성은 lib/tts.py 의 VOICE(기본 ko-KR-SunHiNeural, 여성)를 사용.
"""
import sys
import os
import argparse
import traceback
import json
import subprocess
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE / "lib"))

from fetch import fetch_one, fetch_all_ids          # noqa
from script import build_script                     # noqa
from tts import synth                               # noqa
from subs import write_srt                          # noqa
from scenes import build_scenes, layer_toc          # noqa
from scene_keywords import scene_keywords           # noqa
from images_v2 import get_scene_backgrounds         # noqa
from render_v2 import render_multi                  # noqa
from render import _audio_dur                       # noqa

# v2 산출물은 별도 폴더에 두어 기존 v1 결과를 덮지 않는다.
DIRS = {
    "scripts": BASE / "scripts",       # 대본은 기존 것 재사용/저장
    "audio":   BASE / "audio_v2",
    "subs":    BASE / "subs_v2",
    "images":  BASE / "images",        # images/{id}/{n}.jpg (v1 {id}.jpg 와 공존)
    "video":   BASE / "video_v2",
}
for d in DIRS.values():
    d.mkdir(exist_ok=True)


def _ffmpeg():
    return shutil.which("ffmpeg") or "ffmpeg"


def _concat_audio(mp3_list, out_mp3):
    """여러 mp3 를 하나로 이어붙임(concat 필터 재인코딩 — 컨테이너 타이밍 안전)."""
    if len(mp3_list) == 1:
        shutil.copyfile(mp3_list[0], out_mp3)
        return out_mp3
    cmd = [_ffmpeg(), "-y"]
    for m in mp3_list:
        cmd += ["-i", str(m)]
    n = len(mp3_list)
    inputs = "".join(f"[{i}:a]" for i in range(n))
    cmd += [
        "-filter_complex", f"{inputs}concat=n={n}:v=0:a=1[a]",
        "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "3",
        str(out_mp3),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError("오디오 concat 실패:\n" + (r.stderr or r.stdout or "")[-2000:])
    return out_mp3


def _synth_chapters(chapters, term_id):
    """챕터별 개별 TTS → (합친 오디오 경로, 오프셋 적용된 marks, 챕터별 길이 리스트)."""
    tmp_dir = DIRS["audio"] / f"_{term_id}_parts"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    part_paths = []
    all_marks = []
    durs = []
    offset = 0.0
    for i, ch in enumerate(chapters):
        text = ch["text"].strip()
        if not text:
            durs.append(0.0)
            continue
        part = tmp_dir / f"{i}.mp3"
        marks = synth(text, str(part))
        d = _audio_dur(str(part)) or 0.0
        for m in marks:
            all_marks.append({
                "word": m["word"],
                "start": round(m["start"] + offset, 3),
                "end": round(m["end"] + offset, 3),
            })
        offset += d
        durs.append(d)
        part_paths.append(str(part))

    audio_out = DIRS["audio"] / f"{term_id}.mp3"
    _concat_audio(part_paths, str(audio_out))
    return str(audio_out), all_marks, durs


def build_one_v2(term_id, resume=False):
    out_mp4 = DIRS["video"] / f"{term_id}.mp4"
    if resume and out_mp4.exists():
        print(f"  건너뜀(이미 있음): {term_id}")
        return True

    item = fetch_one(term_id)
    if not item:
        print(f"  [!] 항목 없음: {term_id}")
        return False

    # 1) 대본 (기존 것 재사용 — 없으면 생성해 저장)
    chapters, full_text = build_script(item)
    if not full_text.strip():
        print(f"  [!] 대본 비어있음: {term_id}")
        return False
    (DIRS["scripts"] / f"{term_id}.txt").write_text(full_text, encoding="utf-8")

    # 2) 챕터별 음성 → 이어붙이기 + 마크 오프셋 (여성 음성)
    audio, marks, chap_durs = _synth_chapters(chapters, term_id)

    # 3) 자막
    srt = DIRS["subs"] / f"{term_id}.srt"
    n_lines = write_srt(marks, str(srt))

    # 4) 장면 분할(층 경계 + 60초 문단 분할, 최소 3장면)
    scenes = build_scenes(chapters, chap_durs)

    # 5) 장면 검색어(DeepSeek 1회) → 6) 장면별 배경(images/{id}/{n}.jpg)
    kw_res = scene_keywords(item, scenes)
    keywords = kw_res["keywords"]
    if kw_res["source"] != "deepseek":
        print(f"  [경고] 장면 검색어 폴백({kw_res['reason']}) — 배경이 단조로울 수 있음")
    img_dir = DIRS["images"] / term_id
    src = get_scene_backgrounds(item, scenes, keywords, str(img_dir))
    bg_imgs = src["paths"]
    scene_durs = [sc["dur"] for sc in scenes]

    # 6-1) 조용한 폴백 금지: 소스 요약 출력 + 절반 이상 폴백이면 중단
    print(f"  [배경] 실사진 {len(scenes) - src['fallbacks']}/{len(scenes)} "
          f"· 폴백 {src['fallbacks']} · Pexels키 {'있음' if src['key'] else '없음'}")
    for i, (p, s, r) in enumerate(zip(bg_imgs, src["sources"], src["reasons"])):
        tag = "OK " if s.startswith("pexels") else "폴백"
        try:
            sz = os.path.getsize(p)
        except OSError:
            sz = -1
        print(f"      장면{i}: {tag} {s} · {sz:,}B" + (f"  ← {r}" if r else ""))
    # 서로 다른 사진인지 즉시 확인용: 고유 파일크기 수
    try:
        uniq = len({os.path.getsize(p) for p in bg_imgs})
        print(f"      고유 파일크기 {uniq}/{len(bg_imgs)} "
              f"({'서로 다름' if uniq == len(bg_imgs) else '중복 있음'})")
    except OSError:
        pass
    allow_fallback = os.environ.get("ALLOW_GRADIENT_FALLBACK", "").strip() in ("1", "true", "yes")
    if src["fallbacks"] * 2 >= len(scenes) and not allow_fallback:
        raise RuntimeError(
            f"배경 소싱 실패: {len(scenes)}장면 중 {src['fallbacks']}장면이 그라디언트 폴백. "
            f"(Pexels키 {'있음' if src['key'] else '없음'}) 위 장면별 사유 확인. "
            "의도적으로 그라디언트를 쓰려면 ALLOW_GRADIENT_FALLBACK=1 로 재실행."
        )

    # 7) 크로스페이드 렌더
    _, dur = render_multi(bg_imgs, scene_durs, audio, str(srt),
                          item["term_ko"], str(out_mp4))

    # 8) 업로드용 사이드카(video_v2/{id}.json): 목차 타임스탬프 + 메타
    meta = {
        "id": term_id,
        "term_ko": item.get("term_ko", ""),
        "term_en": item.get("term_en", ""),
        "category": item.get("category", ""),
        "definition": item.get("definition", "") or "",
        "duration": round(dur or 0.0, 3),
        "toc": layer_toc(chapters, chap_durs),
        "scenes": [{"index": sc["index"], "kind": sc["kind"],
                    "start": sc["start"], "dur": sc["dur"]} for sc in scenes],
    }
    (DIRS["video"] / f"{term_id}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"  ✓ {term_id} | {item['term_ko']} | {len(scenes)}장면 "
          f"| 자막 {n_lines}줄 | {dur:.0f}초 → {out_mp4}")
    for sc, kw in zip(scenes, keywords):
        print(f"      장면{sc['index']} [{sc['kind']}] {sc['dur']:.0f}s  «{kw}»")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("term_id", nargs="?", help="단일 항목 id (예: twelve-step)")
    ap.add_argument("--all", action="store_true", help="전체 배치")
    ap.add_argument("--limit", type=int, default=0, help="--all 시 앞 N개만")
    ap.add_argument("--resume", action="store_true", help="이미 만든 건 건너뜀")
    args = ap.parse_args()

    if args.all:
        ids = fetch_all_ids()
        if args.limit:
            ids = ids[: args.limit]
        total = len(ids)
        print(f"=== v2 배치 시작: {total}개 ===")
        ok = 0
        failures = []
        for i, tid in enumerate(ids, 1):
            print(f"[완료 {i-1}/{total}] 진행: {tid}")
            try:
                if build_one_v2(tid, resume=args.resume):
                    ok += 1
                else:
                    failures.append((tid, "대본/항목 없음"))
            except Exception as e:
                failures.append((tid, str(e).splitlines()[0] if str(e) else "예외"))
                print(f"  [x] 실패: {tid}")
                traceback.print_exc()
        print(f"\n=== v2 완료: 성공 {ok}/{total} · 실패 {len(failures)} ===")
        if failures:
            print("실패 목록:")
            for tid, why in failures:
                print(f"  - {tid}: {why}")
    elif args.term_id:
        build_one_v2(args.term_id, resume=args.resume)
    else:
        print("사용법: python build_v2.py twelve-step  또는  python build_v2.py --all")


if __name__ == "__main__":
    main()

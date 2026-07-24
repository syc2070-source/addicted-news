"""
render_v2.py — 여러 배경 이미지(장면) + 음성(mp3) + 자막(SRT) → 1920×1080 MP4. (v2 지시서 1-1)

기존 render.py 를 대체하지 않고 추가:
  - 장면마다 다른 배경 이미지를 순서대로 배치.
  - 장면 경계에서 0.5초 크로스페이드(ffmpeg xfade). 컷 전환 없음.
  - 자막 하드섭 + 상단 제목 drawtext 는 render.py 와 동일 스타일.

크로스페이드 오프셋 수식:
  각 이미지 i 를 (d_i + T) 초 로 로드(T=전환시간). xfade 를 체인으로 연결하면
  누적 영상 길이 C_k = C_{k-1} + (d_k + T) - T = C_{k-1} + d_k, 최초 C_0 = d_0 + T.
  전환 k(=1..N-1)의 offset = C_{k-1} - T = (d_0+...+d_{k-1}) = 장면 k 의 시작 시각.
  최종 길이 = ΣD + T (오디오보다 T 만큼 김) → -shortest 로 오디오 길이에 맞춰 잘림.
"""
import subprocess
import shutil
import os

from render import (
    W, H, _font, _ffmpeg, _escape_filter_path, _run, _audio_dur,
)

TRANSITION = 0.5   # 크로스페이드 길이(초)


def _subtitle_filter(srt_path):
    force_style = (
        "FontName=Malgun Gothic,Fontsize=17,PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,"
        "Alignment=2,MarginV=70"
    )
    return f"subtitles='{_escape_filter_path(srt_path)}':force_style='{force_style}'"


def _title_filter(title, font):
    safe_title = title.replace(":", "\\:").replace("'", "’")
    return (
        f"drawtext=fontfile='{_escape_filter_path(font)}':text='{safe_title}':"
        f"fontcolor=white:fontsize=54:borderw=2:bordercolor=black@0.7:"
        f"x=(w-text_w)/2:y=70"
    )


def _single(bg_img, audio_mp3, srt_path, title, out_mp4, dur, font):
    """장면 1개면 render.py 와 동일한 단일 이미지 렌더."""
    vf = [f"scale={W}:{H}", _subtitle_filter(srt_path)]
    if font:
        vf.insert(1, _title_filter(title, font))
    cmd = [
        _ffmpeg(), "-y",
        "-loop", "1", "-i", str(bg_img),
        "-i", str(audio_mp3),
        "-vf", ",".join(vf),
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-shortest", "-r", "30",
        str(out_mp4),
    ]
    r = _run(cmd)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg 실패:\n" + (r.stderr or r.stdout or "")[-2000:])
    return out_mp4, dur


def render_multi(bg_imgs, scene_durs, audio_mp3, srt_path, title, out_mp4):
    """여러 배경 이미지 → 크로스페이드 슬라이드 + 음성 + 자막 + 제목."""
    font = _font()
    dur = _audio_dur(audio_mp3)
    n = len(bg_imgs)

    if n <= 1:
        bg = bg_imgs[0] if bg_imgs else None
        return _single(bg, audio_mp3, srt_path, title, out_mp4, dur, font)

    T = TRANSITION
    # 입력: 각 이미지를 (d_i + T) 초 로 로드
    cmd = [_ffmpeg(), "-y"]
    for img, d in zip(bg_imgs, scene_durs):
        length = max(float(d), 0.1) + T
        cmd += ["-loop", "1", "-t", f"{length:.3f}", "-i", str(img)]
    cmd += ["-i", str(audio_mp3)]   # 마지막 입력 = 오디오

    fc = []
    # 각 비디오 스트림 정규화
    for i in range(n):
        fc.append(f"[{i}:v]scale={W}:{H},setsar=1,fps=30,format=yuv420p[v{i}]")

    # xfade 체인 — offset_k = 장면 k 시작 시각(누적 d)
    cum = 0.0
    prev = "v0"
    for k in range(1, n):
        cum += float(scene_durs[k - 1])
        out_label = f"x{k}" if k < n - 1 else "vx"
        fc.append(
            f"[{prev}][v{k}]xfade=transition=fade:duration={T}:"
            f"offset={cum:.3f}[{out_label}]"
        )
        prev = out_label

    # 자막 + 제목을 최종 비디오에 적용
    post = [_subtitle_filter(srt_path)]
    if font:
        post.insert(0, _title_filter(title, font))
    fc.append(f"[vx]{','.join(post)}[vout]")

    audio_idx = n  # 오디오 입력 인덱스
    cmd += [
        "-filter_complex", ";".join(fc),
        "-map", "[vout]", "-map", f"{audio_idx}:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-shortest", "-r", "30",
        str(out_mp4),
    ]
    r = _run(cmd)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg(xfade) 실패:\n" + (r.stderr or r.stdout or "")[-2500:])
    return out_mp4, dur


if __name__ == "__main__":
    print("render_v2 self-check: font=", _font(), "ffmpeg=", _ffmpeg())

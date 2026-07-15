"""
render.py — 배경 이미지 + 음성(mp3) + 자막(SRT) → 1920×1080 MP4.

- 정지 이미지를 음성 길이만큼 늘려 배경으로.
- 자막은 ffmpeg subtitles 필터로 화면에 구움(하드섭). 한글 폰트 지정.
- 상단에 항목 제목을 고정 표시(drawtext).
"""
import subprocess
import shutil
import os
from pathlib import Path

W, H = 1920, 1080

# 한글 폰트: Windows 기본 맑은고딕. 없으면 Noto.
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\malgunbd.ttf",
    r"C:\Windows\Fonts\malgun.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]


def _font():
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            return f
    return None


def _ffmpeg():
    return shutil.which("ffmpeg") or "ffmpeg"


def _escape_filter_path(p):
    # ffmpeg 필터 경로: Windows 백슬래시·드라이브 콜론 이스케이프.
    p = str(p).replace("\\", "/")
    p = p.replace(":", "\\:")
    return p


def _run(cmd):
    # Windows cp949 콘솔에서 ffmpeg 한글 로그 디코딩 실패 방지
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _audio_dur(mp3):
    ffprobe = shutil.which("ffprobe") or "ffprobe"
    out = _run(
        [ffprobe,
         "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(mp3)],
    )
    try:
        return float(out.stdout.strip())
    except Exception:
        return None


def render(bg_img, audio_mp3, srt_path, title, out_mp4):
    font = _font()
    dur = _audio_dur(audio_mp3)

    # 자막 스타일: 하단, 흰 글씨 + 검은 외곽선, 큰 글씨
    force_style = (
        "FontName=Malgun Gothic,Fontsize=17,PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,"
        "Alignment=2,MarginV=70"
    )
    sub_filter = f"subtitles='{_escape_filter_path(srt_path)}':force_style='{force_style}'"

    # 제목: 상단 고정
    vf = [f"scale={W}:{H}", sub_filter]
    if font:
        safe_title = title.replace(":", "\\:").replace("'", "\u2019")
        title_draw = (
            f"drawtext=fontfile='{_escape_filter_path(font)}':text='{safe_title}':"
            f"fontcolor=white:fontsize=54:borderw=2:bordercolor=black@0.7:"
            f"x=(w-text_w)/2:y=70"
        )
        vf.insert(1, title_draw)

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
        err = (r.stderr or r.stdout or "")[-2000:]
        raise RuntimeError("ffmpeg 실패:\n" + err)
    return out_mp4, dur


if __name__ == "__main__":
    print("font:", _font())
    print("ffmpeg:", _ffmpeg())

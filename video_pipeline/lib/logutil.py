"""
logutil.py — 콘솔 UTF-8 강제 + 로그 파일(UTF-8) 동시 기록. (v2 정비)

Windows 콘솔(cp949)에서 한글 로그가 깨지거나, PowerShell Tee-Object 로 파일에
남길 때 인코딩이 깨지는 문제를 스크립트 자체에서 해결한다.
  - force_utf8(): sys.stdout/stderr 를 UTF-8 로 재구성(PYTHONIOENCODING 불필요).
  - start_logging(dir): 위 + 화면과 UTF-8 로그 파일에 동시 출력(Tee). 로그 경로 반환.
"""
import sys
import io
from datetime import datetime
from pathlib import Path


def force_utf8():
    """sys.stdout/stderr 를 UTF-8 로 강제(콘솔 한글 깨짐 방지)."""
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # py3.7+
        except Exception:
            try:
                buf = getattr(stream, "buffer", None)
                if buf is not None:
                    setattr(sys, name,
                            io.TextIOWrapper(buf, encoding="utf-8", errors="replace"))
            except Exception:
                pass


class _Tee:
    """여러 스트림에 동시에 쓰는 얇은 래퍼(화면 + 파일)."""
    def __init__(self, *streams):
        self._streams = [s for s in streams if s is not None]

    def write(self, data):
        for s in self._streams:
            try:
                s.write(data)
                s.flush()
            except Exception:
                pass
        return len(data)

    def flush(self):
        for s in self._streams:
            try:
                s.flush()
            except Exception:
                pass


def start_logging(log_dir, prefix="build_v2"):
    """UTF-8 강제 + 화면·파일 동시 기록 시작. 로그 파일 경로 반환."""
    force_utf8()
    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = log_dir / f"{prefix}_{ts}.log"
    f = open(path, "w", encoding="utf-8", buffering=1)  # line-buffered UTF-8
    header = f"# {prefix} log {ts}\n"
    f.write(header)
    sys.stdout = _Tee(sys.stdout, f)
    sys.stderr = _Tee(sys.stderr, f)
    return path

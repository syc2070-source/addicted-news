"""Durable, testable state helpers for the encyclopedia YouTube publisher.

This module deliberately has no Google API or database dependency.  It can be
tested offline and is responsible for the two safety properties that matter
most for a resumable publisher:

* a corrupt state file must never be treated as an empty queue; and
* once a YouTube video id is known, it is persisted atomically before any
  follow-up work is attempted.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


SCHEMA_VERSION = 2
META_KEY = "_meta"
TITLE_SUFFIX = " — 중독백과"


class PublicationStateError(RuntimeError):
    """Raised when publication state is unsafe to use."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _blank_state() -> dict:
    return {META_KEY: {"schema_version": SCHEMA_VERSION}}


def load_state(path: Path) -> dict:
    """Load legacy or v2 state, failing closed on malformed content."""
    if not path.exists():
        return _blank_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise PublicationStateError(
            f"업로드 상태 파일을 읽을 수 없습니다: {path}. "
            "빈 상태로 계속하지 않습니다."
        ) from exc
    if not isinstance(state, dict):
        raise PublicationStateError(f"업로드 상태가 JSON 객체가 아닙니다: {path}")

    meta = state.get(META_KEY)
    if meta is None:
        state[META_KEY] = {"schema_version": SCHEMA_VERSION}
    elif not isinstance(meta, dict):
        raise PublicationStateError("업로드 상태의 _meta가 잘못되었습니다.")
    else:
        version = meta.get("schema_version", 1)
        if not isinstance(version, int) or version > SCHEMA_VERSION:
            raise PublicationStateError(
                f"지원하지 않는 업로드 상태 버전입니다: {version}"
            )
        meta["schema_version"] = SCHEMA_VERSION

    for term_id, record in state.items():
        if term_id == META_KEY:
            continue
        if not isinstance(record, dict):
            raise PublicationStateError(f"상태 레코드가 잘못되었습니다: {term_id}")
        # A legacy video id proves an upload happened, but it does not prove
        # playlist/DB/publication completion.  Reconciliation must do that.
        if record.get("video_id") and not record.get("phase"):
            record["phase"] = "uploaded_unknown"
    return state


def save_state_atomic(path: Path, state: dict) -> None:
    """Save state with fsync + replace, preserving a best-effort backup."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    backup = path.with_name(path.name + ".bak")
    payload = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    try:
        with tmp.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        if path.exists():
            try:
                shutil.copy2(path, backup)
            except OSError:
                # A backup is useful but must never prevent the authoritative
                # state (especially a newly returned YouTube id) from being
                # atomically persisted.
                pass
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


@contextmanager
def state_lock(state_path: Path):
    """Prevent concurrent publishers while allowing stale-file recovery."""
    lock_path = state_path.with_name(state_path.name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = lock_path.open("a+", encoding="utf-8")
    acquired = False
    try:
        if os.name == "nt":
            import msvcrt

            fh.seek(0, os.SEEK_END)
            if fh.tell() == 0:
                fh.write("\0")
                fh.flush()
            fh.seek(0)
            try:
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise PublicationStateError(
                    f"다른 업로드 작업이 실행 중입니다: {lock_path}"
                ) from exc
            acquired = True
        else:
            import fcntl

            try:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise PublicationStateError(
                    f"다른 업로드 작업이 실행 중입니다: {lock_path}"
                ) from exc
            acquired = True

        fh.seek(0)
        fh.truncate()
        fh.write(f"pid={os.getpid()} started_at={utc_now()}\n")
        fh.flush()
        yield
    finally:
        if acquired:
            try:
                if os.name == "nt":
                    import msvcrt

                    fh.seek(0)
                    msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        fh.close()
        if acquired:
            try:
                lock_path.unlink()
            except OSError:
                pass


def records(state: dict):
    return ((k, v) for k, v in state.items() if k != META_KEY)


def expected_title(item: dict) -> str:
    term_ko = (item.get("term_ko") or item.get("id") or "").strip()
    return f"{term_ko}{TITLE_SUFFIX}"[:100]


def load_catalog(
    video_dir: Path,
    expected_count: int | None = None,
    expected_ids_sha256: str | None = None,
) -> dict[str, dict]:
    """Read the complete local v2 catalog without touching the database."""
    catalog: dict[str, dict] = {}
    problems: list[str] = []
    sidecar_paths = sorted(video_dir.glob("*.json"))
    sidecar_stems = {path.stem for path in sidecar_paths}
    for sidecar_path in sidecar_paths:
        try:
            sidecar_before = sidecar_path.stat()
            sidecar_bytes = sidecar_path.read_bytes()
            sidecar_after = sidecar_path.stat()
        except Exception:
            problems.append(f"사이드카 JSON 읽기 실패: {sidecar_path.name}")
            continue
        if (
            sidecar_before.st_size != sidecar_after.st_size
            or sidecar_before.st_mtime_ns != sidecar_after.st_mtime_ns
            or len(sidecar_bytes) != sidecar_after.st_size
        ):
            problems.append(f"카탈로그 로드 중 사이드카 변경: {sidecar_path.name}")
            continue
        try:
            # Parse and fingerprint the exact same byte snapshot so cached
            # metadata can never be paired with a newer on-disk digest.
            item = json.loads(sidecar_bytes.decode("utf-8"))
        except Exception:
            problems.append(f"사이드카 JSON 파싱 실패: {sidecar_path.name}")
            continue
        term_id = str(item.get("id") or "").strip()
        if not term_id or term_id != sidecar_path.stem:
            problems.append(f"사이드카 ID 불일치: {sidecar_path.name}")
            continue
        mp4_path = video_dir / f"{term_id}.mp4"
        if not mp4_path.is_file() or mp4_path.stat().st_size <= 0:
            problems.append(f"영상 누락/빈 파일: {mp4_path.name}")
            continue
        item["_mp4_path"] = mp4_path
        item["_sidecar_path"] = sidecar_path
        item["_loaded_sidecar_sha256"] = hashlib.sha256(sidecar_bytes).hexdigest()
        item["_loaded_sidecar_size_bytes"] = sidecar_after.st_size
        item["_loaded_sidecar_mtime_ns"] = sidecar_after.st_mtime_ns
        catalog[term_id] = item
    for mp4_path in sorted(video_dir.glob("*.mp4")):
        if mp4_path.stem not in sidecar_stems:
            problems.append(f"사이드카 없는 영상: {mp4_path.name}")
    if expected_count is not None and len(catalog) != expected_count:
        problems.append(
            f"고정 카탈로그 수 불일치: 예상 {expected_count}, 현재 {len(catalog)}"
        )
    if expected_ids_sha256 is not None:
        actual_ids_sha256 = hashlib.sha256(
            "\n".join(sorted(catalog)).encode("utf-8")
        ).hexdigest()
        if actual_ids_sha256 != expected_ids_sha256:
            problems.append("고정 카탈로그 ID 인벤토리 지문 불일치")
    if problems:
        raise PublicationStateError("\n".join(problems[:20]))
    if not catalog:
        raise PublicationStateError(f"업로드할 v2 영상을 찾지 못했습니다: {video_dir}")
    return catalog


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_fingerprint(item: dict, base: Path) -> dict:
    mp4_path: Path = item["_mp4_path"]
    sidecar_path: Path = item["_sidecar_path"]
    try:
        relative_path = mp4_path.relative_to(base).as_posix()
    except ValueError:
        relative_path = str(mp4_path)
    mp4_before = mp4_path.stat()
    mp4_sha256 = _sha256(mp4_path)
    mp4_after = mp4_path.stat()
    sidecar_before = sidecar_path.stat()
    sidecar_sha256 = _sha256(sidecar_path)
    sidecar_after = sidecar_path.stat()
    if (
        mp4_before.st_size != mp4_after.st_size
        or mp4_before.st_mtime_ns != mp4_after.st_mtime_ns
        or sidecar_before.st_size != sidecar_after.st_size
        or sidecar_before.st_mtime_ns != sidecar_after.st_mtime_ns
    ):
        raise PublicationStateError("원본 지문 계산 중 파일이 변경되었습니다.")
    if (
        item.get("_loaded_sidecar_sha256") != sidecar_sha256
        or item.get("_loaded_sidecar_size_bytes") != sidecar_after.st_size
        or item.get("_loaded_sidecar_mtime_ns") != sidecar_after.st_mtime_ns
    ):
        raise PublicationStateError(
            "카탈로그 로드 후 사이드카 JSON이 변경되어 업로드를 중단합니다."
        )
    return {
        "relative_path": relative_path,
        "sha256": mp4_sha256,
        "size_bytes": mp4_after.st_size,
        "mtime_ns": mp4_after.st_mtime_ns,
        "duration_ms": int(round(float(item.get("duration") or 0) * 1000)),
        "sidecar_sha256": sidecar_sha256,
        "sidecar_mtime_ns": sidecar_after.st_mtime_ns,
    }


def source_fingerprints_match(expected: dict, actual: dict, strict=False) -> bool:
    fields = (
        "relative_path", "sha256", "size_bytes", "mtime_ns",
        "duration_ms", "sidecar_sha256", "sidecar_mtime_ns",
    )
    if strict and any(field not in expected or field not in actual for field in fields):
        return False
    return all(
        expected.get(field) == actual.get(field)
        for field in fields
        if field in expected
    )


_ISO_DURATION = re.compile(
    r"^P(?:\d+D)?T(?:(?P<h>\d+(?:\.\d+)?)H)?"
    r"(?:(?P<m>\d+(?:\.\d+)?)M)?(?:(?P<s>\d+(?:\.\d+)?)S)?$"
)


def parse_iso8601_duration(value: str) -> float | None:
    match = _ISO_DURATION.match(value or "")
    if not match:
        return None
    hours = float(match.group("h") or 0)
    minutes = float(match.group("m") or 0)
    seconds = float(match.group("s") or 0)
    return hours * 3600 + minutes * 60 + seconds


def candidate_ids(catalog: dict, state: dict, term_id: str | None = None) -> list[str]:
    """Return only items for which no durable YouTube id is known."""
    if term_id:
        if term_id not in catalog:
            raise PublicationStateError(f"로컬 v2 영상이 없습니다: {term_id}")
        record = state.get(term_id) or {}
        if record.get("video_id"):
            raise PublicationStateError(
                f"이미 YouTube ID가 기록된 항목입니다: {term_id} -> {record['video_id']}"
            )
        return [term_id]

    ordered = sorted(catalog, key=lambda key: (catalog[key].get("category") or "", key))
    # A term flagged by reconciliation is skipped (never re-uploaded) so one
    # ambiguous item cannot block or duplicate the rest of the queue.
    return [
        term for term in ordered
        if not (state.get(term) or {}).get("video_id")
        and not (state.get(term) or {}).get("needs_review")
    ]


def merge_db_video_ids(catalog: dict, state: dict, db_video_ids: dict[str, str]):
    """Validate the DB catalog and merge exact links before choosing uploads."""
    adopted: list[str] = []
    conflicts: list[str] = []

    # Publication eventually writes one YouTube id into every encyclopedia row.
    # Verify the complete destination exists before any remote upload/publication
    # can begin, instead of discovering a missing row after a video is public.
    for term_id in sorted(set(catalog) - set(db_video_ids)):
        conflicts.append(f"{term_id}: DB에 백과 항목 행이 없음")

    for term_id, video_id in db_video_ids.items():
        if not video_id:
            continue
        if term_id not in catalog:
            conflicts.append(f"{term_id}: DB YouTube ID에 대응하는 로컬 v2 원본 없음")
            continue
        record = state.get(term_id) or {}
        current = record.get("video_id")
        if current and current != video_id:
            conflicts.append(
                f"{term_id}: 로컬 상태 ID({current})와 DB ID({video_id}) 불일치"
            )
            continue
        if not current:
            record = {
                "video_id": video_id,
                "uploaded_at": utc_now(),
                "phase": "db_adopted_unverified",
                "db": {
                    "status": "already_synced",
                    "video_id": video_id,
                    "checked_at": utc_now(),
                },
            }
            state[term_id] = record
            adopted.append(term_id)
        else:
            record["db"] = {
                "status": "already_synced",
                "video_id": video_id,
                "checked_at": utc_now(),
            }
    return adopted, conflicts


def apply_verified_audit(audit_path: Path, catalog: dict, state: dict, base: Path):
    """Recover the verified initial publication ledger into runtime state."""
    if not audit_path.exists():
        return [], [f"기존 게시 검증 원장 없음: {audit_path}"]
    try:
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise PublicationStateError(f"게시 검증 원장 파싱 실패: {audit_path}") from exc
    if audit.get("status") != "VERIFIED" or not isinstance(audit.get("videos"), list):
        raise PublicationStateError(f"게시 검증 원장이 VERIFIED 형식이 아닙니다: {audit_path}")

    adopted: list[str] = []
    conflicts: list[str] = []
    seen_terms: set[str] = set()
    seen_videos: set[str] = set()
    for audited in audit["videos"]:
        term_id = audited.get("term_id")
        video_id = audited.get("video_id")
        if not term_id or not video_id or term_id not in catalog:
            conflicts.append(f"{term_id or '<missing>'}: 검증 원장 항목 불완전")
            continue
        if term_id in seen_terms or video_id in seen_videos:
            conflicts.append(f"{term_id}: 검증 원장 term/video ID 중복")
            continue
        seen_terms.add(term_id)
        seen_videos.add(video_id)

        item = catalog[term_id]
        local_duration = float(item.get("duration") or 0)
        youtube_duration = parse_iso8601_duration(audited.get("youtube_duration_iso") or "")
        expected_source = audited.get("source") or {}
        try:
            audited_source_duration = float(expected_source.get("duration_seconds"))
        except (TypeError, ValueError):
            audited_source_duration = -1
        if (
            audited.get("title") != expected_title(item)
            or youtube_duration is None
            or abs(youtube_duration - local_duration) > 2.0
            or abs(audited_source_duration - local_duration) > 0.01
            or audited.get("public") is not True
            or audited.get("unlisted") is not False
            or audited.get("playability") != "OK"
            or not audited.get("channel_id")
        ):
            conflicts.append(f"{term_id}: 검증 원장 메타데이터/재생시간 불일치")
            continue
        actual_source = source_fingerprint(item, base)
        if (actual_source["sha256"] != expected_source.get("sha256")
                or actual_source["size_bytes"] != expected_source.get("size_bytes")
                or actual_source["relative_path"] != expected_source.get("path")):
            conflicts.append(f"{term_id}: 검증 원장과 현재 v2 원본 지문 불일치")
            continue
        record = state.get(term_id) or {}
        current = record.get("video_id")
        if current and current != video_id:
            conflicts.append(
                f"{term_id}: 로컬 상태 ID({current})와 검증 원장 ID({video_id}) 불일치"
            )
            continue
        if not current:
            record["video_id"] = video_id
            record["uploaded_at"] = audited.get("upload_date") or utc_now()
            record["phase"] = "audit_adopted"
            state[term_id] = record
            adopted.append(term_id)
        record["channel_id"] = audited.get("channel_id")
        record["source"] = actual_source
        record["source_verification"] = {
            "status": "verified",
            "audit_file": audit_path.name,
            "audited_at": audit.get("audited_at"),
        }
    return adopted, conflicts


def reconcile_remote(
    catalog: dict,
    state: dict,
    remote_videos: list[dict],
    channel_id: str,
    base: Path,
    duration_tolerance: float = 2.0,
) -> tuple[list[str], list[str]]:
    """Adopt remote matches and return (adopted, conflicts).

    Existing video ids are verified by id. Records missing an id may only be
    adopted from videos carrying their stable ``enc-id`` marker whose title and
    duration match the local file (±``duration_tolerance``; while YouTube is
    still processing and reports no duration, the exact byte size stands in).
    Several matches: the earliest upload becomes canonical and the others are
    listed under the record's ``duplicates`` (never deleted or modified).

    Conflicts are per item: the record is flagged ``needs_review`` so
    ``candidate_ids`` skips it, and the caller keeps uploading everything else.
    """
    by_id = {v.get("video_id"): v for v in remote_videos if v.get("video_id")}
    by_title: dict[str, list[dict]] = {}
    by_marker: dict[str, list[dict]] = {}
    for video in remote_videos:
        # Only the pinned destination channel may supply an implicit match for
        # an item that has no recorded video id.  Existing records can still
        # legitimately point to an older public video on another channel.
        if video.get("channel_id") == channel_id:
            by_title.setdefault(video.get("title") or "", []).append(video)
            description = video.get("description") or ""
            for marker in re.findall(r"(?<![A-Za-z0-9_-])enc-id:([A-Za-z0-9_-]+)", description):
                by_marker.setdefault(marker, []).append(video)

    adopted: list[str] = []
    conflicts: list[str] = []
    state[META_KEY]["target_channel_id"] = channel_id
    state[META_KEY]["last_reconciled_at"] = utc_now()

    def flag(term_id: str, reason: str) -> None:
        conflicts.append(f"{term_id}: {reason}")
        flagged = state.setdefault(term_id, {})
        flagged["needs_review"] = {"reason": reason, "at": utc_now()}

    def duration_ok(video: dict, local_duration: float, local_size: int | None) -> bool:
        if video.get("failure_reason"):
            return False
        remote_duration = video.get("duration_seconds")
        if remote_duration is not None:
            return abs(float(remote_duration) - local_duration) <= duration_tolerance
        # Still processing: YouTube has no duration yet, but the owner-only
        # file size proves these are the same bytes we hold locally.
        return local_size is not None and video.get("file_size_bytes") == local_size

    def upload_order(video: dict):
        return (video.get("published_at") or "9999", video.get("video_id") or "")

    def duplicate_entry(video: dict) -> dict:
        return {
            "video_id": video.get("video_id"),
            "title": video.get("title"),
            "published_at": video.get("published_at"),
            "duration_seconds": video.get("duration_seconds"),
        }

    for term_id, item in catalog.items():
        record = state.get(term_id) or {}
        record.pop("needs_review", None)
        local_duration = float(item.get("duration") or 0)
        try:
            local_size = Path(item["_mp4_path"]).stat().st_size
        except (KeyError, OSError):
            local_size = None
        marker_matches = sorted(by_marker.get(term_id, []), key=upload_order)
        video = None
        existing_id = record.get("video_id")
        if existing_id:
            duplicates = [v for v in marker_matches if v.get("video_id") != existing_id]
            if duplicates:
                record["duplicates"] = [duplicate_entry(v) for v in duplicates]
            else:
                record.pop("duplicates", None)
            video = by_id.get(existing_id)
            if not video:
                flag(term_id, "기록된 YouTube ID가 대상 채널에 없음")
                continue
        else:
            duration_matches = [
                v for v in marker_matches
                if v.get("title") == expected_title(item)
                and duration_ok(v, local_duration, local_size)
            ]
            if duration_matches:
                video = duration_matches[0]
                duplicates = [v for v in marker_matches if v is not video]
                if duplicates:
                    record["duplicates"] = [duplicate_entry(v) for v in duplicates]
                    state[term_id] = record
            elif marker_matches:
                flag(term_id, f"enc-id 표식 영상 {len(marker_matches)}편 모두 제목/재생시간 불일치")
                continue
            elif by_title.get(expected_title(item), []):
                flag(term_id, "제목·재생시간 후보는 있지만 enc-id 표식이 없어 자동 편입 불가")
                continue

        if not video:
            # A process can be interrupted after YouTube accepted bytes but
            # before the returned video id was durably saved. The uploads feed
            # is not guaranteed to expose that video immediately, so blindly
            # retrying a prepared record can create a duplicate. Only an
            # explicit YouTube limit rejection is known not to have accepted
            # the upload and is therefore safe to retry on a later day.
            if (
                record.get("phase") == "prepared_private_upload"
                and not record.get("video_id")
                and (record.get("last_error") or {}).get("stage")
                != "youtube_limit"
            ):
                flag(term_id, "ID 저장 전 중단 가능성이 있어 자동 재업로드 금지")
            continue
        if video.get("title") != expected_title(item):
            flag(term_id, "YouTube 제목 불일치")
            continue
        remote_duration = video.get("duration_seconds")
        if not duration_ok(video, local_duration, local_size):
            flag(term_id, "YouTube 재생시간 불일치")
            continue

        if not existing_id:
            record.update({
                "video_id": video["video_id"],
                "uploaded_at": video.get("published_at") or utc_now(),
                "phase": "remote_adopted",
                "adopted_at": utc_now(),
            })
            state[term_id] = record
            adopted.append(term_id)
        current_source = source_fingerprint(item, base)
        recorded_source = record.get("source") or {}
        if recorded_source.get("sha256") and recorded_source["sha256"] != current_source["sha256"]:
            flag(term_id, "기록된 원본과 현재 MP4 SHA-256 불일치")
            continue
        if (recorded_source.get("sidecar_sha256")
                and recorded_source["sidecar_sha256"] != current_source["sidecar_sha256"]):
            flag(term_id, "기록된 원본과 현재 사이드카 SHA-256 불일치")
            continue

        verification_status = (record.get("source_verification") or {}).get("status")
        if verification_status == "verified_before_upload":
            markers = set(re.findall(
                r"(?<![A-Za-z0-9_-])enc-id:([A-Za-z0-9_-]+)",
                video.get("description") or "",
            ))
            recoverable = (
                video.get("channel_id") == channel_id
                and term_id in markers
                and video.get("file_size_bytes") == current_source["size_bytes"]
                and source_fingerprints_match(recorded_source, current_source, strict=True)
            )
            if not recoverable:
                flag(term_id, "중단된 업로드의 원본을 자동 복구 검증할 수 없음")
                continue
            record["source"] = current_source
            record["source_verification"] = {
                "status": "verified_recovered_after_interrupt",
                "method": "preupload_sha256+mtime+youtube_file_size+marker+title+duration",
                "verified_at": utc_now(),
            }
        record["channel_id"] = video.get("channel_id") or channel_id
        if recorded_source.get("sha256"):
            record["source"] = current_source
        else:
            record["candidate_source"] = current_source
            record["source_verification"] = {
                "status": "unverified_candidate",
                "reason": "remote id/title/duration match does not prove the exact local source",
            }
        record["remote"] = {
            "title": video.get("title"),
            "duration_seconds": remote_duration,
            "privacy_status": video.get("privacy_status"),
            "upload_status": video.get("upload_status"),
            "processing_status": video.get("processing_status"),
            "checked_at": utc_now(),
        }
    return adopted, conflicts

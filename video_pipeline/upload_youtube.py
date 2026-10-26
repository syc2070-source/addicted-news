"""Safe, resumable YouTube publisher for the 172-video addiction encyclopedia.

The default command still uploads five items, matching the historical workflow,
but new uploads are PRIVATE and every returned YouTube id is written atomically
before playlist or database work.  ``--all`` queues every remaining local v2
video in one run; if YouTube applies a daily/channel limit, rerunning the same
command resumes without re-uploading completed items.

No command publishes or changes the database implicitly.  Publication and DB
linking are a separate explicit ``--publish-ready`` phase.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path


CODE_DIR = Path(__file__).resolve().parent
BASE = Path(os.environ.get("YOUTUBE_PIPELINE_ROOT", str(CODE_DIR))).resolve()
sys.path.insert(0, str(CODE_DIR / "lib"))
sys.path.insert(0, str(CODE_DIR))

from logutil import force_utf8  # noqa: E402
from publisher_state import (  # noqa: E402
    META_KEY,
    PublicationStateError,
    apply_verified_audit,
    candidate_ids,
    expected_title,
    load_catalog,
    load_state,
    merge_db_video_ids,
    parse_iso8601_duration,
    reconcile_remote,
    records,
    save_state_atomic,
    source_fingerprint,
    source_fingerprints_match,
    state_lock,
    utc_now,
)


VIDEO_DIR = BASE / "video_v2"


def _publisher_data_dir():
    configured = os.environ.get("YOUTUBE_PUBLISHER_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    workspace_default = BASE.parent / ".publisher-runtime" / "data"
    if (workspace_default / "upload_state.json").exists():
        return workspace_default
    local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
    if local_appdata:
        secure_default = Path(local_appdata) / "AddictedNews" / "youtube-publisher"
        if (secure_default / "upload_state.json").exists():
            return secure_default
    return BASE


PUBLISHER_DATA_DIR = _publisher_data_dir()
STATE_PATH = PUBLISHER_DATA_DIR / "upload_state.json"
AUDIT_PATH = CODE_DIR / "existing_uploads.audit.json"
CLIENT_SECRET = PUBLISHER_DATA_DIR / "client_secret.json"
TOKEN_PATH = PUBLISHER_DATA_DIR / "token.json"

PLAYLIST_TITLE = "중독백과"
DEFAULT_BATCH_SIZE = 5
EXPECTED_CATALOG_COUNT = 172
EXPECTED_CATALOG_IDS_SHA256 = "2b4de803c5777be3c88d3e8a4f17f4f28cbbd108a231f87d8d725b3f04fd16fc"
STATORY_URL = os.environ.get("STATORY_SITE_URL", "https://statory.org")
ADDICTION_NEWS_URL = os.environ.get("ADDICTION_NEWS_URL", "https://addictionnews.net")
TOC_LABELS = {"body": "본문", "advanced": "심화", "outro": "마무리"}

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
]
RETRIABLE_HTTP_STATUS = {500, 502, 503, 504}
LIMIT_REASONS = {
    "dailyLimitExceeded",
    "quotaExceeded",
    "uploadLimitExceeded",
    "rateLimitExceeded",
    "userRateLimitExceeded",
}
LIMIT_FAILURE = "YouTube 일일/쿼터 제한"
PLAYLIST_FAILURE_PREFIX = "영상 ID는 저장됨"

# Per-run facts the scheduled runner copies into status.json. Written only
# when the runner supplies both a summary path and its own run id.
RUN_SUMMARY = {
    "conflicts": [],
    "duplicates": 0,
    "limit": None,
    "uploaded": 0,
    "detail": "",
}


def _write_run_summary():
    path = os.environ.get("YOUTUBE_PUBLISHER_RUN_SUMMARY", "").strip()
    run_id = os.environ.get("YOUTUBE_PUBLISHER_RUN_ID", "").strip()
    if not path or not run_id:
        return
    payload = dict(RUN_SUMMARY, run_id=run_id, written_at=utc_now())
    target = Path(path)
    tmp = target.with_name(target.name + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, target)
    except OSError as exc:
        print(f"[경고] 실행 요약 저장 실패: {exc}")


def _summarize_conflicts(conflicts, state):
    RUN_SUMMARY["conflicts"] = [
        {"term": text.split(":", 1)[0], "reason": text.split(":", 1)[-1].strip()}
        for text in conflicts
    ]
    RUN_SUMMARY["duplicates"] = sum(
        len(record.get("duplicates") or []) for _, record in records(state)
    )


def upload_exit_code(attempted, completed, failures):
    """0 when the queue made progress or stopped cleanly at the YouTube limit;
    2 only when every attempted upload failed for some other reason."""
    if not attempted:
        return 0
    stored = completed + sum(
        1 for _, reason in failures if reason.startswith(PLAYLIST_FAILURE_PREFIX)
    )
    limited = any(reason == LIMIT_FAILURE for _, reason in failures)
    if failures and stored == 0 and not limited:
        return 2
    return 0


def _fmt_ts(sec):
    sec = int(round(sec))
    minutes, seconds = divmod(sec, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def build_metadata(term_id, item, private=True):
    """Build deterministic upload metadata from the local v2 sidecar."""
    term_ko = item.get("term_ko") or term_id
    term_en = item.get("term_en") or ""
    category = item.get("category") or ""
    definition = (item.get("definition") or "").strip()

    lines = []
    if definition:
        lines.extend([definition, ""])
    lines.extend([
        "▶ 통계·뉴스",
        f"· statory: {STATORY_URL}",
        f"· 중독뉴스: {ADDICTION_NEWS_URL}",
    ])
    toc = item.get("toc") or []
    if toc:
        lines.extend(["", "⏱ 목차"])
        for entry in toc:
            label = TOC_LABELS.get(entry.get("kind", ""), entry.get("label", ""))
            lines.append(f"{_fmt_ts(entry.get('start', 0))} {label}")
    footer = f"\n\n콘텐츠 ID: enc-id:{term_id}\n#중독백과 #중독 #중독뉴스"
    # Keep the recovery marker even if future source text grows close to the
    # YouTube description limit.
    description = "\n".join(lines)[:4900 - len(footer)].rstrip() + footer

    tags = ["중독백과", "중독", "중독뉴스", term_ko, term_en, category, f"enc-id-{term_id}"]
    clean_tags, seen = [], set()
    for tag in tags:
        tag = (tag or "").strip()
        if tag and tag.lower() not in seen:
            seen.add(tag.lower())
            clean_tags.append(tag)

    return {
        "snippet": {
            "title": expected_title(item),
            "description": description,
            "tags": clean_tags,
            "categoryId": "27",
            "defaultLanguage": "ko",
        },
        "status": {
            "privacyStatus": "private" if private else "public",
            "selfDeclaredMadeForKids": False,
        },
    }


# ------------------------------ Database ---------------------------------

def _db_connect():
    # Lazy import keeps inventory, dry-run and unit tests independent of DB
    # drivers and prevents accidental DB access during a dry run.
    from fetch import _connect
    return _connect()


def _normalize_db_video_id(value):
    if isinstance(value, str):
        value = value.strip()
    return value or None


def read_db_video_id(term_id):
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT youtube_video_id FROM encyclopedia_terms WHERE id = %s",
                (term_id,),
            )
            row = cur.fetchone()
    if not row:
        raise RuntimeError(f"DB에 백과 항목이 없습니다: {term_id}")
    return _normalize_db_video_id(row[0])


def read_all_db_video_ids(term_ids):
    """Read every local catalog row, including rows whose video id is null."""
    ids = list(term_ids)
    if not ids:
        return {}
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, youtube_video_id
                  FROM encyclopedia_terms
                 WHERE id = ANY(%s)
                """,
                (ids,),
            )
            rows = cur.fetchall()
    return {
        term_id: _normalize_db_video_id(video_id)
        for term_id, video_id in rows
    }


def update_video_id(term_id, video_id):
    """Conditionally link one public video; never overwrite a different id."""
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT youtube_video_id FROM encyclopedia_terms WHERE id = %s FOR UPDATE",
                (term_id,),
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError(f"DB에 백과 항목이 없습니다: {term_id}")
            current = _normalize_db_video_id(row[0])
            if current == video_id:
                return "already_synced"
            if current:
                raise RuntimeError(
                    f"DB YouTube ID 충돌: {term_id} (기존 {current}, 신규 {video_id})"
                )
            cur.execute(
                """
                UPDATE encyclopedia_terms
                   SET youtube_video_id = %s, updated_at = now()
                 WHERE id = %s
                   AND (youtube_video_id IS NULL OR btrim(youtube_video_id) = '')
                """,
                (video_id, term_id),
            )
            if cur.rowcount != 1:
                raise RuntimeError(f"DB YouTube ID 갱신 행 수 이상: {term_id} ({cur.rowcount})")
        conn.commit()
    return "synced"


# ------------------------------ YouTube ----------------------------------

def _refresh_reason(exc) -> str:
    """Only the OAuth error code (e.g. invalid_grant) — never token material."""
    for a in getattr(exc, "args", ()):
        if isinstance(a, dict) and a.get("error"):
            return str(a["error"])
    return type(exc).__name__


def _set_aside_expired(token: Path, now=None) -> Path:
    """Move a refused token beside itself (<name>.expired-<MMDDHHMM>); never delete."""
    import datetime as dt

    stamp = (now or dt.datetime.now()).strftime("%m%d%H%M")
    dest = token.with_name(f"{token.name}.expired-{stamp}")
    n = 2
    while dest.exists():
        dest = token.with_name(f"{token.name}.expired-{stamp}-{n}")
        n += 1
    os.replace(token, dest)
    return dest


def _get_service():
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError as exc:
                # A refused refresh (testing-mode 7-day expiry) used to crash before the login flow.
                if os.environ.get("YOUTUBE_PUBLISHER_NONINTERACTIVE") == "1":
                    raise PublicationStateError(
                        f"refresh token이 거절됐습니다({_refresh_reason(exc)}). "
                        "무인 실행이라 다시 로그인하지 않고 안전 중단합니다."
                    ) from None
                moved = _set_aside_expired(TOKEN_PATH)
                print(f"[토큰 만료] 갱신 거절({_refresh_reason(exc)}) — 옛 토큰을 {moved.name} 로 옮기고 새 로그인으로 넘어갑니다.")
                creds = None
        if not creds or not creds.valid:
            if os.environ.get("YOUTUBE_PUBLISHER_NONINTERACTIVE") == "1":
                raise PublicationStateError(
                    "무인 실행에 사용할 refresh token이 없습니다. "
                    "대화형 OAuth로 전환하지 않고 안전 중단합니다."
                )
            if not CLIENT_SECRET.exists():
                raise SystemExit(
                    f"client_secret.json이 없습니다: {CLIENT_SECRET}\n"
                    "Google Cloud의 데스크톱 OAuth 클라이언트 파일이 필요합니다."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
            creds = flow.run_local_server(port=0, prompt="select_account")
        tmp = TOKEN_PATH.with_name(TOKEN_PATH.name + ".tmp")
        try:
            tmp.write_text(creds.to_json(), encoding="utf-8")
            os.replace(tmp, TOKEN_PATH)
        finally:
            if tmp.exists():
                tmp.unlink()
    return build("youtube", "v3", credentials=creds)


def _own_channel(youtube):
    response = youtube.channels().list(
        part="id,snippet,contentDetails", mine=True, maxResults=1
    ).execute()
    items = response.get("items", [])
    if len(items) != 1:
        raise RuntimeError("인증된 YouTube 채널을 하나로 확정하지 못했습니다.")
    item = items[0]
    return {
        "channel_id": item["id"],
        "title": item.get("snippet", {}).get("title", ""),
        "uploads_playlist_id": (
            item.get("contentDetails", {})
            .get("relatedPlaylists", {})
            .get("uploads")
        ),
    }


def _assert_target_channel(youtube, expected_channel_id, state):
    channel = _own_channel(youtube)
    if not expected_channel_id:
        raise PublicationStateError(
            "YOUTUBE_CHANNEL_ID 또는 --channel-id가 필요합니다. "
            f"현재 인증 채널: {channel['title']} ({channel['channel_id']}). "
            "채널 ID를 확인한 후 다시 실행하세요."
        )
    if channel["channel_id"] != expected_channel_id:
        raise PublicationStateError(
            "YouTube 채널 불일치 — 업로드를 중단합니다. "
            f"예상 {expected_channel_id}, 인증 {channel['channel_id']} ({channel['title']})"
        )
    pinned = (state.get(META_KEY) or {}).get("target_channel_id")
    if pinned and pinned != expected_channel_id:
        raise PublicationStateError(
            f"상태 파일의 대상 채널({pinned})과 현재 지정({expected_channel_id})이 다릅니다."
        )
    return channel


def _iter_playlist_video_ids(youtube, playlist_id):
    request = youtube.playlistItems().list(
        part="contentDetails", playlistId=playlist_id, maxResults=50
    )
    while request is not None:
        response = request.execute()
        for item in response.get("items", []):
            video_id = item.get("contentDetails", {}).get("videoId")
            if video_id:
                yield video_id
        request = youtube.playlistItems().list_next(request, response)


def _video_details(youtube, video_ids, include_processing=False):
    details = []
    ids = list(dict.fromkeys(video_ids))
    parts = "snippet,contentDetails,status"
    if include_processing:
        # processingDetails is owner-only. Never request it for exact ids from
        # either historical channel unless they are in the authenticated
        # destination channel's own uploads playlist.
        parts += ",processingDetails,fileDetails"
    for offset in range(0, len(ids), 50):
        batch = ids[offset:offset + 50]
        if not batch:
            continue
        response = youtube.videos().list(
            part=parts,
            id=",".join(batch),
            maxResults=50,
        ).execute()
        for item in response.get("items", []):
            snippet = item.get("snippet", {})
            status = item.get("status", {})
            processing = item.get("processingDetails", {})
            file_details = item.get("fileDetails", {})
            try:
                file_size_bytes = int(file_details.get("fileSize"))
            except (TypeError, ValueError):
                file_size_bytes = None
            failure_reason = (
                status.get("failureReason")
                or status.get("rejectionReason")
                or processing.get("processingFailureReason")
            )
            mutable_status = {
                key: status[key]
                for key in (
                    "privacyStatus", "license", "embeddable",
                    "publicStatsViewable", "selfDeclaredMadeForKids",
                    "containsSyntheticMedia",
                )
                if key in status
            }
            details.append({
                "video_id": item.get("id"),
                "channel_id": snippet.get("channelId"),
                "title": snippet.get("title"),
                "published_at": snippet.get("publishedAt"),
                "description": snippet.get("description", ""),
                "duration_seconds": parse_iso8601_duration(
                    item.get("contentDetails", {}).get("duration", "")
                ),
                "privacy_status": status.get("privacyStatus"),
                "upload_status": status.get("uploadStatus"),
                "processing_status": processing.get("processingStatus"),
                "failure_reason": failure_reason,
                "file_size_bytes": file_size_bytes,
                "file_name": file_details.get("fileName"),
                "mutable_status": mutable_status,
            })
    return details


def _remote_inventory(youtube, channel, state, extra_video_ids=None):
    uploads_playlist = channel.get("uploads_playlist_id")
    if not uploads_playlist:
        raise RuntimeError("채널 uploads 재생목록 ID를 찾지 못했습니다.")
    owned_ids = list(_iter_playlist_video_ids(youtube, uploads_playlist))
    # Existing state may legitimately contain public videos posted to an older
    # channel. Query those exact ids too, but only the pinned channel can be
    # used to adopt an unrecorded duplicate.
    referenced_ids = [
        record.get("video_id")
        for _, record in records(state)
        if record.get("video_id")
    ]
    referenced_ids.extend(extra_video_ids or [])
    owned_set = set(owned_ids)
    external_ids = [
        video_id for video_id in dict.fromkeys(referenced_ids)
        if video_id and video_id not in owned_set
    ]
    return (
        _video_details(youtube, owned_ids, include_processing=True)
        + _video_details(youtube, external_ids, include_processing=False)
    )


def _ensure_playlist(
    youtube,
    expected_playlist_id="",
    expected_channel_id="",
    create_if_missing=True,
):
    if expected_playlist_id:
        response = youtube.playlists().list(
            part="id,snippet,status", id=expected_playlist_id, maxResults=1
        ).execute()
        items = response.get("items", [])
        if len(items) != 1:
            raise PublicationStateError(
                f"고정 재생목록을 찾지 못했습니다: {expected_playlist_id}"
            )
        playlist = items[0]
        snippet = playlist.get("snippet", {})
        if snippet.get("title") != PLAYLIST_TITLE:
            raise PublicationStateError(
                "고정 재생목록 제목 불일치 — "
                f"예상 {PLAYLIST_TITLE}, 실제 {snippet.get('title', '')}"
            )
        owner_channel_id = snippet.get("channelId")
        if expected_channel_id and owner_channel_id != expected_channel_id:
            raise PublicationStateError(
                "고정 재생목록 소유 채널 불일치 — "
                f"예상 {expected_channel_id}, 실제 {owner_channel_id or '확인 불가'}"
            )
        return playlist["id"]

    matches = []
    request = youtube.playlists().list(part="snippet", mine=True, maxResults=50)
    while request is not None:
        response = request.execute()
        for playlist in response.get("items", []):
            if playlist.get("snippet", {}).get("title") == PLAYLIST_TITLE:
                matches.append(playlist["id"])
        request = youtube.playlists().list_next(request, response)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise PublicationStateError(
            f"같은 이름의 재생목록이 {len(matches)}개여서 하나로 확정할 수 없습니다."
        )
    if not create_if_missing:
        raise PublicationStateError(
            "무인 실행에는 기존 재생목록 ID가 필요합니다. 새 재생목록을 만들지 않습니다."
        )
    response = youtube.playlists().insert(
        part="snippet,status",
        body={
            "snippet": {
                "title": PLAYLIST_TITLE,
                "description": "중독백과 용어 해설 영상 모음",
            },
            "status": {"privacyStatus": "public"},
        },
    ).execute()
    return response["id"]


def _ensure_playlist_member(youtube, playlist_id, video_id, members):
    if video_id in members:
        return False
    youtube.playlistItems().insert(
        part="snippet",
        body={
            "snippet": {
                "playlistId": playlist_id,
                "resourceId": {"kind": "youtube#video", "videoId": video_id},
            }
        },
    ).execute()
    members.add(video_id)
    return True


def _upload_video(youtube, mp4_path, body, max_retries=8):
    from googleapiclient.http import MediaFileUpload

    media = MediaFileUpload(
        str(mp4_path), chunksize=-1, resumable=True, mimetype="video/mp4"
    )
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
        notifySubscribers=False,
    )
    response = None
    retries = 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                print(f"    업로드 {int(status.progress() * 100)}%")
        except Exception as exc:
            http_status = getattr(getattr(exc, "resp", None), "status", None)
            if http_status not in RETRIABLE_HTTP_STATUS or retries >= max_retries:
                raise
            delay = min((2 ** retries) + random.random(), 64)
            retries += 1
            print(f"    일시 오류({http_status}), {delay:.1f}초 후 재개")
            time.sleep(delay)
    if not response or not response.get("id"):
        raise RuntimeError("YouTube가 영상 ID 없이 업로드 응답을 반환했습니다.")
    return response["id"]


def _set_public(youtube, video_id, current_video):
    # Updating a part replaces mutable values omitted from that part. Preserve
    # the currently returned status fields and change privacy only.
    status = dict(current_video.get("mutable_status") or {})
    status["privacyStatus"] = "public"
    status.setdefault("selfDeclaredMadeForKids", False)
    return youtube.videos().update(
        part="status",
        body={
            "id": video_id,
            "status": status,
        },
    ).execute()


def _api_error_reasons(exc):
    content = getattr(exc, "content", b"")
    if isinstance(content, bytes):
        content = content.decode("utf-8", errors="replace")
    try:
        payload = json.loads(content or "{}")
        return {
            item.get("reason")
            for item in payload.get("error", {}).get("errors", [])
            if item.get("reason")
        }
    except Exception:
        return set()


def _is_processed(video):
    if video.get("failure_reason"):
        return False
    return (
        video.get("processing_status") == "succeeded"
        and video.get("upload_status") == "processed"
    )


# ----------------------------- Workflows ---------------------------------

def _dry_run(catalog, state, term_id, upload_all, batch_size):
    all_pending = candidate_ids(catalog, state)
    pending = candidate_ids(catalog, state, term_id) if term_id else all_pending
    todo = pending if upload_all else pending[:batch_size]
    print(f"=== 로컬 전체 {len(catalog)}편 · 기록 완료 {len(catalog)-len(all_pending)}편 "
          f"· 미기록 {len(all_pending)}편 ===")
    for term in todo:
        body = build_metadata(term, catalog[term], private=True)
        print(f"{term}\t{body['snippet']['title']}\tPRIVATE\t{catalog[term]['_mp4_path']}")
    print(f"(DRY-RUN) 대상 {len(todo)}편. Google 인증·업로드·DB 접속·상태 변경 없음.")


def _record_error(state, term_id, stage, exc):
    record = state.setdefault(term_id, {})
    record["last_error"] = {
        "stage": stage,
        "message": str(exc).splitlines()[0] if str(exc) else type(exc).__name__,
        "at": utc_now(),
    }


def _upload_queue(youtube, channel, catalog, state, playlist_id, members,
                  term_id, upload_all, batch_size):
    pending = candidate_ids(catalog, state, term_id)
    todo = pending if upload_all else pending[:batch_size]
    if not todo:
        print("새로 업로드할 항목이 없습니다.")
        return 0, []
    print(f"=== 미게시 {len(pending)}편 중 이번 대기열 {len(todo)}편 (PRIVATE) ===")

    completed, failures = 0, []
    for index, term in enumerate(todo, 1):
        item = catalog[term]
        body = build_metadata(term, item, private=True)
        print(f"\n[업로드 {index}/{len(todo)}] {term} — {body['snippet']['title']}")
        try:
            # Freeze the exact local source before the first remote write.
            before_source = source_fingerprint(item, BASE)
            prepared = state.setdefault(term, {})
            recorded_source = prepared.get("source") or {}
            if (recorded_source.get("sha256")
                    and recorded_source["sha256"] != before_source["sha256"]):
                raise PublicationStateError(f"{term}: 기록된 원본과 현재 MP4 SHA-256 불일치")
            prepared.update({
                "phase": "prepared_private_upload",
                "channel_id": channel["channel_id"],
                "source": before_source,
                "source_verification": {"status": "verified_before_upload", "at": utc_now()},
                "last_error": None,
            })
            save_state_atomic(STATE_PATH, state)

            video_id = _upload_video(youtube, item["_mp4_path"], body)
            print(f"    YouTube가 반환한 ID: {video_id}")
            # Critical ordering: persist the returned id before *any* playlist
            # or DB operation. A later failure can therefore never re-upload
            # merely because follow-up bookkeeping failed.
            state[term].update({
                "video_id": video_id,
                "uploaded_at": utc_now(),
                "phase": "uploaded_private",
                "channel_id": channel["channel_id"],
                "source": before_source,
                "remote": {
                    "privacy_status": "private",
                    "checked_at": utc_now(),
                },
                "playlist": {"status": "pending"},
                "db": {"status": "not_synced"},
                "last_error": None,
            })
            save_state_atomic(STATE_PATH, state)

            after_source = source_fingerprint(item, BASE)
            if not source_fingerprints_match(
                before_source, after_source, strict=True
            ):
                raise PublicationStateError(
                    f"{term}: 업로드 중 로컬 MP4가 변경됨; video ID는 보존하고 후속 작업 중단"
                )
            state[term]["source_verification"] = {
                "status": "verified_before_and_after_upload",
                "at": utc_now(),
            }
            save_state_atomic(STATE_PATH, state)
            print(f"    YouTube ID·원본 지문 저장 완료: {video_id}")
        except Exception as exc:
            reasons = _api_error_reasons(exc)
            if reasons & LIMIT_REASONS:
                _record_error(state, term, "youtube_limit", exc)
                save_state_atomic(STATE_PATH, state)
                failures.append((term, LIMIT_FAILURE))
                RUN_SUMMARY["limit"] = term
                print(f"    YouTube 일일/쿼터 제한으로 안전 중단: {', '.join(sorted(reasons))}")
                print("    나중에 같은 명령을 실행하면 이 항목부터 재개됩니다.")
                break
            _record_error(state, term, "upload", exc)
            save_state_atomic(STATE_PATH, state)
            failures.append((term, str(exc).splitlines()[0] if str(exc) else "예외"))
            print(f"    [x] 업로드 실패: {exc}")
            continue

        try:
            _ensure_playlist_member(youtube, playlist_id, video_id, members)
            record = state[term]
            record["playlist"] = {
                "status": "synced",
                "id": playlist_id,
                "synced_at": utc_now(),
            }
            record["phase"] = "private_playlisted"
            record["last_error"] = None
            save_state_atomic(STATE_PATH, state)
            completed += 1
            print(f"    ✓ 비공개 업로드·재생목록 기록 완료: https://youtu.be/{video_id}")
        except Exception as exc:
            _record_error(state, term, "playlist", exc)
            save_state_atomic(STATE_PATH, state)
            failures.append((term, f"{PLAYLIST_FAILURE_PREFIX}; 재생목록 실패: {exc}"))
            print(f"    [!] 영상은 저장됨. 재생목록만 재시도 필요: {exc}")
        time.sleep(1)
    return completed, failures


def _publish_ready(youtube, channel, catalog, state, playlist_id, members,
                   remote_videos):
    by_id = {video["video_id"]: video for video in remote_videos}
    published, pending, failures = 0, 0, []
    for term, record in records(state):
        video_id = record.get("video_id")
        if not video_id:
            continue
        item = catalog.get(term)
        if not item:
            failures.append((term, "로컬 v2 원본 없음"))
            continue
        current_source = source_fingerprint(item, BASE)
        recorded_source = record.get("source") or {}
        if recorded_source.get("sha256") != current_source["sha256"]:
            failures.append((term, "MP4 SHA-256 불일치"))
            continue
        verification = (record.get("source_verification") or {}).get("status", "")
        if verification not in {
            "verified",
            "verified_before_and_after_upload",
            "verified_recovered_after_interrupt",
        }:
            failures.append((term, "원본 지문이 검증 상태가 아님"))
            continue
        video = by_id.get(video_id)
        if not video:
            failures.append((term, "YouTube에 기록 ID 없음"))
            continue
        owned_by_target = record.get("channel_id") == channel["channel_id"]
        try:
            if video.get("failure_reason"):
                raise RuntimeError(f"YouTube 처리 실패/거절: {video['failure_reason']}")

            if owned_by_target:
                if not _is_processed(video):
                    pending += 1
                    print(f"[대기] {term}: YouTube 처리 미완료")
                    continue

                # Playlist membership is completed and persisted before the
                # externally visible privacy transition.
                _ensure_playlist_member(youtube, playlist_id, video_id, members)
                record["playlist"] = {
                    "status": "synced", "id": playlist_id, "synced_at": utc_now()
                }
                record["phase"] = "playlisted_ready_to_publish"
                record["last_error"] = None
                save_state_atomic(STATE_PATH, state)

                if video.get("privacy_status") != "public":
                    _set_public(youtube, video_id, video)
                    time.sleep(1)
                    refreshed = _video_details(
                        youtube, [video_id], include_processing=True
                    )
                    video = refreshed[0] if refreshed else {}
                if video.get("privacy_status") != "public" or not _is_processed(video):
                    raise RuntimeError("공개 전환 후 public/processed 상태가 확인되지 않음")
            else:
                # Existing audited videos on the other historical channel are
                # never mutated. They may still be linked to the portal after
                # their public, processed status is confirmed read-only.
                if (video.get("privacy_status") != "public"
                        or video.get("upload_status") != "processed"):
                    raise RuntimeError("다른 채널의 기존 영상이 public/processed가 아님")

            record["remote"] = {
                "privacy_status": "public",
                "upload_status": video.get("upload_status"),
                "processing_status": video.get("processing_status"),
                "failure_reason": video.get("failure_reason"),
                "checked_at": utc_now(),
            }
            record["phase"] = "published_pending_db"
            record["published_at"] = record.get("published_at") or utc_now()
            record["last_error"] = None
            save_state_atomic(STATE_PATH, state)

            db_result = update_video_id(term, video_id)
            record["db"] = {
                "status": db_result, "video_id": video_id, "synced_at": utc_now()
            }
            record["phase"] = "published_db_synced"
            record["published_at"] = record.get("published_at") or utc_now()
            record["completed_at"] = utc_now()
            record["last_error"] = None
            save_state_atomic(STATE_PATH, state)
            published += 1
            print(f"[완료] {term}: 공개 확인·DB 동기화"
                  + ("·재생목록" if owned_by_target else " (기존 다른 채널 영상 보존)"))
        except Exception as exc:
            _record_error(state, term, "publish_or_db", exc)
            save_state_atomic(STATE_PATH, state)
            failures.append((term, str(exc).splitlines()[0] if str(exc) else "예외"))
            print(f"[x] {term}: {exc}")
            print("    공개/DB 단계 오류로 나머지 처리를 안전 중단합니다.")
            break
    print(f"=== 공개/DB 완료 {published} · 처리 대기 {pending} · 실패 {len(failures)} ===")
    return published, pending, failures


def _parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("term_id", nargs="?", help="특정 항목 1편")
    parser.add_argument("--dry-run", action="store_true",
                        help="로컬 대상·메타데이터만 확인(Google/DB/상태 변경 없음)")
    parser.add_argument("--all", action="store_true",
                        help="남은 전체를 하나의 재개 가능한 비공개 업로드 대기열로 처리")
    parser.add_argument("--daily-limit", type=int, default=DEFAULT_BATCH_SIZE,
                        help=f"--all이 아닐 때 이번 실행 상한(기본 {DEFAULT_BATCH_SIZE})")
    parser.add_argument("--reconcile-only", action="store_true",
                        help="YouTube·DB·로컬 상태 읽기 대조(원격/DB 쓰기 없음)")
    parser.add_argument("--publish-ready", action="store_true",
                        help="처리 완료된 비공개 영상을 공개하고 DB에 연결")
    parser.add_argument("--channel-id", default=os.environ.get("YOUTUBE_CHANNEL_ID", ""),
                        help="쓰기 대상 YouTube 채널 ID(또는 YOUTUBE_CHANNEL_ID)")
    parser.add_argument("--playlist-id", default=os.environ.get("YOUTUBE_PLAYLIST_ID", ""),
                        help="기존 중독백과 재생목록 ID(무인 실행에서는 필수)")
    # Backward compatibility: private is now the safe default.
    parser.add_argument("--private", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.term_id and args.all:
        parser.error("특정 term_id와 --all은 같이 사용할 수 없습니다.")
    if args.daily_limit < 1:
        parser.error("--daily-limit은 1 이상이어야 합니다.")
    if args.reconcile_only and (
        args.term_id or args.all or args.dry_run or args.publish_ready
    ):
        parser.error(
            "--reconcile-only는 term_id/--all/--dry-run/--publish-ready와 같이 사용할 수 없습니다."
        )
    if args.publish_ready and (args.term_id or args.all or args.dry_run):
        parser.error("--publish-ready는 term_id/--all/--dry-run과 같이 사용할 수 없습니다.")
    return args


def main():
    args = _parse_args()
    force_utf8()
    try:
        catalog = load_catalog(
            VIDEO_DIR,
            expected_count=EXPECTED_CATALOG_COUNT,
            expected_ids_sha256=EXPECTED_CATALOG_IDS_SHA256,
        )
        state = load_state(STATE_PATH)
        if args.dry_run:
            _, audit_conflicts = apply_verified_audit(
                AUDIT_PATH, catalog, state, BASE
            )
            if audit_conflicts:
                raise PublicationStateError("\n".join(audit_conflicts))
            _dry_run(catalog, state, args.term_id, args.all, args.daily_limit)
            return

        with state_lock(STATE_PATH):
            # Reload after acquiring the lock so a process that finished just
            # before us cannot be overwritten by a stale in-memory copy.
            state = load_state(STATE_PATH)
            audit_adopted, audit_conflicts = apply_verified_audit(
                AUDIT_PATH, catalog, state, BASE
            )
            try:
                db_video_ids = read_all_db_video_ids(catalog.keys())
            except Exception as exc:
                raise PublicationStateError(
                    f"DB YouTube ID 사전 조회 실패 — 중복 방지를 보장할 수 없어 중단: {exc}"
                ) from exc
            db_adopted, db_conflicts = merge_db_video_ids(catalog, state, db_video_ids)
            local_conflicts = audit_conflicts + db_conflicts
            if local_conflicts:
                print("로컬/DB 대조 충돌 — Google 인증·원격 쓰기 전에 중단합니다:")
                for conflict in local_conflicts:
                    print("  -", conflict)
                RUN_SUMMARY["detail"] = "로컬/DB 대조 충돌: " + "; ".join(local_conflicts[:3])
                raise SystemExit(2)

            youtube = _get_service()
            channel = _assert_target_channel(youtube, args.channel_id.strip(), state)
            noninteractive = os.environ.get("YOUTUBE_PUBLISHER_NONINTERACTIVE") == "1"
            print(f"[채널 확인] {channel['title']} ({channel['channel_id']})")

            remote_videos = _remote_inventory(
                youtube, channel, state, extra_video_ids=db_video_ids.values()
            )
            remote_adopted, conflicts = reconcile_remote(
                catalog, state, remote_videos, channel["channel_id"], BASE
            )
            save_state_atomic(STATE_PATH, state)
            print(
                f"[대조] 로컬 {len(catalog)} · DB 행 {len(db_video_ids)}"
                f"(연결 {sum(1 for value in db_video_ids.values() if value)}) · "
                f"원격 {len(remote_videos)} · 편입 "
                f"검증원장 {len(audit_adopted)}/DB {len(db_adopted)}/원격 {len(remote_adopted)}"
            )
            _summarize_conflicts(conflicts, state)
            if conflicts and args.publish_ready:
                # Publication stays all-or-nothing: never publish around a conflict.
                print("대조 충돌 — 공개 단계는 어떤 원격 쓰기도 하지 않습니다:")
                for conflict in conflicts:
                    print("  -", conflict)
                raise SystemExit(2)
            if conflicts:
                # Private uploads continue: flagged terms are skipped by
                # candidate_ids (never re-uploaded); every other item proceeds.
                print(f"대조 충돌 {len(conflicts)}편 — 해당 편만 needs_review 로 건너뜁니다:")
                for conflict in conflicts:
                    print("  -", conflict)
            if RUN_SUMMARY["duplicates"]:
                print(f"[중복 기록] {RUN_SUMMARY['duplicates']}편 (기록만 · 삭제/수정 없음)")
            if args.reconcile_only:
                if noninteractive and not args.playlist_id.strip():
                    raise PublicationStateError(
                        "무인 사전 점검에는 --playlist-id가 필요합니다."
                    )
                if args.playlist_id.strip():
                    checked_playlist_id = _ensure_playlist(
                        youtube,
                        expected_playlist_id=args.playlist_id.strip(),
                        expected_channel_id=channel["channel_id"],
                        create_if_missing=False,
                    )
                    print(f"[재생목록 확인] {PLAYLIST_TITLE} ({checked_playlist_id})")
                print("(RECONCILE-ONLY) YouTube·DB는 읽기만, 원격 쓰기는 없음.")
                return

            if noninteractive and not args.playlist_id.strip():
                raise PublicationStateError(
                    "무인 실행에는 --playlist-id 또는 YOUTUBE_PLAYLIST_ID가 필요합니다."
                )
            playlist_id = _ensure_playlist(
                youtube,
                expected_playlist_id=args.playlist_id.strip(),
                expected_channel_id=channel["channel_id"],
                create_if_missing=not noninteractive,
            )
            members = set(_iter_playlist_video_ids(youtube, playlist_id))
            if args.publish_ready:
                _, pending, failures = _publish_ready(
                    youtube, channel, catalog, state, playlist_id, members, remote_videos
                )
                if pending or failures:
                    raise SystemExit(1)
                return

            before_ids = sum(1 for _, record in records(state) if record.get("video_id"))
            completed, failures = _upload_queue(
                youtube, channel, catalog, state, playlist_id, members,
                args.term_id, args.all, args.daily_limit,
            )
            RUN_SUMMARY["uploaded"] = (
                sum(1 for _, record in records(state) if record.get("video_id")) - before_ids
            )
            print(f"\n=== 비공개 업로드 세션: 완료 {completed} · 실패 {len(failures)} ===")
            for term, reason in failures:
                print(f"  - {term}: {reason}")
            exit_code = upload_exit_code(completed + len(failures), completed, failures)
            if exit_code:
                RUN_SUMMARY["detail"] = "업로드 시도 전부 실패: " + "; ".join(
                    f"{term}: {reason}" for term, reason in failures[:3]
                )
                raise SystemExit(exit_code)
    except PublicationStateError as exc:
        RUN_SUMMARY["detail"] = f"안전 중단: {str(exc).splitlines()[0] if str(exc) else repr(exc)}"
        raise SystemExit(f"안전 중단: {exc}") from exc
    except SystemExit as exc:
        if exc.code not in (0, None) and not RUN_SUMMARY["detail"]:
            RUN_SUMMARY["detail"] = (
                exc.code if isinstance(exc.code, str) else f"종료 코드 {exc.code}"
            )
        raise
    finally:
        _write_run_summary()


if __name__ == "__main__":
    main()

"""
upload_youtube.py — 중독백과 영상 유튜브 자동 업로드 (v2 지시서 작업 2·3).

특징:
  - YouTube Data API v3 (google-api-python-client). OAuth 토큰은 로컬 파일 보관.
      client_secret.json  : Google Cloud 데스크톱 OAuth 클라이언트 (사용자가 배치, 커밋 금지)
      token.json          : 최초 브라우저 인증 후 캐시 (커밋 금지)
  - 메타데이터: 제목 "{항목명} — 중독백과" / 설명(요약 + 링크 + 목차 타임스탬프)
                / 태그(항목명·카테고리·중독 기본)
  - 재생목록 "중독백과" 에 추가(없으면 생성).
  - 기본 공개(public), --private 로 비공개.
  - 쿼터: 업로드 1건 = 1,600 units, 하루 10,000 → 최대 6건. 기본 하루 5건(--daily-limit).
  - upload_state.json 에 {id: {video_id, uploaded_at}} 기록 → 재실행 시 완료분 건너뜀(멱등).
  - 업로드 성공 시 encyclopedia_terms.youtube_video_id 를 UPDATE(작업 3-2).

사용법 (video_pipeline/ 에서):
  python upload_youtube.py                 # 오늘 최대 5편 업로드(공개)
  python upload_youtube.py --dry-run       # 업로드 없이 메타데이터만 출력(구글 인증 불필요)
  python upload_youtube.py --daily-limit 3 # 오늘 3편만
  python upload_youtube.py --private        # 비공개 업로드
  python upload_youtube.py twelve-step      # 특정 항목 1편(G4 실업로드 테스트)

npx 아님 — 파이썬으로 실행. 매일 수동(또는 Windows 작업 스케줄러) 실행.
필요 패키지: requirements.txt 의 google-api-python-client, google-auth-oauthlib.
"""
import os
import sys
import json
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE / "lib"))

from logutil import force_utf8                         # noqa
from fetch import fetch_one, fetch_all_ids, _connect   # noqa

VIDEO_DIR = BASE / "video_v2"
STATE_PATH = BASE / "upload_state.json"
CLIENT_SECRET = BASE / "client_secret.json"
TOKEN_PATH = BASE / "token.json"

PLAYLIST_TITLE = "중독백과"
UPLOAD_UNITS = 1600           # 업로드 1건당 쿼터
DEFAULT_DAILY_LIMIT = 5       # 기본 하루 상한(≤6)

STATORY_URL = os.environ.get("STATORY_SITE_URL", "https://statory.org")
ADDICTION_NEWS_URL = os.environ.get("ADDICTION_NEWS_URL", "https://addictionnews.net")

# 설명 목차 표시 라벨(kind 기준). 마지막 챕터(outro)는 "마무리"로 표기.
# 표시 시점에 매핑하므로 이미 생성된 사이드카(라벨 "중독뉴스")에도 소급 적용된다.
TOC_LABELS = {"body": "본문", "advanced": "심화", "outro": "마무리"}

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
]


# ────────────────────────── 상태(멱등) ──────────────────────────
def _load_state():
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_state(state):
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                          encoding="utf-8")


# ────────────────────────── 메타데이터 ──────────────────────────
def _fmt_ts(sec):
    sec = int(round(sec))
    m, s = divmod(sec, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _load_sidecar(term_id):
    p = VIDEO_DIR / f"{term_id}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def build_metadata(term_id, item, sidecar, private=False):
    """업로드 스니펫(title/description/tags/privacy) 생성."""
    term_ko = (item or {}).get("term_ko") or (sidecar or {}).get("term_ko") or term_id
    term_en = (item or {}).get("term_en") or (sidecar or {}).get("term_en") or ""
    category = (item or {}).get("category") or (sidecar or {}).get("category") or ""
    definition = ((item or {}).get("definition")
                  or (sidecar or {}).get("definition") or "").strip()

    title = f"{term_ko} — 중독백과"
    if len(title) > 100:                       # 유튜브 제목 100자 제한
        title = title[:99]

    lines = []
    if definition:
        lines.append(definition)
        lines.append("")
    lines.append("▶ 통계·뉴스")
    lines.append(f"· statory: {STATORY_URL}")
    lines.append(f"· 중독뉴스: {ADDICTION_NEWS_URL}")

    toc = (sidecar or {}).get("toc") or []
    if toc:
        lines.append("")
        lines.append("⏱ 목차")
        for e in toc:
            # 표시 라벨은 kind 기준 매핑(이미 생성된 사이드카에도 적용). 미매핑은 저장 라벨.
            label = TOC_LABELS.get(e.get("kind", ""), e.get("label", ""))
            lines.append(f"{_fmt_ts(e.get('start', 0))} {label}")

    lines.append("")
    lines.append("#중독백과 #중독 #중독뉴스")
    description = "\n".join(lines)
    if len(description) > 4900:                # 유튜브 설명 5000자 제한 여유
        description = description[:4900]

    tags = ["중독백과", "중독", "중독뉴스", term_ko]
    if term_en:
        tags.append(term_en)
    if category:
        tags.append(category)
    # 중복 제거·공백 제거
    seen, clean_tags = set(), []
    for t in tags:
        t = (t or "").strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            clean_tags.append(t)

    return {
        "snippet": {
            "title": title,
            "description": description,
            "tags": clean_tags,
            "categoryId": "27",               # Education
        },
        "status": {
            "privacyStatus": "private" if private else "public",
            "selfDeclaredMadeForKids": False,
        },
    }


# ────────────────────────── DB 업데이트(작업 3-2) ──────────────────────────
def update_video_id(term_id, video_id):
    """encyclopedia_terms.youtube_video_id UPDATE. 실패해도 업로드 자체는 유효."""
    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE encyclopedia_terms SET youtube_video_id = %s WHERE id = %s",
                    (video_id, term_id),
                )
            conn.commit()
        return True
    except Exception as e:
        print(f"    [!] DB youtube_video_id 업데이트 실패({term_id}): {e}")
        return False


# ────────────────────────── 유튜브 API ──────────────────────────
def _get_service():
    """OAuth 인증 후 youtube 서비스 반환. (google 패키지 필요)"""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CLIENT_SECRET.exists():
                raise SystemExit(
                    f"client_secret.json 이 없습니다: {CLIENT_SECRET}\n"
                    "Google Cloud 콘솔에서 데스크톱 OAuth 클라이언트를 만들어 저장하세요."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
    return build("youtube", "v3", credentials=creds)


def _ensure_playlist(youtube):
    """'중독백과' 재생목록 id 반환(없으면 생성)."""
    req = youtube.playlists().list(part="snippet", mine=True, maxResults=50)
    while req is not None:
        res = req.execute()
        for pl in res.get("items", []):
            if pl["snippet"]["title"] == PLAYLIST_TITLE:
                return pl["id"]
        req = youtube.playlists().list_next(req, res)
    res = youtube.playlists().insert(
        part="snippet,status",
        body={
            "snippet": {"title": PLAYLIST_TITLE,
                        "description": "중독백과 용어 해설 영상 모음"},
            "status": {"privacyStatus": "public"},
        },
    ).execute()
    return res["id"]


def _add_to_playlist(youtube, playlist_id, video_id):
    youtube.playlistItems().insert(
        part="snippet",
        body={"snippet": {"playlistId": playlist_id,
                          "resourceId": {"kind": "youtube#video", "videoId": video_id}}},
    ).execute()


def _upload_video(youtube, mp4_path, body):
    from googleapiclient.http import MediaFileUpload
    media = MediaFileUpload(str(mp4_path), chunksize=-1, resumable=True,
                            mimetype="video/mp4")
    req = youtube.videos().insert(
        part="snippet,status", body=body, media_body=media)
    response = None
    while response is None:
        status, response = req.next_chunk()
        if status:
            print(f"    업로드 {int(status.progress() * 100)}%")
    return response["id"]


# ────────────────────────── 후보 선정 ──────────────────────────
def _candidates(term_id, state):
    """업로드 대상 id 리스트(완료분 제외, mp4 존재하는 것만, 카테고리·id 순)."""
    if term_id:
        return [term_id]
    ids = fetch_all_ids()
    out = []
    for tid in ids:
        if tid in state and state[tid].get("video_id"):
            continue                                   # 멱등: 이미 업로드됨
        if (VIDEO_DIR / f"{tid}.mp4").exists():
            out.append(tid)
    return out


# ────────────────────────── 메인 ──────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("term_id", nargs="?", help="특정 항목 1편만(생략 시 자동 선정)")
    ap.add_argument("--dry-run", action="store_true",
                    help="업로드 없이 메타데이터만 출력(구글 인증 불필요)")
    ap.add_argument("--daily-limit", type=int, default=DEFAULT_DAILY_LIMIT,
                    help=f"오늘 업로드 상한(기본 {DEFAULT_DAILY_LIMIT}, 쿼터상 최대 6)")
    ap.add_argument("--private", action="store_true", help="비공개 업로드")
    args = ap.parse_args()

    force_utf8()   # 3a: 콘솔 UTF-8 강제(PYTHONIOENCODING 불필요)
    limit = max(1, min(args.daily_limit, 6))
    state = _load_state()
    cands = _candidates(args.term_id, state)
    if not cands:
        print("업로드 대상 없음(video_v2/*.mp4 없음 또는 모두 업로드 완료).")
        return
    todo = cands[:limit]
    print(f"=== 대상 {len(cands)}건 중 오늘 {len(todo)}건 "
          f"(상한 {limit}, 예상 쿼터 {len(todo)*UPLOAD_UNITS} units) ===")

    # ── DRY-RUN: 인증·업로드 없이 메타만 ──
    if args.dry_run:
        for tid in todo:
            item = fetch_one(tid)
            sidecar = _load_sidecar(tid)
            body = build_metadata(tid, item, sidecar, private=args.private)
            print(f"\n──── {tid} ────")
            print("제목:", body["snippet"]["title"])
            print("공개:", body["status"]["privacyStatus"])
            print("태그:", ", ".join(body["snippet"]["tags"]))
            print("설명:\n" + body["snippet"]["description"])
        print("\n(DRY-RUN) 실제 업로드/DB변경 없음.")
        return

    # ── 실제 업로드 ──
    youtube = _get_service()
    playlist_id = _ensure_playlist(youtube)
    ok, failures = 0, []
    for tid in todo:
        mp4 = VIDEO_DIR / f"{tid}.mp4"
        item = fetch_one(tid)
        sidecar = _load_sidecar(tid)
        body = build_metadata(tid, item, sidecar, private=args.private)
        print(f"\n[업로드] {tid} — {body['snippet']['title']}")
        try:
            video_id = _upload_video(youtube, mp4, body)
            _add_to_playlist(youtube, playlist_id, video_id)
            update_video_id(tid, video_id)
            state[tid] = {
                "video_id": video_id,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            }
            _save_state(state)               # 건별 저장 → 중단돼도 진행분 보존
            ok += 1
            print(f"    ✓ https://youtu.be/{video_id} (재생목록·DB 반영)")
        except Exception as e:
            failures.append((tid, str(e).splitlines()[0] if str(e) else "예외"))
            print(f"    [x] 실패: {tid}: {e}")
        time.sleep(1)

    print(f"\n=== 업로드 완료: 성공 {ok} / 실패 {len(failures)} ===")
    if failures:
        for tid, why in failures:
            print(f"  - {tid}: {why}")


if __name__ == "__main__":
    main()

"""
fetch.py — 백과 항목을 DB(addiction_news)에서 직접 읽어온다.
추정 금지 원칙에 따라 1단계 보고서에서 확인된 실제 스키마만 사용:
  테이블 encyclopedia_terms, 키 id(slug),
  컬럼 definition, example, body(jsonb), advanced(jsonb), term_ko, category ...
"""
import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from pathlib import Path


def _load_env():
    """backend/.env 에서 DB_* 를 읽는다 (python-dotenv 없이 단순 파싱)."""
    # video_pipeline/lib/fetch.py -> backend/.env
    env_path = Path(__file__).resolve().parents[2] / "backend" / ".env"
    conf = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            conf[k.strip()] = v.strip().strip('"').strip("'")
    return conf


def _connect():
    c = _load_env()
    return psycopg2.connect(
        host=c.get("DB_HOST", "localhost"),
        port=int(c.get("DB_PORT", "5432")),
        user=c.get("DB_USER", "postgres"),
        password=c.get("DB_PASSWORD", os.environ.get("PGPASSWORD", "")),
        dbname=c.get("DB_NAME", "addiction_news"),
    )


def _jsonb(val):
    """body/advanced 가 문자열이면 파싱, 이미 list면 그대로."""
    if val is None:
        return []
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return []


def fetch_one(term_id):
    """단일 항목 dict 반환. 없으면 None."""
    with _connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, term_ko, term_en, category, definition, example,
                       body, advanced, published
                FROM encyclopedia_terms
                WHERE id = %s
                """,
                (term_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    row["body"] = _jsonb(row["body"])
    row["advanced"] = _jsonb(row["advanced"])
    return row


def fetch_all_ids(only_published=True):
    """전체 항목 id 목록 (배치용)."""
    q = "SELECT id FROM encyclopedia_terms"
    if only_published:
        q += " WHERE published = true"
    q += " ORDER BY category, id"
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(q)
            return [r[0] for r in cur.fetchall()]


if __name__ == "__main__":
    import sys
    tid = sys.argv[1] if len(sys.argv) > 1 else "twelve-step"
    item = fetch_one(tid)
    if not item:
        print("항목 없음:", tid)
    else:
        print("id:", item["id"], "| term:", item["term_ko"], "| cat:", item["category"])
        print("definition len:", len(item["definition"] or ""))
        print("body sections:", len(item["body"]), "| advanced sections:", len(item["advanced"]))

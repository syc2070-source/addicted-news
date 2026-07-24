"""
images_v2.py — 장면별 배경 이미지 확보 (v2 지시서 1-2).

기존 images.py 를 재사용:
  - _pexels_headers/_download/_cover: Pexels 요청·다운로드·커버
  - _gradient(cat, out): 카테고리 그라디언트 폴백
  - CATEGORY_QUERY: 카테고리 기본 검색어

[버그수정] PEXELS_API_KEY 를 환경변수뿐 아니라 backend/.env 에서도 읽는다.
  (DB·DeepSeek 키는 backend/.env 에 있는데 Pexels 키만 환경변수로 가정해,
   .env 에 넣어둔 경우 조용히 전부 그라디언트 폴백되던 문제를 해결.)

[조용한 폴백 금지] 장면별 소싱 결과·실패 사유(HTTP 상태·키 유무)를 반환/출력한다.
  절반 이상 폴백이면 build_v2 가 경고와 함께 중단한다.

저장 경로: images/{id}/{scene_n}.jpg
동일 항목 내 인접 장면이 '같은 사진'이 되지 않도록 이미 쓴 Pexels 사진 id 를 피한다.
"""
import os
import json
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path

from images import _gradient, CATEGORY_QUERY, W, H
import images as _images

DEFAULT_QUERY = "abstract calm background soft light"


def _load_backend_env(env_path=None):
    """backend/.env 단순 파싱(fetch.py 와 동일 규칙)."""
    if env_path is None:
        env_path = Path(__file__).resolve().parents[2] / "backend" / ".env"
    conf = {}
    p = Path(env_path)
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            conf[k.strip()] = v.strip().strip('"').strip("'")
    return conf


def pexels_key():
    """PEXELS_API_KEY: 환경변수 우선, 없으면 backend/.env."""
    return (os.environ.get("PEXELS_API_KEY")
            or _load_backend_env().get("PEXELS_API_KEY", "")).strip()


def _pexels_scene(query, out_path, api_key, skip_ids, page=1):
    """Pexels 검색(여러 장 받아 skip_ids 회피) → 다운로드·커버·스크림.

    반환: (경로, photo_id)  — 결과 0건이면 (None, None). HTTPError 는 호출부로 전파.
    """
    from PIL import Image, ImageDraw

    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({
        "query": query, "per_page": 5, "page": page, "orientation": "landscape",
    })
    req = urllib.request.Request(url, headers=_images._pexels_headers(api_key))
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode())
    photos = data.get("photos", [])
    if not photos:
        return None, None
    chosen = None
    for p in photos:
        if p.get("id") not in skip_ids:
            chosen = p
            break
    if chosen is None:
        chosen = photos[0]
    src = chosen["src"].get("large2x") or chosen["src"].get("large")
    _images._download(src, out_path)
    img = Image.open(out_path).convert("RGB")
    img = _images._cover(img, W, H)
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdr = ImageDraw.Draw(scrim)
    for y in range(int(H * 0.55), H):
        a = int(190 * (y - H * 0.55) / (H * 0.45))
        sdr.line([(0, y), (W, y)], fill=(0, 0, 0, a))
    img = Image.alpha_composite(img.convert("RGBA"), scrim).convert("RGB")
    img.save(out_path, quality=90)
    return out_path, chosen.get("id")


def get_scene_backgrounds(item, scenes, keywords, out_dir):
    """장면별 배경 확보. 반환:
      {"paths":[...], "sources":[...], "reasons":[...], "fallbacks":int, "key":bool}
    항상 장면 수만큼 파일을 만든다(실패 시 그라디언트).
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cat = item.get("category", "")
    key = pexels_key()
    cat_q = CATEGORY_QUERY.get(cat, DEFAULT_QUERY)

    if not key:
        print("  [images_v2][경고] PEXELS_API_KEY 없음(환경변수·backend/.env 모두) "
              "→ 전 장면 그라디언트 폴백")

    paths, sources, reasons = [], [], []
    used_ids = set()
    for i, sc in enumerate(scenes):
        out_path = out_dir / f"{i}.jpg"
        kw = (keywords[i] if i < len(keywords) else "").strip() or cat_q
        source, reason = "gradient", ""
        if key:
            # 1) 장면 검색어, 2) 카테고리 기본 검색어(페이지 다르게)
            attempts = [(kw, 1, "scene"), (cat_q, 1 + i, "category")]
            for q, page, label in attempts:
                try:
                    r, pid = _pexels_scene(q, str(out_path), key, used_ids, page=page)
                    if r:
                        if pid is not None:
                            used_ids.add(pid)
                        source, reason = f"pexels:{label}", q
                        break
                    else:
                        reason = f"'{q}' 결과 0건"
                except urllib.error.HTTPError as e:
                    reason = f"HTTP {e.code} {e.reason} ('{q}')"
                    print(f"  [images_v2] 장면 {i} Pexels {reason}")
                except Exception as e:
                    reason = f"{type(e).__name__}: {e} ('{q}')"
                    print(f"  [images_v2] 장면 {i} Pexels 오류 {reason}")
        else:
            reason = "PEXELS_API_KEY 없음"
        if source == "gradient":
            _gradient(cat, str(out_path))
        paths.append(str(out_path))
        sources.append(source)
        reasons.append(reason)

    fallbacks = sum(1 for s in sources if s == "gradient")
    return {"paths": paths, "sources": sources, "reasons": reasons,
            "fallbacks": fallbacks, "key": bool(key)}


if __name__ == "__main__":
    item = {"category": "recovery", "term_ko": "12단계", "term_en": "twelve step"}
    scenes = [{"kind": "body"}, {"kind": "advanced"}, {"kind": "outro"}]
    kws = ["sunrise calm nature", "hands together support", "soft light window"]
    print("PEXELS_API_KEY 감지:", bool(pexels_key()))
    res = get_scene_backgrounds(item, scenes, kws, "images/_test")
    for i, (p, s, r) in enumerate(zip(res["paths"], res["sources"], res["reasons"])):
        print(f"  장면{i}: {s:16s} {r}")
    print("폴백 수:", res["fallbacks"])

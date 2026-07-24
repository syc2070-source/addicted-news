"""
images_v2.py — 장면별 배경 이미지 확보 (v2 지시서 1-2).

기존 images.py 를 재사용:
  - _pexels(query, out, key): Pexels 검색·다운로드·커버·스크림
  - _gradient(cat, out): 카테고리 그라디언트 폴백
  - CATEGORY_QUERY: 카테고리 기본 검색어

장면별로:
  1) DeepSeek 가 준 장면 검색어로 Pexels 검색
  2) 실패 시 카테고리 기본 검색어로 Pexels 재시도
  3) 그래도 실패/키 없음 → 카테고리 그라디언트(항상 파일 생성)

저장 경로: images/{id}/{scene_n}.jpg  (기존 images/{id}.jpg 방식은 그대로 두고 추가)
동일 항목 내 인접 장면이 '같은 사진'이 되지 않도록, 이미 쓴 Pexels 사진 URL/경로는
간단히 피한다(가능하면 page 를 바꿔 재검색).
"""
import os
from pathlib import Path

from images import _gradient, CATEGORY_QUERY, W, H
import images as _images


def _pexels_scene(query, out_path, api_key, skip_ids, page=1):
    """images._pexels 를 살짝 확장: per_page 여러 장 받아 skip_ids 를 피해 고른다."""
    import urllib.request
    import urllib.parse
    import json
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
    """장면별 배경 이미지 경로 리스트 반환. 항상 장면 수만큼 파일을 만든다.

    out_dir: images/{id}/  (없으면 생성)
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cat = item.get("category", "")
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    cat_q = CATEGORY_QUERY.get(cat, "abstract calm background")

    paths = []
    used_ids = set()
    for i, sc in enumerate(scenes):
        out_path = out_dir / f"{i}.jpg"
        kw = (keywords[i] if i < len(keywords) else "").strip() or cat_q
        done = False
        if key:
            for q, page in [(kw, 1), (cat_q, 1 + i)]:
                try:
                    r, pid = _pexels_scene(q, str(out_path), key, used_ids, page=page)
                    if r:
                        if pid is not None:
                            used_ids.add(pid)
                        done = True
                        break
                except Exception as e:
                    print(f"  [images_v2] 장면 {i} Pexels '{q}' 실패:", e)
        if not done:
            _gradient(cat, str(out_path))
        paths.append(str(out_path))
    return paths


if __name__ == "__main__":
    item = {"category": "recovery", "term_ko": "12단계", "term_en": "twelve step"}
    scenes = [{"kind": "body"}, {"kind": "advanced"}, {"kind": "outro"}]
    kws = ["sunrise calm nature", "hands together support", "soft light window"]
    ps = get_scene_backgrounds(item, scenes, kws, "images/_test")
    print(ps)

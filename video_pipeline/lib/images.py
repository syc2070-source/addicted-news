"""
images.py — 항목 주제에 맞는 배경 이미지 확보 (1920×1080).

2단 구조:
  1) PEXELS_API_KEY 가 있으면 → 항목 키워드로 스톡 사진 검색·다운로드 (상업적 무료)
  2) 키가 없거나 검색 실패 → 카테고리별 그라디언트 배경 자동 생성
따라서 키 없이도 파이프라인이 즉시 돌아간다. 나중에 키만 넣으면 사진으로 업그레이드.
"""
import os
import urllib.request
import urllib.parse
import json
from pathlib import Path
from PIL import Image, ImageDraw

W, H = 1920, 1080

# 카테고리별 대표 색 (그라디언트 상·하). 톤: 차분한 학술/의료 계열.
CATEGORY_COLORS = {
    "substance":  ((30, 41, 59),   (71, 85, 105)),
    "mechanism":  ((15, 42, 61),   (30, 74, 92)),
    "recovery":   ((21, 61, 46),   (52, 105, 79)),
    "psychology": ((49, 33, 66),   (91, 63, 112)),
    "policy":     ((45, 38, 26),   (92, 76, 51)),
    "behavioral": ((51, 30, 40),   (105, 60, 78)),
    "diagnosis":  ((26, 45, 51),   (51, 88, 97)),
    "figures":    ((38, 38, 45),   (74, 74, 90)),
    "program":    ((26, 40, 51),   (55, 82, 102)),
    "society":    ((41, 37, 28),   (86, 76, 56)),
}
DEFAULT_COLORS = ((28, 32, 44), (60, 68, 92))

# 스톡 검색용 카테고리 폴백 키워드 (추상 항목이 엉뚱한 사진 안 걸리게)
CATEGORY_QUERY = {
    "substance": "medicine pills abstract",
    "mechanism": "brain neuron abstract",
    "recovery": "sunrise hope calm",
    "psychology": "mind silhouette calm",
    "policy": "law document city",
    "behavioral": "person alone window",
    "diagnosis": "medical health clinic",
    "figures": "portrait history books",
    "program": "group support hands",
    "society": "city crowd people",
}


def _gradient(cat, out_path):
    top, bot = CATEGORY_COLORS.get(cat, DEFAULT_COLORS)
    img = Image.new("RGB", (W, H))
    dr = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        dr.line([(0, y), (W, y)], fill=(r, g, b))
    # 하단 자막 가독성용 어두운 스크림
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdr = ImageDraw.Draw(scrim)
    for y in range(int(H * 0.62), H):
        a = int(150 * (y - H * 0.62) / (H * 0.38))
        sdr.line([(0, y), (W, y)], fill=(0, 0, 0, a))
    img = Image.alpha_composite(img.convert("RGBA"), scrim).convert("RGB")
    img.save(out_path, quality=90)
    return out_path


def _pexels_headers(api_key):
    return {
        "Authorization": api_key,
        # Cloudflare 1010 방지: urllib 기본 UA 없으면 403
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
    }


def _download(url, out_path):
    req = urllib.request.Request(url, headers={
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        Path(out_path).write_bytes(r.read())


def _pexels(query, out_path, api_key):
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({
        "query": query, "per_page": 1, "orientation": "landscape",
    })
    req = urllib.request.Request(url, headers=_pexels_headers(api_key))
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode())
    photos = data.get("photos", [])
    if not photos:
        return None
    src = photos[0]["src"].get("large2x") or photos[0]["src"].get("large")
    _download(src, out_path)
    # 1920×1080 로 커버 리사이즈 + 스크림
    img = Image.open(out_path).convert("RGB")
    img = _cover(img, W, H)
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdr = ImageDraw.Draw(scrim)
    for y in range(int(H * 0.55), H):
        a = int(190 * (y - H * 0.55) / (H * 0.45))
        sdr.line([(0, y), (W, y)], fill=(0, 0, 0, a))
    img = Image.alpha_composite(img.convert("RGBA"), scrim).convert("RGB")
    img.save(out_path, quality=90)
    return out_path


def _cover(img, w, h):
    src_r = img.width / img.height
    dst_r = w / h
    if src_r > dst_r:
        nh = h
        nw = int(h * src_r)
    else:
        nw = w
        nh = int(w / src_r)
    img = img.resize((nw, nh))
    left = (nw - w) // 2
    top = (nh - h) // 2
    return img.crop((left, top, left + w, top + h))


def get_background(item, out_path):
    """항목 → 배경 이미지 파일 경로. 실패해도 항상 파일을 만든다(그라디언트 폴백).

    검색 우선순위:
      1) 항목 영어명(term_en) — 항목마다 다른 사진이 나오도록
      2) 카테고리 영어 키워드 — 1이 결과 없을 때
      3) 그라디언트 — 키 없음 / 둘 다 실패
    """
    cat = item.get("category", "")
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if key:
        queries = []
        term_en = (item.get("term_en") or "").strip()
        if term_en:
            queries.append(term_en)
        queries.append(CATEGORY_QUERY.get(cat, "abstract calm background"))
        for q in queries:
            try:
                r = _pexels(q, out_path, key)
                if r:
                    return r
            except Exception as e:
                print(f"  [images] Pexels '{q}' 실패:", e)
    return _gradient(cat, out_path)


if __name__ == "__main__":
    import urllib.parse
    item = {"category": "recovery", "term_ko": "12단계 프로그램"}
    p = get_background(item, "bg_test.jpg")
    print("배경 생성:", p, Image.open(p).size)

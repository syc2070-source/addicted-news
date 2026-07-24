"""
scenes.py — 챕터(대본 층) + 챕터별 음성 길이 → 배경 전환용 '장면(scene)' 분할. (v2)

설계(지시서 1-1):
  - 3단 구조(요약/본문/심화)의 '층 경계'에서 배경 전환 → 여기서는 실제 대본 kind
    (body/advanced/outro)의 경계를 층 경계로 본다. (script.py 는 별도 요약층이 없고
     body=본문, advanced=심화, outro=아웃트로 구조)
  - 최소 3장면 보장. 층이 3개 미만이면 가장 긴 장면을 챕터(문단) 경계에서 추가 분할.
  - 한 층이 60초를 넘으면 문단(챕터) 경계에서 30~60초 목표로 추가 분할.
  - 장면 경계는 '기존' Edge-TTS 타임스탬프(챕터별 음성 길이)로만 계산 — 추가 STT 없음.
  - 컷 전환이 아니라 크로스페이드(render_v2 가 처리) 전제. 여기서는 시간 경계만 만든다.

반환: [ {"index", "start", "end", "kind", "title"} ] (start/end 초, 오름차순, 연속)
"""

MIN_SCENES = 3
TARGET_SEC = 45.0     # 층 내부 추가 분할 시 장면 목표 길이
MAX_SCENE_SEC = 60.0  # 이보다 긴 층은 문단 경계에서 분할
MIN_SCENE_SEC = 6.0   # 이보다 짧은 잔여 조각은 같은 층 앞 장면에 병합


def _scene(chaps):
    return {
        "start": round(chaps[0]["start"], 3),
        "end": round(chaps[-1]["end"], 3),
        "kind": chaps[0]["kind"],
        "title": chaps[0]["title"],
    }


def _chapter_spans(chapters, durations):
    spans = []
    t = 0.0
    for ch, d in zip(chapters, durations):
        d = max(float(d or 0.0), 0.0)
        spans.append({
            "start": t,
            "end": t + d,
            "kind": ch.get("kind", "body"),
            "title": ch.get("title", ""),
        })
        t += d
    return spans, t


def _split_layer(chaps):
    """한 층(같은 kind 챕터들)을 60초 초과 시 문단 경계에서 30~60초 목표로 분할."""
    ldur = chaps[-1]["end"] - chaps[0]["start"]
    if ldur <= MAX_SCENE_SEC or len(chaps) == 1:
        return [_scene(chaps)]

    out = []
    cur = []
    for c in chaps:
        c_dur = c["end"] - c["start"]
        # 현재 조각이 있고, 이 챕터를 더하면 MAX 초과 → 먼저 현재 조각을 닫는다.
        if cur and (cur[-1]["end"] - cur[0]["start"]) + c_dur > MAX_SCENE_SEC:
            out.append(_scene(cur))
            cur = []
        cur.append(c)
        # 목표 길이 도달 시 닫기(문단 경계에서만)
        if (cur[-1]["end"] - cur[0]["start"]) >= TARGET_SEC:
            out.append(_scene(cur))
            cur = []
    if cur:
        leftover = cur[-1]["end"] - cur[0]["start"]
        if out and leftover < MIN_SCENE_SEC:
            out[-1]["end"] = round(cur[-1]["end"], 3)   # 짧은 잔여는 앞 장면에 붙임
        else:
            out.append(_scene(cur))
    return out


def _boundaries_inside(spans, start, end):
    """(start, end) 내부의 챕터 경계 시각들(오름차순)."""
    bs = []
    for s in spans:
        b = s["start"]
        if start + 0.01 < b < end - 0.01:
            bs.append(b)
    return bs


def _force_min_scenes(scenes, spans):
    """장면 수가 MIN_SCENES 미만이면 가장 긴 장면을 반복 분할."""
    guard = 0
    while len(scenes) < MIN_SCENES and guard < 20:
        guard += 1
        # 가장 긴 장면 선택
        i = max(range(len(scenes)), key=lambda k: scenes[k]["end"] - scenes[k]["start"])
        sc = scenes[i]
        inner = _boundaries_inside(spans, sc["start"], sc["end"])
        if inner:
            # 중앙에 가장 가까운 챕터 경계에서 분할
            mid = (sc["start"] + sc["end"]) / 2.0
            b = min(inner, key=lambda x: abs(x - mid))
        else:
            # 단일 챕터 → 시간 중앙에서 분할(문단 경계 없음, 폴백)
            b = (sc["start"] + sc["end"]) / 2.0
            if b - sc["start"] < 1.0 or sc["end"] - b < 1.0:
                break  # 더 못 쪼갬
        left = {"start": sc["start"], "end": round(b, 3), "kind": sc["kind"], "title": sc["title"]}
        right = {"start": round(b, 3), "end": sc["end"], "kind": sc["kind"], "title": sc["title"]}
        scenes[i:i + 1] = [left, right]
    return scenes


def build_scenes(chapters, durations):
    """챕터 + 챕터별 길이 → 장면 리스트.

    chapters: [{title, kind, ...}]  (script.build_script 의 chapters)
    durations: 각 챕터의 음성 길이(초) — 챕터별 개별 합성으로 측정한 값.
    """
    spans, total = _chapter_spans(chapters, durations)
    if not spans:
        return []

    # 1) 같은 kind 연속 챕터를 하나의 층으로 묶기 (층 경계 = 배경 전환점)
    layers = []
    for s in spans:
        if layers and layers[-1][-1]["kind"] == s["kind"]:
            layers[-1].append(s)
        else:
            layers.append([s])

    # 2) 층별로 60초 초과 시 문단 경계 분할
    scenes = []
    for chaps in layers:
        scenes.extend(_split_layer(chaps))

    # 3) 최소 3장면 보장
    scenes = _force_min_scenes(scenes, spans)

    # 4) 연속·정렬 보정 + 인덱스 부여
    scenes.sort(key=lambda x: x["start"])
    scenes[0]["start"] = 0.0
    scenes[-1]["end"] = round(total, 3)
    for i in range(1, len(scenes)):
        scenes[i]["start"] = scenes[i - 1]["end"]
    for i, sc in enumerate(scenes):
        sc["index"] = i
        sc["dur"] = round(sc["end"] - sc["start"], 3)
    return scenes


# 층(kind) → 목차 라벨. 현재 대본 구조엔 별도 '요약' 층이 없어 body=본문/advanced=심화.
# outro(마지막 챕터)는 "마무리". (업로드 설명은 upload_youtube.TOC_LABELS 로 표시 시점 매핑)
KIND_LABEL = {"body": "본문", "advanced": "심화", "outro": "마무리"}


def layer_toc(chapters, durations):
    """kind 층이 바뀌는 지점마다 목차 항목 생성 → [{kind, label, start}]. (업로드 설명 TOC용)"""
    spans, _ = _chapter_spans(chapters, durations)
    toc = []
    last = None
    for s in spans:
        if s["kind"] != last:
            toc.append({
                "kind": s["kind"],
                "label": KIND_LABEL.get(s["kind"], s["kind"]),
                "start": round(s["start"], 3),
            })
            last = s["kind"]
    return toc


if __name__ == "__main__":
    demo_chapters = [
        {"title": "정의", "kind": "body"},
        {"title": "특징", "kind": "body"},
        {"title": "기전", "kind": "advanced"},
        {"title": "중독뉴스", "kind": "outro"},
    ]
    demo_durs = [40, 55, 30, 5]
    for sc in build_scenes(demo_chapters, demo_durs):
        print(f"[{sc['index']}] {sc['kind']:8s} {sc['start']:6.1f}~{sc['end']:6.1f} "
              f"({sc['dur']:4.1f}s) {sc['title']}")

# -*- coding: utf-8 -*-
"""
중독백과 172개 항목 한→영 번역 (DeepSeek).
- 입력: translate_input.json (한국어 요약/사례/본문/심화)
- 출력: translate_output.json (영어 definition_en/example_en/body_en/advanced_en)
- 행동중독 17개는 en_behavioral_manual.json (Claude 수작업 번역)로 대체, DeepSeek 건너뜀.
- 실패/구조 오류 시 재시도. 진행상황 파일 저장(중단 후 재개 가능).

실행:
  set DEEPSEEK_API_KEY=sk-...
  python translate_deepseek.py
필요: pip install openai   (DeepSeek는 OpenAI 호환 엔드포인트)
"""
import os, json, time, sys

INPUT = "translate_input.json"
MANUAL = "en_behavioral_manual.json"   # 행동중독 17개 수작업 영어(있으면 사용)
OUTPUT = "translate_output.json"
PROGRESS = "translate_progress.json"   # 중간 저장(재개용)

MODEL = "deepseek-chat"
API_BASE = "https://api.deepseek.com"
MAX_RETRY = 3

SYSTEM = (
    "You are a professional translator specializing in addiction science, psychiatry, "
    "and public health. Translate Korean encyclopedia entries into clear, natural English "
    "for an educated general audience. Rules:\n"
    "1) Use standard clinical English terms (DSM-5-TR / ICD-11 terminology). E.g. "
    "'물질사용장애'->'substance use disorder', '금단'->'withdrawal', '내성'->'tolerance', "
    "'갈망'->'craving', '피해감소'->'harm reduction', '재발'->'relapse', "
    "'회복자본'->'recovery capital', '동기강화상담'->'motivational interviewing'.\n"
    "2) Preserve meaning faithfully; do NOT add or omit content. Keep the calm, "
    "non-stigmatizing, person-centered tone. Use person-first language.\n"
    "3) For sensitive topics (eating disorders, self-harm), never add methods or numbers; "
    "keep the supportive, non-triggering framing of the source.\n"
    "4) Return ONLY valid JSON, no markdown, no commentary.\n"
    "5) Keep the exact JSON structure given. 'body' and 'advanced' are arrays of "
    "objects with keys 'h' (heading) and 'p' (paragraph). Translate both h and p."
)

def build_user(entry):
    payload = {
        "definition": entry["definition"],
        "example": entry.get("example", ""),
        "body": entry["body"],
        "advanced": entry["advanced"],
    }
    return (
        f"Translate this Korean addiction-encyclopedia entry to English.\n"
        f"Term (for context): {entry['term_ko']} / {entry['term_en']} "
        f"(category: {entry['category']}).\n\n"
        f"Return JSON with EXACTLY these keys: definition_en (string), "
        f"example_en (string), body_en (array of {{h,p}}), advanced_en (array of {{h,p}}). "
        f"body_en must have the same number of items as body; advanced_en same as advanced.\n\n"
        f"SOURCE JSON:\n{json.dumps(payload, ensure_ascii=False)}"
    )

def valid(entry, res):
    if not isinstance(res, dict): return False
    for k in ("definition_en","example_en","body_en","advanced_en"):
        if k not in res: return False
    if not isinstance(res["body_en"], list) or not isinstance(res["advanced_en"], list):
        return False
    if len(res["body_en"]) != len(entry["body"]): return False
    if len(res["advanced_en"]) != len(entry["advanced"]): return False
    for seg in res["body_en"] + res["advanced_en"]:
        if not isinstance(seg, dict) or "h" not in seg or "p" not in seg: return False
    return True

def translate_one(client, entry):
    for attempt in range(1, MAX_RETRY+1):
        try:
            r = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role":"system","content":SYSTEM},
                    {"role":"user","content":build_user(entry)},
                ],
                temperature=0.2,
                response_format={"type":"json_object"},
                max_tokens=4000,
            )
            txt = r.choices[0].message.content.strip()
            txt = txt.replace("```json","").replace("```","").strip()
            res = json.loads(txt)
            if valid(entry, res):
                return res
            print(f"  [구조오류 재시도 {attempt}] {entry['id']}", file=sys.stderr)
        except Exception as e:
            print(f"  [예외 재시도 {attempt}] {entry['id']}: {e}", file=sys.stderr)
            time.sleep(2*attempt)
    return None  # 실패

def main():
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        print("환경변수 DEEPSEEK_API_KEY 를 설정하세요.", file=sys.stderr); sys.exit(1)
    try:
        from openai import OpenAI
    except ImportError:
        print("pip install openai 필요", file=sys.stderr); sys.exit(1)
    client = OpenAI(api_key=key, base_url=API_BASE)

    data = json.load(open(INPUT, encoding="utf-8"))
    by_id = {e["id"]: e for e in data}

    # 수작업 행동중독 영어 로드(있으면)
    manual = {}
    if os.path.exists(MANUAL):
        manual = json.load(open(MANUAL, encoding="utf-8"))
        print(f"수작업 영어 {len(manual)}개 로드(행동중독). DeepSeek 건너뜀.")

    # 진행상황 재개
    out = {}
    if os.path.exists(PROGRESS):
        out = json.load(open(PROGRESS, encoding="utf-8"))
        print(f"이전 진행 {len(out)}개 이어서 진행.")

    failed = []
    total = len(data)
    for i, e in enumerate(data, 1):
        eid = e["id"]
        if eid in out:  # 이미 됨
            continue
        if eid in manual:  # 수작업 대체
            out[eid] = manual[eid]
            # 수작업도 저장
            if i % 5 == 0:
                json.dump(out, open(PROGRESS,"w", encoding="utf-8"), ensure_ascii=False, indent=1)
            continue
        print(f"[{i}/{total}] {eid} ({e['term_ko']}) 번역...")
        res = translate_one(client, e)
        if res is None:
            failed.append(eid)
            print(f"  실패: {eid}", file=sys.stderr)
        else:
            out[eid] = res
        # 매 5개마다 진행 저장
        if i % 5 == 0:
            json.dump(out, open(PROGRESS,"w", encoding="utf-8"), ensure_ascii=False, indent=1)

    json.dump(out, open(PROGRESS,"w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(out, open(OUTPUT,"w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n완료: {len(out)}/{total} 성공, 실패 {len(failed)}개")
    if failed:
        print("실패 목록:", failed)
        print("다시 실행하면 실패분만 재시도합니다(진행상황 저장됨).")

if __name__ == "__main__":
    main()

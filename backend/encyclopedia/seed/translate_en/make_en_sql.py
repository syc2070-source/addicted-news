# -*- coding: utf-8 -*-
"""
번역 결과(translate_output.json)를 검증하고 영어 주입 SQL 생성.
- 172개 모두 있는지, 구조(4필드, body/advanced 길이) 검증.
- definition_en/example_en/body_en/advanced_en 만 UPDATE (한국어 미변경).
실행: python make_en_sql.py
출력: inject_english.sql
"""
import json, sys, os

INPUT_KO = "translate_input.json"      # 원본(길이 검증용)
OUTPUT   = "translate_output.json"     # DeepSeek+수작업 결과
SQL      = "inject_english.sql"

ko = {e["id"]: e for e in json.load(open(INPUT_KO, encoding="utf-8"))}
if not os.path.exists(OUTPUT):
    print(f"{OUTPUT} 없음. 먼저 translate_deepseek.py 실행.", file=sys.stderr); sys.exit(1)
en = json.load(open(OUTPUT, encoding="utf-8"))

# 검증
problems=[]
for eid, src in ko.items():
    if eid not in en:
        problems.append(f"{eid}: 번역 없음"); continue
    r = en[eid]
    for k in ("definition_en","example_en","body_en","advanced_en"):
        if k not in r: problems.append(f"{eid}: {k} 없음")
    if isinstance(r.get("body_en"),list) and len(r["body_en"])!=len(src["body"]):
        problems.append(f"{eid}: body 길이 {len(r['body_en'])}≠{len(src['body'])}")
    if isinstance(r.get("advanced_en"),list) and len(r["advanced_en"])!=len(src["advanced"]):
        problems.append(f"{eid}: advanced 길이 {len(r['advanced_en'])}≠{len(src['advanced'])}")

if problems:
    print(f"검증 실패 {len(problems)}건:")
    for p in problems[:30]: print("  -", p)
    print("위 항목을 먼저 해결(재번역)하세요. SQL 생성 중단.")
    sys.exit(1)

def esc(s): return s.replace("'","''")
def jb(o): return "'"+esc(json.dumps(o,ensure_ascii=False))+"'::jsonb"
def tx(s): return "'"+esc(s)+"'"

lines=["-- 중독백과 영어화: definition_en/example_en/body_en/advanced_en 주입",
       "-- 한국어 컬럼 미변경. id 기준 UPDATE. 주석은 -- 만 사용.",
       "-- 실행: psql -h localhost -U postgres -d addiction_news -f backend/translate_en/inject_english.sql",
       "BEGIN;"]
for eid in ko:
    r=en[eid]
    lines.append(
      f"UPDATE encyclopedia_terms SET definition_en={tx(r['definition_en'])}, "
      f"example_en={tx(r['example_en'])}, body_en={jb(r['body_en'])}, "
      f"advanced_en={jb(r['advanced_en'])}, updated_at=now() WHERE id='{eid}';")
lines.append("COMMIT;")
lines.append("-- 확인: 영어 채워진 개수")
lines.append("SELECT category, count(*) FILTER (WHERE definition_en <> '') AS with_en, "
             "count(*) AS total FROM encyclopedia_terms GROUP BY category ORDER BY category;")
open(SQL,"w", encoding="utf-8").write("\n".join(lines)+"\n")
print(f"검증 통과. {len(ko)}개.")
print(f"생성: {SQL} ({os.path.getsize(SQL)} bytes)")

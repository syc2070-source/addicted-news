import json
from pathlib import Path

base = Path(__file__).parent
ko = {e["id"]: e for e in json.load(open(base / "translate_input.json", encoding="utf-8"))}
man = json.load(open(base / "en_behavioral_manual.json", encoding="utf-8"))
probs = []
for eid, r in man.items():
    if eid not in ko:
        probs.append(eid + " missing ko")
        continue
    if len(r["body_en"]) != len(ko[eid]["body"]):
        probs.append(f"{eid} body {len(r['body_en'])}!={len(ko[eid]['body'])}")
    if len(r["advanced_en"]) != len(ko[eid]["advanced"]):
        probs.append(f"{eid} adv {len(r['advanced_en'])}!={len(ko[eid]['advanced'])}")
print("manual", len(man), "problems", len(probs))
for p in probs:
    print(" ", p)
print("need_deepseek", 172 - len(man))

# -*- coding: utf-8 -*-
"""
pronounce.py — 낭독 전 발음 교정.

Edge-TTS가 한글 문맥에서 영어 약어를 뭉개 읽는 문제를 막는다.
음성 합성 직전에만 적용(자막은 원문 약어 유지 — subs.py에서 역치환).

분류 원칙:
  - 이니셜리즘(낱자로 읽음): ADHD→에이디에이치디
  - 애크로님(단어로 읽음): SMART, GABA 등은 Edge-TTS가 잘 읽으므로 치환 안 함
  - 복합형(약어+숫자): DSM-5→디에스엠 5
백과 172개 전수조사(56종) 기준으로 확정.
"""
import re

# 약어+하이픈+숫자/접미 복합형 — 먼저 처리. (약어는 낱자, 숫자는 살림)
# 가장 긴 것부터 매칭되도록 아래 for_speech에서 길이 정렬.
COMPOUND = {
    "addictionnews.net": "애딕션뉴스 닷넷",
    "DSM-5-TR": "디에스엠 5 티아르",
    "DSM-5":    "디에스엠 5",
    "DSM-IV":   "디에스엠 4",
    "ICD-11":   "아이씨디 11",
    "GLP-1":    "지엘피 원",
    "BARC-10":  "바크 10",
    "CIWA-Ar":  "시와 에이아르",
    "GABA-A":   "가바 에이",
    "5-HT2A":   "파이브 에이치티 투 에이",
    "HT2A":     "에이치티 투 에이",
    "CB1":      "씨비 원",
    "CB2":      "씨비 투",
    "HPA":      "에이치피에이",   # 'HPA축' → 에이치피에이 축
}

# 이니셜리즘 — 낱자로 읽음
INITIALISM = {
    "ADHD": "에이디에이치디",
    "PTSD": "피티에스디",
    "ROSC": "알오에스씨",
    "HIV":  "에이치아이브이",
    "HPPD": "에이치피피디",
    "WHO":  "더블유에이치오",
    "DSM":  "디에스엠",
    "GA":   "지에이",
    "MDMA": "엠디엠에이",
    "PCP":  "피씨피",
    "LSD":  "엘에스디",
    "MAT":  "엠에이티",
    "NA":   "엔에이",
    "CBD":  "씨비디",
    "GHB":  "지에이치비",
    "OCD":  "오씨디",
    "THC":  "티에이치씨",
    "HAT":  "에이치에이티",
    "UNODC": "유엔오디씨",
    "CBT":  "씨비티",
    "ICD":  "아이씨디",
    "ACE":  "에이씨이",
    "DBT":  "디비티",
    "AVE":  "에이브이이",
    "CRF":  "씨아르에프",
    "CSA":  "씨에스에이",
    "NMDA": "엔엠디에이",
    "SCS":  "에스씨에스",
    "SNS":  "에스엔에스",
    "VTA":  "브이티에이",
    "EMCDDA": "이엠씨디디에이",
    "MBRP": "엠비아르피",
    "MDFT": "엠디에프티",
    "MOUD": "엠오유디",
    "NIDA": "엔아이디에이",
    "UNAIDS": "유엔에이즈",
    "AA":   "에이에이",
    "OARS": "오에이알에스",
    "CRAFT": "크래프트",
}

# 애크로님/원음 유지 — Edge-TTS가 이미 잘 읽으므로 치환하지 않음(참고용, 실제 치환 X):
#   SMART(스마트), GABA(가바), EVALI(에발리), FOMO(포모), PAWS(퍼스), GLP…
#   위 목록에 넣지 않은 약어는 그대로 둔다.

# 역치환(자막 복원)에서 쓰도록 통합 사전 노출
ABBR = {}
ABBR.update(INITIALISM)
# 복합형은 발음("디에스엠 5")→원문("DSM-5") 복원이 필요하므로 별도 노출.
# subs.py 가 이 맵으로 자막에서 원문 하이픈 형태를 복원한다.
COMPOUND_READ2ORIG = {read: orig for orig, read in COMPOUND.items()}


def _sub_word(text, abbr, read):
    pattern = r"(?<![A-Za-z0-9])" + re.escape(abbr) + r"(?![A-Za-z0-9])"
    return re.sub(pattern, read, text)


def for_speech(text):
    """음성 합성용: 약어를 한글 발음으로 치환한 텍스트."""
    if not text:
        return text
    out = text
    # 1) 복합형 먼저 (긴 것부터)
    for abbr in sorted(COMPOUND, key=len, reverse=True):
        pattern = r"(?<![A-Za-z0-9])" + re.escape(abbr) + r"(?![A-Za-z0-9])"
        out = re.sub(pattern, COMPOUND[abbr], out)
    # 2) 이니셜리즘 (긴 것부터, 부분일치 방지)
    for abbr in sorted(INITIALISM, key=len, reverse=True):
        out = _sub_word(out, abbr, INITIALISM[abbr])
    return out


if __name__ == "__main__":
    tests = [
        "ADHD와 PTSD, 그리고 OCD는 흔히 동반된다.",
        "DSM-5-TR과 ICD-11 기준을 쓴다.",
        "AA는 NA·GA의 모태다.",
        "GLP-1 약물이 갈망을 줄인다.",
        "SMART 리커버리와 GABA 수용체.",   # 치환 안 됨(원음)
        "HPA축과 5-HT2A 수용체.",
        "ROSC는 회복지향 시스템이다.",
    ]
    for t in tests:
        print(t)
        print("  →", for_speech(t))

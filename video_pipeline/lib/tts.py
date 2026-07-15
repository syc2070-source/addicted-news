"""
tts.py — 낭독 대본 → 음성(mp3) + 자막 타이밍 마크.

★ 음성 교체 지점 ★
synth(text, out_mp3) -> marks 시그니처만 유지하면
나중에 '내 목소리' 로컬 클론으로 이 함수만 교체 가능.

[중요] 한국어 Edge-TTS는 WordBoundary를 잘 주지 않아, SentenceBoundary를 함께 처리한다.
       (WordBoundary만 쓰면 자막 0줄 문제 발생 → 문장 경계로 타이밍을 잡는다.)
[발음] 음성 합성 직전 for_speech()로 약어/URL을 한글 발음으로 치환.
       자막은 subs.py가 원문으로 역치환하므로, 여기 marks의 text는 '발음형'이어도 된다.

marks 형식: [ {"word": str(문장/구간 텍스트), "start": float, "end": float} ]
"""
import asyncio
import edge_tts
from pronounce import for_speech

VOICE = "ko-KR-InJoonNeural"   # 남성. 여성: ko-KR-SunHiNeural
RATE = "+0%"
PITCH = "+0Hz"


async def _synth_async(text, out_mp3):
    comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
    marks = []
    with open(out_mp3, "wb") as f:
        async for chunk in comm.stream():
            ctype = chunk["type"]
            if ctype == "audio":
                f.write(chunk["data"])
            elif ctype in ("WordBoundary", "SentenceBoundary"):
                start = chunk["offset"] / 1e7
                dur = chunk["duration"] / 1e7
                marks.append({
                    "word": chunk["text"],
                    "start": round(start, 3),
                    "end": round(start + dur, 3),
                })
    return marks


def synth(text, out_mp3):
    """대본 text → 음성 합성(발음 교정 적용) + marks."""
    spoken = for_speech(text)
    return asyncio.run(_synth_async(spoken, out_mp3))


if __name__ == "__main__":
    marks = synth("ADHD는 흔한 장애다. DSM-5로 진단한다. addictionnews.net 참고.", "sample.mp3")
    print("마크 수:", len(marks))
    for m in marks[:8]:
        print(f"  {m['start']:6.2f}–{m['end']:6.2f}  {m['word']}")

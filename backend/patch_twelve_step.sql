-- twelve-step: 12단계 실제 내용 문단 추가(한/영). 본문 '무엇인가' 다음 삽입.
-- AA 공식 문구 복제 아님 — 각 단계 핵심 재서술.
-- 실행: psql -h localhost -U postgres -d addiction_news -f patch_twelve_step.sql
BEGIN;

-- 한국어: 현재 body 를 읽어 2번째 위치에 삽입 (jsonb_insert)
UPDATE encyclopedia_terms
SET body = jsonb_insert(
  body,
  '{1}',
  '{"h": "12단계는 어떤 단계인가", "p": "12단계는 크게 세 흐름으로 이해할 수 있다. 먼저 인정과 내맡김이다. ①중독 앞에서 자신이 무력함을 인정하고, ②자기를 넘어선 더 큰 힘의 도움을 믿으며, ③그 힘에 자신을 맡기기로 결심한다. 다음은 성찰과 정리다. ④두려움 없이 자신을 도덕적으로 살펴보고, ⑤그 잘못을 자신과 타인, 그리고 더 큰 존재 앞에 솔직히 인정하며, ⑥⑦자신의 결점을 내려놓을 준비를 하고 그것이 사라지기를 겸손히 구한다. 마지막은 관계 회복과 실천이다. ⑧자신이 해를 끼친 사람들의 목록을 만들어 ⑨가능한 한 직접 보상하고(단, 그로 인해 누군가 다치지 않는 한), ⑩계속 자신을 살펴 잘못이 있으면 즉시 인정하며, ⑪기도와 성찰로 영적 접촉을 이어가고, ⑫이 각성을 바탕으로 다른 중독자를 돕고 이 원리를 삶의 모든 영역에서 실천한다. 특정 종교의 교리가 아니라 ''자기를 넘어선 힘''에 대한 열린 이해 위에 서 있어, 각자의 신앙이나 세계관에 맞춰 받아들일 수 있도록 설계되어 있다."}'::jsonb
),
updated_at = now()
WHERE id = 'twelve-step';

-- 영어: 동일 위치 삽입 (translate_output.json 없이도 문단은 고정값이라 바로 삽입)
UPDATE encyclopedia_terms
SET body_en = jsonb_insert(
  body_en,
  '{1}',
  '{"h": "What are the twelve steps", "p": "The twelve steps can be understood in three broad movements. First comes admission and surrender: (1) admitting powerlessness over the addiction, (2) coming to believe that a power greater than oneself can help, and (3) deciding to turn oneself over to that power. Next comes reflection and reckoning: (4) making a fearless moral inventory of oneself, (5) admitting those wrongs honestly to oneself, to others, and to a greater being, and (6-7) becoming ready to let go of one''s defects and humbly asking that they be removed. Last comes repairing relationships and practice: (8) listing the people one has harmed and (9) making direct amends wherever possible, except when doing so would injure someone, (10) continuing to take personal inventory and promptly admitting wrongs, (11) sustaining spiritual contact through prayer and reflection, and (12) carrying this awakening to help other addicts and practicing these principles in all areas of life. Standing on an open understanding of a ''power greater than oneself'' rather than the doctrine of any particular religion, it is designed to be received in accordance with each person''s own faith or worldview."}'::jsonb
),
updated_at = now()
WHERE id = 'twelve-step';

COMMIT;

-- 확인 (한/영 모두 5개여야):
SELECT id, jsonb_array_length(body) AS ko, jsonb_array_length(body_en) AS en
FROM encyclopedia_terms
WHERE id = 'twelve-step';

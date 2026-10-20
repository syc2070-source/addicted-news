// ============================================================
// broadcast_gate.ts (NEWS-Q11 ■2) — 방송 전용 관문.
// 방송 후보는 기사 관문(사건·분류·확신 3 칸)을 거치지 않고 이것 하나만:
//   핵심어(0원 · 분야 설정 sources.broadcast.keywords) ∧ DeepSeek 한 질문(분야 설정 prompts.broadcast_gate)
//   → yes = publish(방송 줄) · partial = archive(방송 보관층 · 포털 비노출) · no = reject(topic_fit_false)
// 판정이 없으면(호출 실패·칸 누락) 저장도 거부도 하지 않는다(fail-closed · 다음 실행이 다시 본다).
// 거부 사유 = no_keyword(세기만 · 격리 0) · topic_fit_false(격리 rejected_articles 'broadcast:topic_fit_false') · duplicate(세기만).
// ============================================================
import { fieldProfile } from './field_profile';
import { keywordGroupNames, OTHER_GROUP } from './keyword_groups';
import type { BroadcastItem } from './broadcast';

export type BroadcastTopic = 'yes' | 'partial' | 'no';

export interface BroadcastVerdict {
  topic: BroadcastTopic;
  /** 하위 주제(분야 설정 keywords.groups 이름 · 모르면 기타) */
  subtopic: string;
  summary: string;
}

export type BroadcastGateReason =
  | 'no_keyword'
  | 'topic_fit_false'
  | 'duplicate'
  | 'judgment_missing';

export type BroadcastGateDecision =
  | { action: 'publish'; subtopic: string }
  | { action: 'archive'; subtopic: string }
  | { action: 'reject'; reason: 'topic_fit_false'; subtopic: string }
  | { action: 'skip'; reason: 'judgment_missing' };

/** 실행 하나의 방송 관문 수(per_source.__run.broadcastGate · health runs). */
export interface BroadcastGateStats {
  seen: number;
  keywordPass: number;
  judged: number;
  publish: number;
  archive: number;
  reject: Record<BroadcastGateReason, number>;
  subtopics: Record<string, number>;
}

export function emptyBroadcastGateStats(): BroadcastGateStats {
  return {
    seen: 0,
    keywordPass: 0,
    judged: 0,
    publish: 0,
    archive: 0,
    reject: {
      no_keyword: 0,
      topic_fit_false: 0,
      duplicate: 0,
      judgment_missing: 0,
    },
    subtopics: {},
  };
}

const FORMAT_TAIL =
  '\n\n반드시 아래 JSON 하나만 출력(설명·코드펜스 금지): ' +
  '{"fit":"yes|partial|no","subtopic":"하위 주제 하나","summary":"한국어 2~3문장"}';

/** 시스템 지시 = 분야 설정 prompts.broadcast_gate + 하위 주제 후보 + 출력 꼴. 설정이 없으면 null(판정 0). */
export function broadcastGateSystem(): string | null {
  const base = (fieldProfile().prompts.broadcast_gate || '').trim();
  if (!base) return null;
  const names = keywordGroupNames();
  const sub = names.length
    ? `\nsubtopic 후보: ${names.join(' · ')} (이 가운데 하나 · 모르면 ${OTHER_GROUP})`
    : '';
  return `${base}${sub}${FORMAT_TAIL}`;
}

export function buildBroadcastGateUser(
  item: Pick<BroadcastItem, 'title' | 'description'>,
  program: string,
): string {
  const desc = (item.description || '').trim().slice(0, 2500);
  return `프로그램: ${program}\n제목: ${item.title}\n\n설명:\n${desc || '(설명 없음)'}`;
}

/** 응답 칸 → 글(글·숫자·참거짓만 · 그 밖은 빈 글). */
function text(v: unknown): string {
  return typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
    ? String(v)
    : '';
}

/** DeepSeek 응답 → 판정(칸이 틀리면 null). */
export function parseBroadcastVerdict(
  obj: Record<string, unknown> | null,
): BroadcastVerdict | null {
  if (!obj) return null;
  const raw = text(obj.fit).trim().toLowerCase();
  const topic: BroadcastTopic | null =
    raw === 'yes' || raw === 'true'
      ? 'yes'
      : raw === 'partial'
        ? 'partial'
        : raw === 'no' || raw === 'false'
          ? 'no'
          : null;
  if (!topic) return null;
  const names = keywordGroupNames();
  const s = text(obj.subtopic).trim();
  const subtopic = !names.length
    ? s || OTHER_GROUP
    : names.find((n) => n === s) ||
      names.find((n) => s && s.includes(n)) ||
      OTHER_GROUP;
  return { topic, subtopic, summary: text(obj.summary).trim() };
}

/** 판정 → 저장 층(판정 없음 = 건너뜀 · 다음 실행이 다시 본다). */
export function decideBroadcastGate(
  verdict: BroadcastVerdict | null,
): BroadcastGateDecision {
  if (!verdict) return { action: 'skip', reason: 'judgment_missing' };
  if (verdict.topic === 'yes')
    return { action: 'publish', subtopic: verdict.subtopic };
  if (verdict.topic === 'partial')
    return { action: 'archive', subtopic: verdict.subtopic };
  return {
    action: 'reject',
    reason: 'topic_fit_false',
    subtopic: verdict.subtopic,
  };
}

// ============================================================
// domain_blacklist.ts (v5.4) — 딥시크 호출 전 0원 필터
// - 블랙리스트 도메인 기사는 딥시크 호출 없이 즉시 폐기(API 비용 절감).
// - 자동 확장: 동일 도메인에서 category_fit=false 가 THRESHOLD(3회) 이상이면
//   런타임 블랙리스트에 추가 + Discord 알림.
// - 초기 목록은 data/domain_blacklist.json.
// ============================================================
import * as fs from 'fs';
import * as path from 'path';

const AUTO_ADD_THRESHOLD = Number(process.env.DOMAIN_AUTOADD_THRESHOLD ?? 3);

function normalizeHost(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    // URL 파싱 실패 시 도메인처럼 보이면 그대로
    const s = String(url).trim().toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
  }
}

function loadSeed(): Set<string> {
  const p = path.join(__dirname, '../../data/domain_blacklist.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { domains?: string[] };
    return new Set((raw.domains || []).map((d) => d.toLowerCase().replace(/^www\./, '')));
  } catch {
    return new Set();
  }
}

const blacklist: Set<string> = loadSeed();
const runtimeAdded: string[] = [];      // 이번 실행에서 자동 추가된 도메인
const catFitFailCount: Map<string, number> = new Map();

/** 도메인이 블랙리스트에 있으면 true (sourceUrl·googleUrl 어느 쪽이든) */
export function isBlacklistedDomain(sourceUrl?: string, googleUrl?: string): boolean {
  const host = normalizeHost(sourceUrl) || normalizeHost(googleUrl);
  return host ? blacklist.has(host) : false;
}

/**
 * category_fit=false 판정을 도메인별로 누적. 임계 도달 시 블랙리스트 자동 추가.
 * 새로 추가되면 도메인 문자열 반환(호출측이 Discord 알림), 아니면 null.
 */
export function recordCategoryFitFail(sourceUrl?: string, googleUrl?: string): string | null {
  const host = normalizeHost(sourceUrl) || normalizeHost(googleUrl);
  if (!host || blacklist.has(host)) return null;
  const n = (catFitFailCount.get(host) || 0) + 1;
  catFitFailCount.set(host, n);
  if (n >= AUTO_ADD_THRESHOLD) {
    blacklist.add(host);
    runtimeAdded.push(host);
    return host;
  }
  return null;
}

export function getBlacklistSnapshot(): { size: number; runtimeAdded: string[] } {
  return { size: blacklist.size, runtimeAdded: [...runtimeAdded] };
}

// 테스트용: 상태 초기화
export function _resetBlacklistState(): void {
  runtimeAdded.length = 0;
  catFitFailCount.clear();
}

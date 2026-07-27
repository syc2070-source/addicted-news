// 날짜/시간 표시 유틸. publishedAt은 varchar(예: "2026-07-26" 또는 ISO).
export function fmtDate(v?: string | null): string {
  if (!v) return '';
  const s = String(v);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s.slice(0, 10);
}

export function fmtMonthDay(v?: string | null): string {
  const d = fmtDate(v);
  const m = d.match(/\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}` : d;
}

// "속보 브리핑" 시각. ISO에 시간이 있으면 HH:MM, 없으면 날짜.
export function fmtTime(v?: string | null): string {
  if (!v) return '';
  const t = String(v).match(/T(\d{2}):(\d{2})/);
  if (t) return `${t[1]}:${t[2]}`;
  return fmtMonthDay(v);
}

export function topKeywords(articles: Array<{ keywords: string[] | null }>, n = 5): string[] {
  const freq = new Map<string, number>();
  for (const a of articles) {
    for (const k of a.keywords ?? []) {
      const key = k.trim();
      if (key.length >= 2) freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

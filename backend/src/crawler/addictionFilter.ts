// backend/src/crawler/addictionFilter.ts
import * as fs from 'fs';
import * as path from 'path';

type LangKeys = { ko?: string[]; en?: string[] };
type KeywordFile = {
  strong?: LangKeys;
  negative?: LangKeys;
  ko?: string[];
  en?: string[];
};

type Loaded = { strong: string[]; negative: string[] };

let cached: Loaded | null = null;

function flattenLang(block?: LangKeys): string[] {
  if (!block) return [];
  return [...(block.ko || []), ...(block.en || [])].filter(Boolean);
}

function loadKeywords(): Loaded {
  if (cached) return cached;
  const p = path.join(__dirname, '../../data/addiction_keywords.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as KeywordFile;
    if (raw.strong || raw.negative) {
      cached = {
        strong: flattenLang(raw.strong),
        negative: flattenLang(raw.negative),
      };
    } else {
      cached = {
        strong: [...(raw.ko || []), ...(raw.en || [])].filter(Boolean),
        negative: [],
      };
    }
  } catch {
    cached = { strong: ['중독', 'addiction'], negative: [] };
  }
  return cached;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 한글/공백 포함 구문: 부분문자열.
 * 영문 단일 토큰: 단어 경계(rehab ≠ rehabilitation, dui ≠ medium 등).
 */
function textHasKeyword(text: string, keyword: string): boolean {
  const key = (keyword || '').toLowerCase().trim();
  if (!key) return false;
  const hasNonAscii = /[^\u0000-\u007f]/.test(key);
  if (hasNonAscii || key.includes(' ')) {
    return text.includes(key);
  }
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(key)}(?:[^a-z0-9]|$)`, 'i');
  return re.test(text);
}

/**
 * 채택 = (strong >= 1) AND (negative == 0)
 * 제목+본문, 한/영 함께 소문자 비교.
 */
export function matchesAddictionKeywords(title: string, body: string): boolean {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  if (!text.trim()) return false;
  const { strong, negative } = loadKeywords();
  const strongHit = strong.some((k) => textHasKeyword(text, k));
  if (!strongHit) return false;
  const negHit = negative.some((k) => textHasKeyword(text, k));
  return !negHit;
}

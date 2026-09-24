import type { PoiSearchable } from './types';

export interface RankedMatch<T> {
  readonly item: T;
  readonly score: number;
}

/** 归一化检索文本：NFKC 折叠 + 去首尾空白 + 小写。 */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase();
}

const SCORE_EXACT = 100;
const SCORE_PREFIX = 80;
const SCORE_INCLUDES = 60;
const SCORE_ALL_TOKENS = 50;
const DEFAULT_LIMIT = 50;

/**
 * POI 模糊检索：整串前缀/包含优先，其次要求空格分词全部命中。
 * 结果按分数降序、同分按名称升序，最多返回 limit 条。
 */
export function searchPois<T extends PoiSearchable>(
  items: readonly T[],
  rawQuery: string,
  limit = DEFAULT_LIMIT,
): RankedMatch<T>[] {
  const query = normalizeSearchText(rawQuery);
  if (query.length === 0) {
    return [];
  }
  const tokens = query.split(/\s+/u).filter((token) => token.length > 0);

  const matches: RankedMatch<T>[] = [];
  for (const item of items) {
    const score = scoreOf(item, query, tokens);
    if (score > 0) {
      matches.push({ item, score });
    }
  }
  matches.sort((a, b) => b.score - a.score || a.item.displayName.localeCompare(b.item.displayName));
  return matches.slice(0, limit);
}

function haystackOf(item: PoiSearchable): string {
  return normalizeSearchText([item.displayName, ...(item.keywords ?? [])].join(' '));
}

function scoreOf(item: PoiSearchable, query: string, tokens: readonly string[]): number {
  const haystack = haystackOf(item);
  const name = normalizeSearchText(item.displayName);
  if (name === query) {
    return SCORE_EXACT;
  }
  if (name.startsWith(query)) {
    return SCORE_PREFIX;
  }
  if (haystack.includes(query)) {
    return SCORE_INCLUDES;
  }
  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) {
    return SCORE_ALL_TOKENS;
  }
  return 0;
}

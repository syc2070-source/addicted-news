import type { DeepPartial, Repository } from 'typeorm';
import { Article } from '../articles/article.entity';

export interface RawBodyWriteState { unavailable: boolean; }

function missingRawBody(error: unknown): boolean {
  const outer = error as { code?: string; message?: string; driverError?: { code?: string; message?: string } };
  const inner = outer?.driverError ?? outer;
  return inner?.code === '42703' && /\braw_body\b/i.test(String(inner.message ?? outer?.message ?? ''));
}

/** Explicit columns matter: merely deleting a property still makes TypeORM INSERT its DEFAULT. */
export async function insertArticleWithRawBody(
  repo: Repository<Article>,
  values: DeepPartial<Article>,
  state: RawBodyWriteState,
  warn: (line: string) => void = console.warn,
): Promise<number | null> {
  const insert = async (includeRaw: boolean) => {
    const payload = { ...values };
    if (!includeRaw) delete payload.rawBody;
    const columns = Object.keys(payload).filter((key) => payload[key] !== undefined);
    const r: any = await repo.createQueryBuilder().insert().into(Article, columns).values(payload).execute();
    // NEWS-Q2: 새 행 id(묶음 SQL 2 의 열을 뒤이어 채울 때 쓴다). 못 얻으면 null.
    const id = r?.identifiers?.[0]?.id ?? r?.raw?.[0]?.id;
    return id == null ? null : Number(id);
  };
  try {
    return await insert(!state.unavailable);
  } catch (error) {
    if (state.unavailable || !missingRawBody(error)) throw error;
    state.unavailable = true;
    warn('[raw_body] column unavailable; storing articles without raw_body until deploy/v5.5_raw_body.sql is applied.');
    return await insert(false);
  }
}

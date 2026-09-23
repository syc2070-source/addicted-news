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
): Promise<void> {
  const insert = async (includeRaw: boolean) => {
    const payload = { ...values };
    if (!includeRaw) delete payload.rawBody;
    const columns = Object.keys(payload).filter((key) => payload[key] !== undefined);
    await repo.createQueryBuilder().insert().into(Article, columns).values(payload).execute();
  };
  try {
    await insert(!state.unavailable);
  } catch (error) {
    if (state.unavailable || !missingRawBody(error)) throw error;
    state.unavailable = true;
    warn('[raw_body] column unavailable; storing articles without raw_body until deploy/v5.5_raw_body.sql is applied.');
    await insert(false);
  }
}

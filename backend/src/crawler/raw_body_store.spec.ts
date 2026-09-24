import 'reflect-metadata';
import { DataSource, Repository } from 'typeorm';
import { Article } from '../articles/article.entity';
import { crawlerConnectionOptions } from './crawler_db';
import { insertArticleWithRawBody } from './raw_body_store';

describe('raw_body migration compatibility (no database connection)', () => {
  function fixture(errors: unknown[] = []) {
    const execute = jest.fn(async () => { const error = errors.shift(); if (error) throw error; return {}; });
    const builder: any = { insert: jest.fn(() => builder), into: jest.fn(() => builder), values: jest.fn(() => builder), execute };
    const repo = { createQueryBuilder: () => builder } as unknown as Repository<Article>;
    return { repo, builder };
  }

  it('preserves raw text and all existing article fields when the column exists', async () => {
    const f = fixture();
    await insertArticleWithRawBody(f.repo, { title: '제목', rawBody: '原文\ntext', summary: '한국어' }, { unavailable: false });
    expect(f.builder.values).toHaveBeenCalledWith({ title: '제목', rawBody: '原文\ntext', summary: '한국어' });
    expect(f.builder.into).toHaveBeenCalledWith(Article, ['title', 'rawBody', 'summary']);
  });

  it('drops only raw_body on its undefined-column error and warns once per crawl save', async () => {
    const f = fixture([{ driverError: { code: '42703', message: 'column "raw_body" of relation "articles" does not exist' } }]);
    const state = { unavailable: false };
    const warn = jest.fn();
    const values = { title: 'title', rawBody: 'raw', summary: 'summary', keywords: ['a'] };
    await insertArticleWithRawBody(f.repo, values, state, warn);
    await insertArticleWithRawBody(f.repo, values, state, warn);
    expect(f.builder.values.mock.calls[1][0]).toEqual({ title: 'title', summary: 'summary', keywords: ['a'] });
    expect(f.builder.into.mock.calls[1][1]).toEqual(['title', 'summary', 'keywords']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(state.unavailable).toBe(true);
    expect(values.rawBody).toBe('raw');
  });

  it('does not hide another missing column or a connection failure', async () => {
    for (const error of [{ code: '42703', message: 'column "other" does not exist' }, { code: '08006', message: 'connection lost' }]) {
      const f = fixture([error]);
      await expect(insertArticleWithRawBody(f.repo, { rawBody: 'raw' }, { unavailable: false })).rejects.toEqual(error);
      expect(f.builder.execute).toHaveBeenCalledTimes(1);
    }
  });

  it('generates SQL excluding the unapplied column, including duplicate-check SELECTs', async () => {
    const ds = new DataSource(crawlerConnectionOptions({}));
    // Metadata construction is local: initialize()/connect() is deliberately never called.
    await (ds as any).buildMetadatas();
    const repo = ds.getRepository(Article);
    const query = repo.createQueryBuilder().insert().into(Article, ['title', 'summary']).values({ title: 'x', summary: 'y' }).getQuery();
    expect(query).not.toContain('raw_body');
    expect(repo.createQueryBuilder('a').getQuery()).not.toContain('raw_body');
    expect(repo.createQueryBuilder().insert().into(Article, ['title', 'rawBody']).values({ title: 'x', rawBody: 'raw' }).getQuery()).toContain('raw_body');
    expect(ds.isInitialized).toBe(false);
  });
});

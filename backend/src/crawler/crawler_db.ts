import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { Article } from '../articles/article.entity';
import { RejectedArticle } from '../articles/rejected_article.entity';

/** Shared unchanged crawler connection contract; importing this file never reads .env or connects. */
export function crawlerConnectionOptions(env: NodeJS.ProcessEnv): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres',
    password: String(env.DB_PASSWORD ?? ''),
    database: env.DB_NAME || 'addiction_news',
    entities: [Article, RejectedArticle],
    synchronize: false,
    logging: false,
  };
}

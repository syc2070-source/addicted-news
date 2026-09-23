import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DataSource } from 'typeorm';
import { crawlerConnectionOptions } from './crawler_db';
import { exportArticleLines, parseExportArgs } from './article_export';

/** CLI only: importing the pure export contract in unit tests never reads .env or connects. */
async function main(): Promise<void> {
  const args = parseExportArgs(process.argv.slice(2));
  require('dotenv').config({ quiet: true });
  const db = new DataSource(crawlerConnectionOptions(process.env));
  const folder = path.resolve(args.out);
  await fs.mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalPath = path.join(folder, `articles-${stamp}-${randomUUID()}.jsonl`);
  const partialPath = `${finalPath}.partial`;
  const file = await fs.open(partialPath, 'wx');
  let closed = false;
  let runner: ReturnType<DataSource['createQueryRunner']> | null = null;
  try {
    await db.initialize();
    runner = db.createQueryRunner();
    await runner.connect();
    const footer = await exportArticleLines(runner, async (line) => {
      await file.writeFile(`${line}\n`, 'utf8');
    }, { since: args.since });
    await file.sync();
    await file.close();
    closed = true;
    await fs.rename(partialPath, finalPath);
    // No article text or credentials in terminal output.
    console.log(JSON.stringify({ file: finalPath, ...footer }));
  } catch (error) {
    if (!closed) { await file.close().catch(() => undefined); closed = true; }
    await fs.unlink(partialPath).catch(() => undefined);
    throw error;
  } finally {
    if (runner) await runner.release();
    if (db.isInitialized) await db.destroy();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('[export:articles] Export failed; no completed JSONL or cursor was published.');
    process.exitCode = 1;
  });
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { SOURCES } from './sourceConfig';

// ✅ named import 금지: 경로/캐시 꼬이면 TS2305 반복됨
import * as crawler from './newsCrawler';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  // ✅ 실제 export를 런타임에 잡는다
  const fn =
    (crawler as any).runCrawler1 ||
    (crawler as any).runCrawler;

  if (!fn) {
    console.log('newsCrawler exports:', Object.keys(crawler));
    throw new Error('newsCrawler.ts에 runCrawler 또는 runCrawler1 export가 없습니다.');
  }

  await fn(dataSource, SOURCES);

  await app.close();
}

main().catch((e) => {
  console.error('크롤러 치명적 오류:', e);
  process.exit(1);
});

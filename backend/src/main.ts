import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function buildCorsOriginChecker() {
  const extraOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || origin === 'null') {
      callback(null, true);
      return;
    }
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    if (extraOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({
    origin: buildCorsOriginChecker(),
    credentials: true,
  });
  
  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`🚀 백엔드 API 서버: http://localhost:${port}`);
}
bootstrap();
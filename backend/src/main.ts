import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origin === 'null') {
        callback(null, true);
        return;
      }
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  
  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`🚀 백엔드 API 서버: http://localhost:${port}`);
}
bootstrap();
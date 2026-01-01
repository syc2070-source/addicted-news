import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ✅ CORS 설정 추가 (이것만!)
  app.enableCors({
    origin: 'http://localhost:8080',  // 프론트엔드 주소
    credentials: true,
  });
  
  await app.listen(process.env.PORT || 4000);
  console.log(`🚀 백엔드 API 서버: http://localhost:4000`);
}
bootstrap();
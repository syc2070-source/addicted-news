import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = 4000;  // 또는 원하는 포트 번호
  await app.listen(port);
}
bootstrap();

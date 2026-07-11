import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncyclopediaTerm } from './encyclopedia.entity';
import { EncyclopediaService } from './encyclopedia.service';
import { EncyclopediaController } from './encyclopedia.controller';

// app.module.ts 는 autoLoadEntities:true 이므로,
// 이 모듈을 AppModule imports 에 추가만 하면 엔티티가 자동 로드됨.
@Module({
  imports: [TypeOrmModule.forFeature([EncyclopediaTerm])],
  controllers: [EncyclopediaController],
  providers: [EncyclopediaService],
  exports: [EncyclopediaService],
})
export class EncyclopediaModule {}

// backend/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { Article } from '../articles/article.entity';
import { EncyclopediaModule } from '../encyclopedia/encyclopedia.module';

@Module({
  imports: [TypeOrmModule.forFeature([Article]), EncyclopediaModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
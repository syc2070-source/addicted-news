// backend/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { Article } from '../articles/article.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Article])],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
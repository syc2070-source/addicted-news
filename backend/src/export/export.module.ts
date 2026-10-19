import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

// NEWS-Q10 ■3: 읽기 전용 내보내기 문 v0(docs/EXPORT_V0.md)
@Module({
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}

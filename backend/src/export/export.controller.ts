import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  checkExportKey,
  ExportQuery,
  ExportService,
  keyFromHeaders,
  parseExportQuery,
} from './export.service';

// NEWS-Q10 ■3: 읽기 전용 내보내기 문 v0 — GET /api/export/articles?since=&kind=&tier=&cursor=
// 열쇠 env EXPORT_READ_KEY 없으면 404(기본 꺼짐) · 틀리면 401 · 맞으면 게재·보관 기사 목록 칸만(본문 0 · 한 쪽 200).
@Controller('api/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('articles')
  async articles(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query()
    q: { since?: string; kind?: string; tier?: string; cursor?: string },
  ) {
    const gate = checkExportKey(process.env, keyFromHeaders(headers));
    if (gate === 'off') throw new NotFoundException();
    if (gate === 'denied') throw new UnauthorizedException();
    let parsed: ExportQuery;
    try {
      parsed = parseExportQuery(q || {});
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return this.exportService.page(parsed);
  }
}

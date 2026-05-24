import { Controller, Get, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EMPTY_LIST = { count: 0, items: [] };
const NOT_FOUND = { found: false, item: null };

@Controller('reports')
export class ReportsController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  async listReports(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('scope') scope?: string,
    @Query('domain') domain?: string,
    @Query('region') region?: string,
  ) {
    const base = this.config.get<string>('STATORY_API_URL')?.trim();
    if (!base) return EMPTY_LIST;

    try {
      const params = new URLSearchParams();
      params.set('scenario_id', 'addiction');
      const parsedLimit = limit ? parseInt(limit, 10) : 50;
      params.set('limit', String(Number.isFinite(parsedLimit) ? parsedLimit : 50));
      const parsedOffset = offset ? parseInt(offset, 10) : 0;
      params.set(
        'offset',
        String(Number.isFinite(parsedOffset) ? parsedOffset : 0),
      );
      if (scope?.trim()) params.set('scope', scope.trim());
      if (domain?.trim()) params.set('domain', domain.trim());
      if (region?.trim()) params.set('region', region.trim());

      const url = `${base.replace(/\/+$/, '')}/api/reports?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return EMPTY_LIST;
      return await res.json();
    } catch {
      return EMPTY_LIST;
    }
  }

  @Get(':id')
  async getReport(
    @Param('id') id: string,
    @Query('include_sections') includeSections?: string,
  ) {
    const base = this.config.get<string>('STATORY_API_URL')?.trim();
    if (!base || !id?.trim()) return NOT_FOUND;

    try {
      const include =
        includeSections === 'true' || includeSections === '1';
      const params = new URLSearchParams();
      params.set('include_sections', String(include));
      const url = `${base.replace(/\/+$/, '')}/api/reports/${encodeURIComponent(id.trim())}?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return NOT_FOUND;
      return await res.json();
    } catch {
      return NOT_FOUND;
    }
  }
}

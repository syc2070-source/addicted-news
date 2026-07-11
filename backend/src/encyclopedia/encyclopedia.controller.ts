import { Controller, Get, Param, Query } from '@nestjs/common';
import { EncyclopediaService } from './encyclopedia.service';

// 전역 prefix 없음(레포 컨벤션) → 루트 경로 /encyclopedia
// 이 컨트롤러가 스테토리·중독사회가 그대로 호출할 공용 데이터 API.
@Controller('encyclopedia')
export class EncyclopediaController {
  constructor(private readonly service: EncyclopediaService) {}

  @Get()
  list(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('locale') locale?: string,
  ) {
    return this.service.findAll(category, q, locale);
  }

  // ':id' 보다 먼저 선언(라우팅 충돌 방지)
  @Get('link-map')
  linkMap() {
    return this.service.linkMap();
  }

  @Get(':id')
  detail(@Param('id') id: string, @Query('locale') locale?: string) {
    return this.service.findOne(id, locale);
  }
}

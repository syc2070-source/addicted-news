// backend/src/admin/admin.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, Headers, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { EncyclopediaService } from '../encyclopedia/encyclopedia.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly encyclopediaService: EncyclopediaService,
  ) {}

  // 간단한 비밀번호 인증
  private checkAuth(authHeader: string) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      throw new Error('ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.');
    }
    if (authHeader !== `Bearer ${adminPassword}`) {
      throw new UnauthorizedException('관리자 인증 실패');
    }
  }

  // 전체 기사 목록 (페이징)
  @Get('articles')
  async getArticles(
    @Headers('authorization') auth: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    this.checkAuth(auth);
    return this.adminService.getArticles(
      parseInt(page),
      parseInt(limit),
      category,
      search,
    );
  }

  // 기사 상세
  @Get('articles/:id')
  async getArticle(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    this.checkAuth(auth);
    return this.adminService.getArticle(parseInt(id));
  }

  // TOP 뉴스 설정
  @Put('articles/:id/top')
  async setTopNews(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body('isTop') isTop: boolean,
  ) {
    this.checkAuth(auth);
    return this.adminService.setTopNews(parseInt(id), isTop);
  }

  // 기획기사 설정
  @Put('articles/:id/feature')
  async setFeature(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body('isFeature') isFeature: boolean,
  ) {
    this.checkAuth(auth);
    return this.adminService.setFeature(parseInt(id), isFeature);
  }

  // 라파뉴스 설정
  @Put('articles/:id/rapha')
  async setRapha(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body('isRapha') isRapha: boolean,
    @Body('imageUrl') imageUrl?: string,
  ) {
    this.checkAuth(auth);
    return this.adminService.setRapha(parseInt(id), isRapha, imageUrl);
  }

  // 중독이슈 설정
  @Put('articles/:id/issue')
  async setIssue(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body('isIssue') isIssue: boolean,
  ) {
    this.checkAuth(auth);
    return this.adminService.setIssue(parseInt(id), isIssue);
  }

  // 기사 카테고리 변경
  @Put('articles/:id/category')
  async setCategory(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body('category') category: string,
  ) {
    this.checkAuth(auth);
    return this.adminService.setCategory(parseInt(id), category);
  }

  // 기사 삭제 (차단)
  @Put('articles/:id/block')
  async blockArticle(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body('blocked') blocked: boolean,
    @Body('reason') reason?: string,
  ) {
    this.checkAuth(auth);
    return this.adminService.blockArticle(parseInt(id), blocked, reason);
  }

  // 기사 완전 삭제
  @Delete('articles/:id')
  async deleteArticle(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    this.checkAuth(auth);
    return this.adminService.deleteArticle(parseInt(id));
  }

  // 새 기사 생성
  @Post('articles')
  async createArticle(
    @Headers('authorization') auth: string,
    @Body() data: any,
  ) {
    this.checkAuth(auth);
    return this.adminService.createArticle(data);
  }

  // 기사 수정
  @Put('articles/:id')
  async updateArticle(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    this.checkAuth(auth);
    return this.adminService.updateArticle(parseInt(id), data);
  }

  // 현재 TOP 뉴스 목록
  @Get('top-news')
  async getTopNews(@Headers('authorization') auth: string) {
    this.checkAuth(auth);
    return this.adminService.getTopNews();
  }

  // 현재 기획기사 목록
  @Get('features')
  async getFeatures(@Headers('authorization') auth: string) {
    this.checkAuth(auth);
    return this.adminService.getFeatures();
  }

  // 라파뉴스 목록
  @Get('rapha')
  async getRaphaNews(@Headers('authorization') auth: string) {
    this.checkAuth(auth);
    return this.adminService.getRaphaNews();
  }

  // 중독이슈 목록
  @Get('issue')
  async getIssueNews(@Headers('authorization') auth: string) {
    this.checkAuth(auth);
    return this.adminService.getIssueNews();
  }

  // 통계
  @Get('stats')
  async getStats(@Headers('authorization') auth: string) {
    this.checkAuth(auth);
    return this.adminService.getStats();
  }

  // 중독백과 항목 수정 (definition/example/body/advanced)
  @Put('encyclopedia/:id')
  async updateEncyclopedia(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    this.checkAuth(auth);
    return this.encyclopediaService.update(id, data);
  }
}
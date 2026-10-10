import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Article } from './articles/article.entity';
import { ArticlesModule } from './articles/articles.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';
import { EncyclopediaModule } from './encyclopedia/encyclopedia.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: Number(config.get<string>('DB_PORT') || 5432),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities: [Article],
        synchronize: false,
        autoLoadEntities: true,
        logging: true,
      }),
    }),

    ArticlesModule,
    AdminModule,
    ReportsModule,
    EncyclopediaModule,
  ],
  // NEWS-Q1 ■2: GET / · GET /api/health (전에는 등록되지 않아 / 가 404)
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
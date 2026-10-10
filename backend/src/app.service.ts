import { Injectable } from '@nestjs/common';

const STARTED_AT = new Date().toISOString();

export type Health = { ok: true; commit: string; startedAt: string };

@Injectable()
export class AppService {
  getHello(): string {
    return 'addicted-news api ok';
  }

  /** DB·인증·비밀 없이 프로세스 상태만(NEWS-Q1 ■2). Render 가 RENDER_GIT_COMMIT 을 넣는다. */
  getHealth(env: NodeJS.ProcessEnv = process.env): Health {
    return { ok: true, commit: env.RENDER_GIT_COMMIT || 'local', startedAt: STARTED_AT };
  }
}

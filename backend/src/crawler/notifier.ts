// ============================================================
// notifier.ts (v5.4) — Discord 웹훅 알림(선택). axios 사용(undici 금지).
// env DISCORD_WEBHOOK_URL 미설정 시 콘솔 로그로 no-op 처리(크롤 방해 없음).
// ============================================================
import axios from 'axios';

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';

/** Discord 로 알림 전송. 실패해도 throw 하지 않음(크롤 지속). */
export async function notifyDiscord(message: string): Promise<void> {
  if (!WEBHOOK) {
    console.log(`[notify:no-webhook] ${message}`);
    return;
  }
  try {
    await axios.post(
      WEBHOOK,
      { content: message.slice(0, 1900) },
      { timeout: 8000, headers: { 'Content-Type': 'application/json' }, validateStatus: () => true },
    );
  } catch (e) {
    console.warn('[notify] Discord 전송 실패:', (e as Error).message);
  }
}

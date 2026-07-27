// 백과 항목 유튜브 임베드(이관 필수). youtube-nocookie 도메인, 지연로드, 16:9 반응형.
// video_id 형식 검증 후에만 렌더(기존 프론트 규칙 계승).
import styles from './YouTubeEmbed.module.css';

const VALID = /^[A-Za-z0-9_-]{6,20}$/;

export default function YouTubeEmbed({ videoId, title }: { videoId: string; title: string }) {
  if (!VALID.test(videoId)) return null;
  return (
    <div className={styles.wrap}>
      <iframe
        className={styles.frame}
        loading="lazy"
        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}

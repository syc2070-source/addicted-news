import Link from 'next/link';

export default function NotFound() {
  return (
    <section style={{ textAlign: 'center', padding: '64px 0' }}>
      <h1 style={{ fontSize: 40 }}>404</h1>
      <p style={{ color: 'var(--color-neutral-700)' }}>요청하신 페이지를 찾을 수 없습니다.</p>
      <Link className="btn btn-primary" href="/" style={{ marginTop: 12 }}>홈으로</Link>
    </section>
  );
}

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATEGORIES } from '@/lib/categories';
import styles from './SiteNav.module.css';

interface NavItem { href: string; label: string; }

const ITEMS: NavItem[] = [
  { href: '/', label: '종합' },
  ...CATEGORIES.map((c) => ({ href: `/category/${c.slug}`, label: c.short })),
  { href: '/reports', label: '리포트' }, // F-1 작업3: 리포트 슬롯
];

export default function SiteNav() {
  const pathname = usePathname() || '/';
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className={styles.nav} aria-label="주요 카테고리">
      <div className={styles.items}>
        {ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={styles.item}
            aria-current={isActive(it.href) ? 'page' : undefined}
          >
            {it.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

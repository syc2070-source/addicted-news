'use client';
// 이미지 없는/로드 실패 기사: 자동생성 컬러 썸네일 금지 → 텍스트 카드로 폴백(디자인 원칙).
// imageUrl 있으면 duotone 처리된 <img>, 없거나 onError면 카테고리+제목 텍스트 카드.
import { useState } from 'react';
import styles from './Thumb.module.css';

interface Props {
  src?: string | null;
  alt: string;
  category?: string;
  ratio?: '16/9' | '4/3' | '1/1';
  className?: string;
}

export default function Thumb({ src, alt, category, ratio = '16/9', className }: Props) {
  const [failed, setFailed] = useState(false);
  const showImg = src && !failed;
  const box = [styles.box, className].filter(Boolean).join(' ');
  const style = { aspectRatio: ratio.replace('/', ' / ') } as React.CSSProperties;

  if (showImg) {
    return (
      <figure className={`duotone ${box}`} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src!} alt={alt} loading="lazy" className={styles.img} onError={() => setFailed(true)} />
      </figure>
    );
  }
  return (
    <figure className={`${box} ${styles.fallback}`} style={style} aria-label={alt}>
      {category ? <span className={styles.fbCat}>{category}</span> : null}
      <span className={styles.fbTitle}>{alt}</span>
    </figure>
  );
}

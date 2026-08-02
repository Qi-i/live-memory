import type { CSSProperties } from "react";

export interface BrandMarkProps {
  className?: string;
  title?: string;
  size?: number | string;
  monochrome?: boolean;
}

export function BrandMark({ className = "", title = "现场记", size = 44, monochrome = false }: BrandMarkProps) {
  const style = { "--brand-mark-size": typeof size === "number" ? `${size}px` : size } as CSSProperties;
  return (
    <svg
      className={`brand-mark${monochrome ? " is-monochrome" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="live-memory-brand-gradient" x1="6" y1="5" x2="42" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#65E2CE" />
          <stop offset="0.48" stopColor="#159B88" />
          <stop offset="1" stopColor="#315ED8" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="21" fill="url(#live-memory-brand-gradient)" />
      <path d="M7.8 22.3c5.1-7.5 11.3-10.7 18.5-9.7 5.2.7 9.7 3.1 13.9 7.2-4.8.3-8.8 2.2-12.1 5.8-4.5 4.9-10.2 7.1-17 6.5" fill="none" stroke="white" strokeWidth="4.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40.2 25.7c-5.1 7.5-11.3 10.7-18.5 9.7-5.2-.7-9.7-3.1-13.9-7.2 4.8-.3 8.8-2.2 12.1-5.8 4.5-4.9 10.2-7.1 17-6.5" fill="none" stroke="rgba(255,255,255,.68)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="3.2" fill="#DFFF4F" stroke="white" strokeWidth="1.4" />
    </svg>
  );
}

export interface BrandLockupProps {
  className?: string;
  compact?: boolean;
  inverse?: boolean;
  showTagline?: boolean;
  size?: number;
}

export function BrandLockup({ className = "", compact = false, inverse = false, showTagline = true, size = 42 }: BrandLockupProps) {
  return (
    <span className={`brand-lockup${compact ? " is-compact" : ""}${inverse ? " is-inverse" : ""}${className ? ` ${className}` : ""}`}>
      <BrandMark size={size} />
      <span className="brand-lockup-copy">
        <strong>现场记</strong>
        <small>Live Memory</small>
        {showTagline && !compact ? <em>把每一次现场，留成自己的档案</em> : null}
      </span>
    </span>
  );
}

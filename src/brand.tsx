import type { CSSProperties } from "react";

export interface BrandMarkProps {
  className?: string;
  title?: string;
  size?: number | string;
  monochrome?: boolean;
}

export function BrandMark({ className = "", title = "Live Memory", size = 44, monochrome = false }: BrandMarkProps) {
  const style = { "--brand-mark-size": typeof size === "number" ? `${size}px` : size } as CSSProperties;
  return (
    <svg
      className={`brand-mark${monochrome ? " is-monochrome" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="live-memory-spotlight-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7E8C8" />
          <stop offset="1" stopColor="#CCD5C7" />
        </linearGradient>
      </defs>
      <rect x="92" y="142" width="220" height="278" rx="34" fill="#0C4A40" transform="rotate(-13 202 281)" />
      <rect x="128" y="112" width="218" height="294" rx="34" fill="#88A296" transform="rotate(-5 237 259)" />
      <g transform="rotate(9 300 250)">
        <rect x="164" y="78" width="270" height="330" rx="36" fill="#0A4A40" />
        <circle cx="314" cy="118" r="19" fill="#F9EACB" />
        <path d="M314 136 190 357 392 357Z" fill="url(#live-memory-spotlight-gradient)" />
        <g fill="#0A4A40">
          <circle cx="239" cy="335" r="20" />
          <path d="M205 401c2-35 16-54 34-54s32 19 34 54Z" />
          <circle cx="307" cy="337" r="23" />
          <path d="M267 406c2-39 18-61 40-61s38 22 40 61Z" />
          <rect x="277" y="299" width="16" height="75" rx="8" transform="rotate(-13 285 336)" />
          <rect x="327" y="296" width="16" height="78" rx="8" transform="rotate(20 335 335)" />
          <circle cx="368" cy="346" r="18" />
          <path d="M340 405c2-31 13-47 28-47s26 16 28 47Z" />
        </g>
      </g>
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
        <strong>Live Memory</strong>
        <small>现场记 · CONCERT ARCHIVE</small>
        {showTagline && !compact ? <em>把每一次现场，留成自己的档案</em> : null}
      </span>
    </span>
  );
}

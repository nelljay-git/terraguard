import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown until the section nears the viewport (e.g. a shimmer block of similar height). */
  placeholder: ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  /** How far ahead of the viewport to start rendering (default ~400px). */
  rootMargin?: string;
}

/** Renders children only when the wrapper nears the viewport. Falls back to eager render when IO is unavailable. */
export function LazySection({ children, placeholder, className, style, ariaLabel, rootMargin = '400px 0px' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      { rootMargin, threshold: 0.01 }
    );
    io.observe(el);
    // Safety net: never leave users staring at a permanent placeholder
    // (tall monitors, print, weird observers) — force-render after 2s.
    const fallback = window.setTimeout(() => {
      setVisible(true);
      io.disconnect();
    }, 2000);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [visible, rootMargin]);

  return (
    <div ref={ref} className={className} style={style} aria-label={ariaLabel}>
      {visible ? children : placeholder}
    </div>
  );
}

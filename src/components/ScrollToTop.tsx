import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Resets the window scroll on forward navigation between routes.
 *
 * React Router keeps the document scroll position across client-side
 * navigations (nothing unmounts the scrolling element), so opening a new page
 * while scrolled down used to land mid-page. Two cases are deliberately left
 * alone:
 *
 *  - POP (browser back/forward): the browser restores the previous offset,
 *    which is what a user expects when returning to a long list.
 *  - Hash links (#comments, notifications): the target element is scrolled
 *    into view instead. If the anchor never appears (deleted comment), we
 *    fall back to the top of the new page.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      let frames = 0;
      let raf = 0;
      let cancelled = false;

      const seek = () => {
        if (cancelled) return;
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ block: 'start' });
          return;
        }
        if (frames++ < 20) {
          raf = requestAnimationFrame(seek);
          return;
        }
        window.scrollTo(0, 0);
      };

      raf = requestAnimationFrame(seek);
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }

    if (navigationType === 'POP') return;
    window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);

  return null;
}

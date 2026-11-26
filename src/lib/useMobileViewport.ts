import { useSyncExternalStore } from 'react';

// Phones and small tablets only — desktop/wide layouts are excluded.
const MOBILE_MAX_WIDTH = 768;
const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** True when the app is viewed at a mobile width; reacts to resizes/rotation. */
export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// Deep-link handling: push-notification taps open the app with the custom
// scheme terraguard://details/{eq_id} or terraguard://open/{app route}.
//
// Important: the launch URL must only be consumed ONCE per app process. If it
// is replayed (e.g. after a WebView reload or a repeated intent), every tap on
// a nav link gets bounced straight back to the notification's page.

import { App } from '@capacitor/app';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

let launchUrlConsumed = false;

function parseDetailsDeepLink(url: string): string | null {
  const m = /^terraguard:\/\/details\/([^/?#]+)/i.exec(url || '');
  return m ? m[1] : null;
}

/** In-app route sent by admin notifications: terraguard://open/<path>. */
function parseAppRoute(url: string): string | null {
  const m = /^terraguard:\/\/open\/([^?#]+)/i.exec(url || '');
  return m ? `/${m[1].replace(/^\/+/, '')}` : null;
}

export function useFcmDeepLinks() {
  const navigate = useNavigate();
  const lastHandled = useRef<{ target: string; at: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let listener: { remove: () => Promise<void> | void } | undefined;

    const go = (target: string, replace: boolean) => {
      if (cancelled) return;
      // Ignore duplicate deliveries of the same link within 10 seconds.
      const prev = lastHandled.current;
      if (prev && prev.target === target && Date.now() - prev.at < 10_000) return;
      lastHandled.current = { target, at: Date.now() };
      navigate(target, { replace });
    };

    const handle = (url: string, replace = false) => {
      const eqId = parseDetailsDeepLink(url);
      if (eqId) {
        go(`/details/${eqId}`, replace);
        return;
      }
      const route = parseAppRoute(url);
      if (route) go(route, replace);
    };

    // Cold start: consume the launch URL once, replacing the initial history
    // entry so normal navigation (and the back button) keeps working.
    if (!launchUrlConsumed) {
      launchUrlConsumed = true;
      void App.getLaunchUrl().then((res) => handle(res?.url ?? '', true));
    }

    // Warm tap while the app is already running.
    void App.addListener('appUrlOpen', ({ url }) => handle(url)).then((l) => {
      if (cancelled) void l.remove();
      else listener = l;
    });

    return () => {
      cancelled = true;
      if (listener) void listener.remove();
    };
  }, [navigate]);
}

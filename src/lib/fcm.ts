// FCM push — native (Capacitor) path only.
//
// Token registration: FCMPlugin.getToken() → PostgREST upsert into fcm_tokens.
// Prefs live on the token row (per device). Signed-in users get user_id set
// (the monitor keys off user_id; rows without user_id are anonymous devices).

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import { getPreferredApi, PREFERRED_API_CHANGE_EVENT } from './apiPreference';
import { MOTION_FEATURE_ENABLED } from './featureFlags';

export const IS_NATIVE = Capacitor.isNativePlatform();

// ---- plugin proxy (custom Capacitor plugin: FCMPlugin) ----
interface FCMPluginInterface {
  getToken(): Promise<{ token: string }>;
  requestNotificationPermission(): Promise<{ state: number }>;
  checkPermission(): Promise<{ state: number }>;
  openAppSettings(): Promise<void>;
  startShakeDetection(): Promise<void>;
  stopShakeDetection(): Promise<void>;
  setMotionTestMode(options: { enabled: boolean }): Promise<void>;
  setMotionSensitivity(options: { level: number }): Promise<void>;
  setMotionNotifications(options: { enabled: boolean }): Promise<void>;
  isShakeDetectionRunning(): Promise<{
    running: boolean;
    samples: number;
    lastMotion: number;
    lastWindowPeak: number;
    lastWindowRms: number;
    lastReversals: number;
    lastFrequencyHz: number;
    ax: number;
    ay: number;
    az: number;
    magnitude: number;
    measuredHz: number;
    state: string;
    classification: string;
    confidence: number;
    accepted: number;
    rejected: number;
    testMode: boolean;
    dropped: number;
  }>;
}
const FCMPlugin = Capacitor.registerPlugin<FCMPluginInterface>('FCMPlugin');
export { FCMPlugin };

/** Fail loudly instead of hanging when the native plugin isn't registered. */
export function withPluginTimeout<T>(promise: Promise<T>, ms = 10000, label = 'FCMPlugin'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out — native plugin unavailable`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---- prefs model ----
export interface FcmLocation {
  label: string;
  lat: number;
  lng: number;
}

export interface FcmPrefs {
  enabled: boolean;
  source: 'phivolcs' | 'usgs' | 'emsc';
  categories: { new: boolean; significant: boolean; nearby: boolean; updates: boolean };
  volcano_updates: boolean;
  tsunami_updates: boolean;
  min_magnitude: number;
  significant_threshold: number;
  nearby_radius_km: number;
  locations: FcmLocation[];
  quiet_hours: { start: number; end: number };
  sound: boolean;
  shake_detection: boolean;
  motion_sensitivity: 'low' | 'medium' | 'high';
  motion_notifications: boolean;
}

export const DEFAULT_FCM_PREFS: FcmPrefs = {
  enabled: false,
  source: 'phivolcs',
  categories: { new: true, significant: true, nearby: true, updates: true },
  volcano_updates: true,
  tsunami_updates: true,
  min_magnitude: 4.5,
  significant_threshold: 6.0,
  nearby_radius_km: 50,
  locations: [],
  quiet_hours: { start: 22, end: 7 },
  sound: true,
  shake_detection: false,
  motion_sensitivity: 'medium',
  motion_notifications: true,
};

const TOKEN_KEY = 'terraguard_fcm_token';

export function readFcmToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function readStoredPrefs(token: string): Promise<FcmPrefs> {
  try {
    const { data } = await supabase.from('fcm_tokens').select('prefs').eq('token', token).maybeSingle();
    return { ...DEFAULT_FCM_PREFS, ...((data?.prefs ?? {}) as Partial<FcmPrefs>) };
  } catch {
    return { ...DEFAULT_FCM_PREFS };
  }
}

export async function savePrefs(token: string, prefs: FcmPrefs): Promise<boolean> {
  // The feed selector lives in the app-wide Settings modal, so keep the stored
  // source in sync on every save instead of trusting a stale local copy.
  const { error } = await supabase.from('fcm_tokens').update({
    prefs: { ...prefs, source: getPreferredApi() },
  }).eq('token', token);
  if (error) {
    console.error('Failed to save push prefs', error);
    return false;
  }
  return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Push this device's selected feed into fcm_tokens.prefs.source without a full
 * re-registration. The Settings modal reloads right after an API switch, which
 * aborts in-flight requests — so it awaits this write first, otherwise the
 * worker keeps sending pushes from the previous feed.
 */
export async function syncFcmSource(api = getPreferredApi(), timeoutMs = 2500): Promise<boolean> {
  if (!IS_NATIVE) return false;
  const token = readFcmToken();
  if (!token) return false;
  try {
    const ok = await withTimeout((async () => {
      const { data } = await supabase
        .from('fcm_tokens')
        .select('prefs')
        .eq('token', token)
        .maybeSingle();
      const prefs: FcmPrefs = {
        ...DEFAULT_FCM_PREFS,
        ...((data?.prefs ?? {}) as Partial<FcmPrefs>),
        source: api,
      };
      const { error } = await supabase.from('fcm_tokens').update({ prefs }).eq('token', token);
      if (error) {
        console.error('Failed to sync FCM source', error);
        return false;
      }
      return true;
    })(), timeoutMs);
    console.log('[push] syncFcmSource:', api, ok ? 'ok' : 'failed');
    return ok;
  } catch (e) {
    console.warn('[push] syncFcmSource failed', e);
    return false;
  }
}

/** Register (or refresh) the device token; returns the live token + prefs. */
export async function registerFcmToken(sessionUserId?: string | null): Promise<{
  token: string | null;
  prefs: FcmPrefs;
}> {
  try {
    const { token } = await withPluginTimeout(FCMPlugin.getToken(), 15000, 'getToken');
    console.log('[push] registerFcmToken: got token, length', token?.length ?? 0);
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch { /* ignore */ }
    const { data: existing } = await supabase
      .from('fcm_tokens')
      .select('prefs, user_id')
      .eq('token', token)
      .maybeSingle();
    const userId = sessionUserId !== undefined ? sessionUserId : (existing?.user_id ?? null);
    const prefs: FcmPrefs = {
      ...DEFAULT_FCM_PREFS,
      ...((existing?.prefs ?? {}) as Partial<FcmPrefs>),
      source: getPreferredApi(),
    };
    const { error } = await supabase.from('fcm_tokens').upsert(
      { token, user_id: userId, prefs, platform: 'android' },
      { onConflict: 'token' },
    );
    console.log('[push] registerFcmToken: upsert error =', error ? String(error) : 'none', '| source =', prefs.source);
    return { token, prefs };
  } catch (e) {
    console.error('FCM registration failed', e);
    return { token: null, prefs: { ...DEFAULT_FCM_PREFS } };
  }
}

/** Re-register on sign-in (sets user_id) and poll for token changes (~15 min). */
let permissionRequestedThisSession = false;

export function useFcmRegistration() {
  useEffect(() => {
    if (!IS_NATIVE) return;
    let cancelled = false;
    const register = async (sessionUserId?: string | null) => {
      if (cancelled) return;
      const reg = await registerFcmToken(sessionUserId);
      if (cancelled) return;

      // A reinstall resets Android's notification permission while the saved
      // prefs still say "enabled". Re-prompt once per app session so alerts
      // don't silently disappear after updating the APK.
      if (reg.prefs.enabled && !permissionRequestedThisSession) {
        permissionRequestedThisSession = true;
        void withPluginTimeout(FCMPlugin.checkPermission(), 8000, 'checkPermission')
          .then(({ state }) => {
            if (state === 0) return;
            return withPluginTimeout(
              FCMPlugin.requestNotificationPermission(), 10000, 'requestNotificationPermission',
            );
          })
          .catch(() => { /* user can still use the Settings screen */ });
      }

      // The experimental motion engine is parked — never start it while the
      // feature flag is off, even if an older pref says it was enabled.
      if (!MOTION_FEATURE_ENABLED) {
        void withPluginTimeout(FCMPlugin.setMotionTestMode({ enabled: true }), 8000, 'setMotionTestMode')
          .catch(() => {});
        void withPluginTimeout(FCMPlugin.stopShakeDetection(), 8000, 'stopShakeDetection')
          .catch(() => {});
      } else if (reg.prefs.shake_detection) {
        void withPluginTimeout(FCMPlugin.setMotionTestMode({ enabled: false }), 8000, 'setMotionTestMode')
          .catch(() => {});
        void withPluginTimeout(
          FCMPlugin.setMotionSensitivity({
            level: reg.prefs.motion_sensitivity === 'low' ? 0 : reg.prefs.motion_sensitivity === 'high' ? 2 : 1,
          }), 8000, 'setMotionSensitivity',
        ).catch(() => {});
        void withPluginTimeout(
          FCMPlugin.setMotionNotifications({ enabled: reg.prefs.motion_notifications !== false }),
          8000, 'setMotionNotifications',
        ).catch(() => {});
        void withPluginTimeout(FCMPlugin.startShakeDetection(), 8000, 'startShakeDetection')
          .catch((e) => console.warn('[push] shake detector start failed', e));
      } else {
        void withPluginTimeout(FCMPlugin.stopShakeDetection(), 8000, 'stopShakeDetection')
          .catch(() => { /* service may not be running */ });
      }
    };
    void register();
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      register(session?.user?.id ?? null);
    });
    // Switching PHIVOLCS/USGS/EMSC in the Settings modal updates this device's
    // stored source so the worker sends pushes from the same feed.
    const onSourceChange = () => register();
    window.addEventListener(PREFERRED_API_CHANGE_EVENT, onSourceChange);
    window.addEventListener('storage', onSourceChange);
    const t = setInterval(() => register(), 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener(PREFERRED_API_CHANGE_EVENT, onSourceChange);
      window.removeEventListener('storage', onSourceChange);
      sub.data.subscription.unsubscribe();
    };
  }, []);
}

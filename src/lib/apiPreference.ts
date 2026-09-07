const KEY = 'terraguard_preferred_api';
const CHANGE_EVENT = 'terraguard:preferred-api-changed';

export function getPreferredApi(): 'phivolcs' | 'usgs' | 'emsc' {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'usgs') return 'usgs';
    if (v === 'emsc') return 'emsc';
  } catch { /* ignore storage errors */ }
  return 'phivolcs';
}

export function setPreferredApi(api: 'phivolcs' | 'usgs' | 'emsc'): void {
  try {
    localStorage.setItem(KEY, api);
  } catch { /* ignore storage errors */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export const PREFERRED_API_CHANGE_EVENT = CHANGE_EVENT;

// Push settings — FCM-based push notifications (native/APK builds only).
//
// Distinguishes three control surfaces, as asked:
//   1. Android notification permission (system) — shown below when not granted
//   2. TerraGuard prefs (this component, per device) — master toggle + categories
//      + thresholds + locations + quiet hours
//   3. Android notification channels (MainActivity creates them; importances per
//      category — adjustable in Android settings)
//
// Reuses NotificationSettings.css (ns-*) and AlertZoneManager.css (azf-*).

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Clock,
  Copy,
  MapPin,
  PowerOff,
  Shield,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import type { FcmLocation, FcmPrefs } from '../lib/fcm';
import {
  DEFAULT_FCM_PREFS,
  FCMPlugin,
  IS_NATIVE,
  readFcmToken,
  readStoredPrefs,
  registerFcmToken,
  savePrefs,
  withPluginTimeout,
} from '../lib/fcm';
import { requestUserCoords } from '../lib/userLocation';
import { getPreferredApi, PREFERRED_API_CHANGE_EVENT } from '../lib/apiPreference';
import { MOTION_FEATURE_ENABLED } from '../lib/featureFlags';
import './NotificationSettings.css';
import './AlertZoneManager.css';

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function LocationPicker({
  initial,
  onPick,
  onCancel,
}: {
  initial: FcmLocation | undefined;
  onPick: (loc: FcmLocation) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [point, setPoint] = useState<[number, number] | null>(
    initial ? [initial.lat, initial.lng] : null,
  );

  const onMapClick = useCallback((lat: number, lng: number) => setPoint([lat, lng]), []);
  const onSave = () => {
    if (!point) return;
    onPick({ label: label.trim() || 'My location', lat: point[0], lng: point[1] });
  };

  return (
    <div className="azf">
      <div className="azf-header">
        <h4>Add Notification Location</h4>
        <button className="azf-close" onClick={onCancel} title="Cancel">
          <X size={16} />
        </button>
      </div>
      <div className="azf-map-wrap" style={{ height: '200px' }}>
        <MapContainer
          center={point ?? [12.8797, 121.774]}
          zoom={5}
          style={{ height: '100%', width: '100%', borderRadius: '12px' }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
          <MapClickHandler onMapClick={onMapClick} />
          {point && <Marker position={point} />}
        </MapContainer>
        {!point && (
          <div className="azf-map-hint">
            <MapPin size={14} /> Click on the map to set the location
          </div>
        )}
      </div>
      <div className="azf-fields">
        <label className="azf-label">
          Location name
          <input
            className="azf-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. General Santos"
            maxLength={40}
          />
        </label>
      </div>
      <div className="azf-actions">
        <button className="azf-btn azf-btn-save" onClick={onSave} disabled={!point}>
          <Check size={14} />
          Add location
        </button>
        <button className="azf-btn azf-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CategoryToggle({
  label,
  desc,
  checked,
  onToggle,
  disabled = false,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="ns-toggle-row">
      <div className="ns-toggle-info">
        <div>
          <span className="ns-toggle-label">{label}</span>
          <span className="ns-toggle-desc">{desc}</span>
        </div>
      </div>
      <button
        className={`ns-switch ${checked ? 'ns-switch--on' : ''}`}
        onClick={onToggle}
        disabled={disabled}
      >
        <span className="ns-switch-thumb" />
      </button>
    </div>
  );
}

type Perm = 'pending' | 'granted' | 'denied';

export function PushSettings() {
  const [prefs, setPrefs] = useState<FcmPrefs>(DEFAULT_FCM_PREFS);
  const [token, setToken] = useState<string | null>(readFcmToken());
  const [loading, setLoading] = useState(true);
  // Start 'pending' — never assume granted — so that the first tap on the
  // master switch always runs the permission check and can show the prompt.
  const [perm, setPerm] = useState<Perm>(() =>
    typeof navigator === 'undefined' || !IS_NATIVE ? 'granted' : 'pending',
  );
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [pushSource, setPushSource] = useState(() => getPreferredApi());
  const [pickOpen, setPickOpen] = useState(false);
  const [pickLoc, setPickLoc] = useState<FcmLocation | undefined>(undefined);

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString([], { hour12: false });
    setDebugLog((d) => [...d.slice(-40), `${ts} — ${msg}`]);
    console.log(`[push] ${msg}`);
  }, []);

  const checkPerm = useCallback(async (): Promise<Perm> => {
    if (!IS_NATIVE) return 'granted';
    try {
      const { state } = await withPluginTimeout(
        FCMPlugin.checkPermission(), 8000, 'checkPermission',
      );
      const p: Perm = state === 0 ? 'granted' : 'denied';
      setPerm(p);
      log(`permission check → ${p}`);
      return p;
    } catch (e) {
      log(`permission check failed: ${e instanceof Error ? e.message : String(e)}`);
      return 'denied';
    }
  }, [log]);

  useEffect(() => {
    log('PushSettings opened');
    void checkPerm();
  }, [checkPerm, log]);

  useEffect(() => {
    if (token) log(`stored FCM token present (len ${token.length})`);
  }, [token, log]);

  const refresh = useCallback(async () => {
    const t = readFcmToken();
    setToken(t);
    if (!t) {
      setLoading(false);
      return;
    }
    setPrefs(await readStoredPrefs(t));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sync = () => {
      setPushSource(getPreferredApi());
      log(`push source → ${getPreferredApi()}`);
    };
    window.addEventListener(PREFERRED_API_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREFERRED_API_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [log]);

  useEffect(() => {
    const t = setInterval(() => {
      void checkPerm();
    }, 10_000);
    return () => clearInterval(t);
  }, [checkPerm]);

  const save = useCallback(
    async (patch: Partial<FcmPrefs>) => {
      const next = { ...prefs, ...patch };
      setPrefs(next);
      // The token may not be registered yet (Firebase fetch is async), so a
      // save made from a cold Alerts screen would otherwise be dropped.
      let t = token;
      if (!t) {
        log('no stored token — registering with Firebase…');
        const reg = await registerFcmToken();
        t = reg.token;
        if (t) {
          setToken(t);
          log(`registration returned a token (len ${t.length})`);
        } else {
          log('registration returned no token');
        }
      }
      const ok = t ? await savePrefs(t, next) : false;
      log(ok ? `prefs saved: ${JSON.stringify(patch)}` : 'save FAILED (no token or error — see console)');
    },
    [prefs, token, log],
  );

  const handleMaster = async () => {
    if (!prefs.enabled) {
      // Guarantee the prompt: if we don't hold a real grant yet, request now
      // and wait for the user to answer the system dialog.
      let state = await checkPerm();
      if (state !== 'granted') {
        log(`master → requesting Android POST_NOTIFICATIONS (state=${state})…`);
        try {
          await withPluginTimeout(
            FCMPlugin.requestNotificationPermission(), 10000, 'requestNotificationPermission',
          );
        } catch (e) {
          log(`permission request failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        state = await checkPerm();
        log(`permission request answered → ${state}`);
      }
      if (state !== 'granted') {
        log('notification permission not granted — saving enabled anyway; enable via Android settings');
      }
      await save({ enabled: true });
    } else {
      log('master → disabling pushes');
      await save({ enabled: false });
    }
  };

  const handleAddLocation = useCallback(
    async (loc: FcmLocation) => {
      if (loc.lat === undefined || loc.lat === null) return;
      const locations = [...(prefs.locations ?? []), loc];
      await save({ locations: locations.slice(-5) });
      setPickOpen(false);
    },
    [prefs.locations, save],
  );

  const handleUseGps = async () => {
    try {
      const pos = await requestUserCoords();
      await handleAddLocation({ label: 'My current location', lat: pos.lat, lng: pos.lng });
    } catch {
      /* location denied or unavailable — nothing happens */
    }
  };

  const handleShakeToggle = async () => {
    const next = !prefs.shake_detection;
    if (IS_NATIVE) {
      try {
        if (next) {
          await withPluginTimeout(FCMPlugin.setMotionTestMode({ enabled: false }), 8000, 'setMotionTestMode');
          await withPluginTimeout(FCMPlugin.startShakeDetection(), 8000, 'startShakeDetection');
        } else {
          await withPluginTimeout(FCMPlugin.stopShakeDetection(), 8000, 'stopShakeDetection');
        }
        log(`shake detection → ${next ? 'on' : 'off'}`);
      } catch (e) {
        log(`shake detection failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await save({ shake_detection: next });
  };

  const checkShakeSensor = async () => {
    try {
      const r = await withPluginTimeout(
        FCMPlugin.isShakeDetectionRunning(), 8000, 'isShakeDetectionRunning',
      );
      log(
        `shake sensor: running=${r.running}, samples=${r.samples}, ` +
        `peak=${Number(r.lastWindowPeak ?? 0).toFixed(1)}, rms=${Number(r.lastWindowRms ?? 0).toFixed(1)}, ` +
        `reversals=${r.lastReversals ?? 0}`,
      );
    } catch (e) {
      log(`shake sensor check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleMotionSensitivity = async (value: 'low' | 'medium' | 'high') => {
    const level = value === 'low' ? 0 : value === 'high' ? 2 : 1;
    if (IS_NATIVE) {
      void withPluginTimeout(FCMPlugin.setMotionSensitivity({ level }), 8000, 'setMotionSensitivity')
        .catch((e) => log(`sensitivity sync failed: ${String(e)}`));
    }
    await save({ motion_sensitivity: value });
  };

  const handleMotionNotifications = async () => {
    const next = !prefs.motion_notifications;
    if (IS_NATIVE) {
      void withPluginTimeout(FCMPlugin.setMotionNotifications({ enabled: next }), 8000, 'setMotionNotifications')
        .catch(() => {});
    }
    await save({ motion_notifications: next });
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const quietNever =
    prefs.quiet_hours.start === -1 ||
    prefs.quiet_hours.end === -1 ||
    prefs.quiet_hours.start === prefs.quiet_hours.end;

  return (
    <div className="ns">
      <h3 className="ns-title">
        <Bell size={18} />
        Earthquake alerts
      </h3>
      <p className="ns-perm-help" style={{ margin: '-4px 16px 12px' }}>
        We'll notify you shortly after a quake is recorded — never before it happens.
      </p>

      {/* ---- Phone permission ---- */}
      <div className="ns-perm">
        <div className="ns-perm-info">
          <Shield
            size={16}
            className={perm === 'granted' ? 'ns-perm-icon--granted' : ''}
          />
          <div>
            <span className="ns-perm-label">Phone permission</span>
            <span className={`ns-perm-status ns-perm-status--${perm}`}>
              {perm === 'granted' ? 'Allowed' : perm === 'pending' ? 'Checking…' : 'Not allowed'}
            </span>
          </div>
        </div>
        {perm === 'denied' && (
          <p className="ns-perm-help">
            Alerts are switched off for this app on your phone. Open Phone settings to allow them.
          </p>
        )}
        {perm === 'denied' && (
          <button className="azf-btn" onClick={() => FCMPlugin.openAppSettings()}>
            Open phone settings
          </button>
        )}
        <p className="ns-perm-help" style={{ marginTop: 6 }}>
          Your choices here stay on this device — no account needed.
        </p>
        <p className="ns-perm-help" style={{ marginTop: 6 }}>
          Alerts come from <strong>{pushSource.toUpperCase()}</strong> (change the data source in Settings).
        </p>
      </div>

      {/* ---- Master toggle ---- */}
      <div className="ns-toggle-row">
        <div className="ns-toggle-info">
          {prefs.enabled ? (
            <Bell size={18} style={{ color: '#10b981' }} />
          ) : (
            <BellOff size={18} style={{ color: 'var(--tg-text-3)' }} />
          )}
          <div>
            <span className="ns-toggle-label">Earthquake alerts</span>
            <span className="ns-toggle-desc">
              {prefs.enabled
                ? "On — we'll let you know when a quake is recorded"
                : 'Off — you won’t get quake alerts'}
            </span>
          </div>
        </div>
        <button
          className={`ns-switch ${prefs.enabled ? 'ns-switch--on' : ''}`}
          onClick={handleMaster}
        >
          <span className="ns-switch-thumb" />
        </button>
      </div>

      {!loading && !token && (
        <p className="ns-perm-help">Getting your device ready…</p>
      )}

      <div className="ns-group-title">WHICH ALERTS DO YOU WANT?</div>
      <CategoryToggle
        label="Any new quake"
        desc="Every new quake above your minimum size"
        checked={prefs.categories.new}
        onToggle={() => save({ categories: { ...prefs.categories, new: !prefs.categories.new } })}
        disabled={!prefs.enabled}
      />
      <CategoryToggle
        label="Strong quakes"
        desc="Anytime a quake reaches your strength threshold"
        checked={prefs.categories.significant}
        onToggle={() =>
          save({ categories: { ...prefs.categories, significant: !prefs.categories.significant } })
        }
        disabled={!prefs.enabled}
      />
      <CategoryToggle
        label="Near my places"
        desc="Quakes close to a place you've saved"
        checked={prefs.categories.nearby}
        onToggle={() =>
          save({ categories: { ...prefs.categories, nearby: !prefs.categories.nearby } })
        }
        disabled={!prefs.enabled}
      />
      <CategoryToggle
        label="Updates to a quake"
        desc="If a quake's size or location is revised"
        checked={prefs.categories.updates}
        onToggle={() =>
          save({ categories: { ...prefs.categories, updates: !prefs.categories.updates } })
        }
        disabled={!prefs.enabled}
      />
      <CategoryToggle
        label="Volcano bulletins"
        desc="New PHIVOLCS volcano bulletin or alert-level change"
        checked={prefs.volcano_updates !== false}
        onToggle={() => save({ volcano_updates: prefs.volcano_updates === false })}
        disabled={!prefs.enabled}
      />
      <CategoryToggle
        label="Tsunami advisories"
        desc="New PHIVOLCS tsunami bulletin, including information bulletins"
        checked={prefs.tsunami_updates !== false}
        onToggle={() => save({ tsunami_updates: prefs.tsunami_updates === false })}
        disabled={!prefs.enabled}
      />

      <div className="ns-group-title">HOW BIG SHOULD IT BE?</div>
      {/* ---- Min magnitude ---- */}
      <div className="ns-setting">
        <label className="ns-label">
          Smallest quake to tell me about: M{prefs.min_magnitude.toFixed(1)}
        </label>
        <input
          type="range"
          className="ns-slider"
          min={1}
          max={9}
          step={0.5}
          value={prefs.min_magnitude}
          onChange={(e) => save({ min_magnitude: Number(e.target.value) })}
          disabled={!prefs.enabled}
        />
        <div className="ns-slider-labels"><span>M1.0</span><span>M9.0</span></div>
      </div>

      {/* ---- Significant threshold ---- */}
      <div className="ns-setting">
        <label className="ns-label">
          Tell me right away at: M{prefs.significant_threshold.toFixed(1)} or stronger
        </label>
        <input
          type="range"
          className="ns-slider"
          min={1}
          max={9}
          step={0.5}
          value={prefs.significant_threshold}
          onChange={(e) => save({ significant_threshold: Number(e.target.value) })}
          disabled={!prefs.enabled}
        />
        <div className="ns-slider-labels"><span>M1.0</span><span>M9.0</span></div>
      </div>

      <div className="ns-group-title">PLACES YOU CARE ABOUT</div>
      {/* ---- Notification locations ---- */}
      <div className="ns-setting">
        <div className="ns-label-row">
          <MapPin size={14} />
          <label className="ns-label">My places</label>
        </div>
        {prefs.locations.length > 0 && (
          <div className="azm-list" style={{ marginBottom: 8 }}>
            {prefs.locations.map((loc, i) => (
              <div key={i} className="azm-zone azm-zone--disabled" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="azm-zone-name">{loc.label}</span>
                <span className="azm-zone-coords">
                  {loc.lat.toFixed(3)}°N, {loc.lng.toFixed(3)}°E
                </span>
                <button
                  className="azm-icon-btn azm-icon-btn--danger"
                  onClick={() => save({ locations: prefs.locations.filter((_, j) => j !== i) })}
                  title="Remove location"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="azm-add-btn" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="azf-btn azf-btn-save" onClick={() => setPickOpen(true)}>
            <MapPin size={14} />
            Pick on map
          </button>
          <button className="azf-btn" onClick={handleUseGps}>
            <PowerOff size={14} />
            Use my location
          </button>
        </div>
        <p className="ns-perm-help" style={{ marginTop: 6 }}>
          We'll tell you how far the quake was from your closest place. Up to 5 places.
        </p>
      </div>

      {/* ---- Nearby radius ---- */}
      <div className="ns-setting">
        <label className="ns-label">
          How close counts as nearby? {prefs.nearby_radius_km} km
        </label>
        <input
          type="range"
          className="ns-slider"
          min={10}
          max={500}
          step={10}
          value={prefs.nearby_radius_km}
          onChange={(e) => save({ nearby_radius_km: Number(e.target.value) })}
          disabled={!prefs.enabled}
        />
        <div className="ns-slider-labels"><span>10 km</span><span>500 km</span></div>
      </div>

      <div className="ns-group-title">WHEN SHOULD WE STAY QUIET?</div>
      {/* ---- Quiet hours ---- */}
      <div className="ns-setting">
        <div className="ns-label-row">
          <Clock size={14} />
          <label className="ns-label">Quiet time</label>
        </div>
        <select
          className="ns-select"
          value={quietNever ? 'never' : 'custom'}
          onChange={(e) => {
            if (e.target.value === 'never') {
              void save({ quiet_hours: { start: -1, end: -1 } });
            } else if (quietNever) {
              void save({ quiet_hours: { start: 22, end: 7 } });
            }
          }}
        >
          <option value="never">Never — alert me anytime</option>
          <option value="custom">Only during these hours</option>
        </select>
        {!quietNever && (
          <div className="ns-quiet-row">
            <select
              className="ns-select"
              value={prefs.quiet_hours.start}
              onChange={(e) => save({ quiet_hours: { ...prefs.quiet_hours, start: Number(e.target.value) } })}
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
            <span className="ns-quiet-dash">to</span>
            <select
              className="ns-select"
              value={prefs.quiet_hours.end}
              onChange={(e) => save({ quiet_hours: { ...prefs.quiet_hours, end: Number(e.target.value) } })}
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="ns-quiet-desc">
          {quietNever
            ? 'You’ll get alerts at any hour.'
            : 'No alerts during this time. It can cross midnight (e.g. 22:00 to 07:00).'}
        </p>
      </div>

      {/* ---- Sound toggle ---- */}
      <div className="ns-toggle-row">
        <div className="ns-toggle-info">
          {prefs.sound ? (
            <Volume2 size={18} style={{ color: '#3b82f6' }} />
          ) : (
            <VolumeX size={18} style={{ color: 'var(--tg-text-3)' }} />
          )}
          <div>
            <span className="ns-toggle-label">Play a sound</span>
            <span className="ns-toggle-desc">Uses the TerraGuard alert sound. You can fine-tune each alert type in your phone's notification settings.</span>
          </div>
        </div>
        <button
          className={`ns-switch ${prefs.sound ? 'ns-switch--on' : ''}`}
          onClick={() => save({ sound: !prefs.sound })}
        >
          <span className="ns-switch-thumb" />
        </button>
      </div>

      {/* ---- Shake detection (hidden until the feature flag is enabled) ---- */}
      {MOTION_FEATURE_ENABLED && (
        <>
          <div className="ns-group-title">EXTRA SAFETY</div>
          <div className="ns-toggle-row">
            <div className="ns-toggle-info">
              <Activity size={18} style={{ color: prefs.shake_detection ? '#f59e0b' : 'var(--tg-text-3)' }} />
              <div>
                <span className="ns-toggle-label">Notice strong shaking</span>
                <span className="ns-toggle-desc">
                  Alerts you if this phone feels strong, back-and-forth shaking — normal movement like walking or lifting it is ignored. It only notices shaking after it starts, is not an early warning, and uses extra battery.
                </span>
              </div>
            </div>
            <button
              className={`ns-switch ${prefs.shake_detection ? 'ns-switch--on' : ''}`}
              onClick={handleShakeToggle}
            >
              <span className="ns-switch-thumb" />
            </button>
          </div>
          {prefs.shake_detection && (
            <>
              <button className="azf-btn" style={{ alignSelf: 'flex-start' }} onClick={checkShakeSensor}>
                Check sensor
              </button>
              <div className="ns-setting">
                <label className="ns-label">Sensitivity</label>
                <select
                  className="ns-select"
                  value={prefs.motion_sensitivity}
                  onChange={(e) => void handleMotionSensitivity(e.target.value as 'low' | 'medium' | 'high')}
                >
                  <option value="low">Low — fewer alerts</option>
                  <option value="medium">Medium — balanced</option>
                  <option value="high">High — more alerts</option>
                </select>
                <p className="ns-quiet-desc">
                  Sensitivity changes how much evidence is required. It does not make the phone better at detecting earthquakes.
                </p>
              </div>
              <div className="ns-toggle-row">
                <div className="ns-toggle-info">
                  <Activity size={18} style={{ color: '#f59e0b' }} />
                  <div>
                    <span className="ns-toggle-label">Experimental notifications</span>
                    <span className="ns-toggle-desc">
                      Local alerts for detected motion only. These never use Firebase and never claim an earthquake happened.
                    </span>
                  </div>
                </div>
                <button
                  className={`ns-switch ${prefs.motion_notifications ? 'ns-switch--on' : ''}`}
                  onClick={() => void handleMotionNotifications()}
                >
                  <span className="ns-switch-thumb" />
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ---- Picker ---- */}
      {pickOpen && (
        <LocationPicker
          initial={pickLoc}
          onPick={handleAddLocation}
          onCancel={() => {
            setPickOpen(false);
            setPickLoc(undefined);
          }}
        />
      )}

      {/* ---- Debug log ---- */}
      <div className="ns-debug">
        <button
          type="button"
          className="ns-debug-head"
          onClick={() => setShowDebug((s) => !s)}
          aria-expanded={showDebug}
        >
          <span>Troubleshooting log{debugLog.length ? ` (${debugLog.length})` : ''}</span>
          <ChevronDown size={14} />
        </button>
        {showDebug && (
          <div className="ns-debug-list">
            <button
              type="button"
              className="ns-debug-copy"
              onClick={() => {
                try {
                  void navigator.clipboard.writeText(debugLog.join('\n') || '(empty)');
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              <Copy size={12} />
              Copy log
            </button>
            {debugLog.length === 0 && (
              <span className="ns-perm-help">— nothing logged yet —</span>
            )}
            {debugLog.map((line, i) => (
              <div key={i} className="ns-debug-line">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Footer ---- */}
      <div className="ns-info">
        <PowerOff size={14} />
        <p>
          Tap a notification to see that quake's details. Turn the switch off anytime to stop alerts.
        </p>
      </div>
    </div>
  );
}

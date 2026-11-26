import { useState } from 'react';
import {
  Activity, AlertTriangle, Download, Play, RotateCcw, Square, Trash2, Waves,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { FORUM_ADMIN_EMAIL } from '../lib/forum';
import { MOTION_FEATURE_ENABLED } from '../lib/featureFlags';
import { DATASET_NAMES, type DatasetName } from '../lib/motion/datasets.ts';
import type { Sensitivity } from '../lib/motion/config.ts';
import { useMotionLab } from '../lib/motion/useMotionLab.ts';
import './MotionLab.css';

function Stat({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="ml-stat">
      <span className="ml-stat-label">{label}</span>
      <span className="ml-stat-value">{value}{suffix && <small>{suffix}</small>}</span>
    </div>
  );
}

export function MotionLab() {
  const { user } = useAuth();
  const isAdmin = user?.email?.toLowerCase() === FORUM_ADMIN_EMAIL.toLowerCase();
  const lab = useMotionLab();
  const [dataset, setDataset] = useState<DatasetName>('SUSTAINED_OSCILLATION');

  if (!MOTION_FEATURE_ENABLED) {
    return (
      <div className="ml-container container">
        <div className="ml-gate">
          <AlertTriangle size={22} />
          <h2>Not available</h2>
          <p>This experimental feature is currently disabled.</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="ml-container container">
        <div className="ml-gate">
          <AlertTriangle size={22} />
          <h2>Developer access only</h2>
          <p>This screen is restricted to authorized developers.</p>
        </div>
      </div>
    );
  }

  const { snapshot: s } = lab;

  const download = () => {
    const blob = new Blob([lab.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `motion-lab-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ml-container container">
      <header className="ml-header">
        <span className="ml-kicker">Experimental · Diagnostics</span>
        <h1><Waves size={24} /> Motion Diagnostics Lab</h1>
        <p>
          Smartphone motion classification research. This is <strong>not</strong> an earthquake
          detector, predictor, or early-warning system. Confidence is classification confidence,
          never the probability of an earthquake.
        </p>
      </header>

      {lab.testMode && (
        <div className="ml-test-banner" role="status">
          <AlertTriangle size={17} />
          <span><strong>TEST MODE IS ON.</strong> No real or Firebase notifications are sent.</span>
        </div>
      )}

      <div className="ml-grid">
        <section className="ml-card">
          <h2><Activity size={16} /> Live sensor dashboard</h2>
          <div className="ml-stat-grid">
            <Stat label="Accel X" value={s.ax.toFixed(2)} suffix="m/s²" />
            <Stat label="Accel Y" value={s.ay.toFixed(2)} suffix="m/s²" />
            <Stat label="Accel Z" value={s.az.toFixed(2)} suffix="m/s²" />
            <Stat label="Magnitude" value={s.magnitude.toFixed(2)} suffix="m/s²" />
            <Stat label="Peak (window)" value={s.peak.toFixed(2)} suffix="m/s²" />
            <Stat label="RMS (window)" value={s.rms.toFixed(2)} suffix="m/s²" />
            <Stat label="Dominant freq." value={s.frequency.toFixed(1)} suffix="Hz" />
            <Stat label="Sampling" value={s.samplingHz || '—'} suffix="Hz" />
            <Stat label="Sensor" value={s.sensor.source} />
            <Stat label="Samples" value={s.sensor.received} />
          </div>
        </section>

        <section className="ml-card">
          <h2>Classification &amp; state</h2>
          <div className="ml-state-row">
            <span className="ml-state">{s.state}</span>
            <span className="ml-class">{s.classification ?? '—'}</span>
          </div>
          <div className="ml-confidence">
            <span>Confidence</span>
            <div className="ml-bar"><i style={{ width: `${Math.round(s.confidence * 100)}%` }} /></div>
            <strong>{s.confidence.toFixed(2)}</strong>
          </div>
          <ul className="ml-reasons">
            {(s.reasons.length ? s.reasons : ['No classification yet.']).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <p className="ml-note">
            Accepted {s.engine.accepted} · Rejected {s.engine.rejected} ·
            Cooldown {Math.round(s.engine.cooldownRemainingMs / 1000)}s
          </p>
        </section>

        <section className="ml-card">
          <h2>Controls</h2>
          <div className="ml-controls">
            <button className="ml-btn" onClick={() => void (lab.monitoring ? lab.stopMonitoring() : lab.startMonitoring())}>
              {lab.monitoring ? <Square size={14} /> : <Play size={14} />}
              {lab.monitoring ? 'Stop monitoring' : 'Start monitoring'}
            </button>
            <button className="ml-btn" onClick={() => lab.setRecordingState(!lab.recording)}>
              {lab.recording ? <Square size={14} /> : <Activity size={14} />}
              {lab.recording ? 'Stop recording' : 'Start recording'}
            </button>
            <select className="ml-select" value={dataset} onChange={(e) => setDataset(e.target.value as DatasetName)}>
              {DATASET_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button className="ml-btn primary" onClick={() => lab.simulate(dataset)}>
              <Play size={14} /> Simulate motion
            </button>
            <select className="ml-select" value={lab.sensitivity} onChange={(e) => lab.setSensitivity(e.target.value as Sensitivity)}>
              <option value="low">Low sensitivity</option>
              <option value="medium">Medium sensitivity</option>
              <option value="high">High sensitivity</option>
            </select>
            <label className="ml-toggle">
              <input type="checkbox" checked={lab.testMode} onChange={(e) => lab.setTestMode(e.target.checked)} />
              Test mode (no notifications)
            </label>
            <button className="ml-btn" onClick={download}><Download size={14} /> Export JSON</button>
            <button className="ml-btn" onClick={lab.clearHistory}><RotateCcw size={14} /> Reset detection state</button>
            <button className="ml-btn danger" onClick={lab.clearHistory}><Trash2 size={14} /> Clear history</button>
          </div>
          {lab.lastDataset && (
            <p className="ml-note">Last simulated dataset: <strong>{lab.lastDataset}</strong></p>
          )}
        </section>

        <section className="ml-card ml-card--wide">
          <h2>Motion event history</h2>
          <div className="ml-table-wrap">
            <table className="ml-table">
              <thead>
                <tr>
                  <th>Time</th><th>Classification</th><th>Result</th><th>Confidence</th>
                  <th>Duration</th><th>Peak</th><th>Freq.</th><th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {s.history.length === 0 && (
                  <tr><td colSpan={8} className="ml-empty">No events recorded yet.</td></tr>
                )}
                {s.history.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.timestampMs).toLocaleTimeString()}</td>
                    <td>{e.classification}</td>
                    <td className={e.accepted ? 'ml-accepted' : ''}>{e.accepted ? 'ACCEPTED' : 'rejected'}</td>
                    <td>{e.confidence.toFixed(2)}</td>
                    <td>{Math.round(e.durationMs)} ms</td>
                    <td>{e.peakAcceleration.toFixed(1)}</td>
                    <td>{e.dominantFrequencyHz.toFixed(1)} Hz</td>
                    <td>{e.reason}{e.simulated ? ' · simulated' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

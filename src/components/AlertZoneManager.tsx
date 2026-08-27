import { useState, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  AlertTriangle,
  Power,
  PowerOff,
} from 'lucide-react';
import type { AlertZone } from '../types/alerts';
import {
  getAlertZones,
  addAlertZone,
  updateAlertZone,
  deleteAlertZone,
} from '../lib/alertStorage';
import './AlertZoneManager.css';

const MAX_ZONES = 10;
const PH_CENTER: [number, number] = [12.8797, 121.7740];

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function ZoneForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: AlertZone;
  onSave: (zone: Omit<AlertZone, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [lat, setLat] = useState(initial?.latitude ?? PH_CENTER[0]);
  const [lng, setLng] = useState(initial?.longitude ?? PH_CENTER[1]);
  const [radius, setRadius] = useState(initial?.radiusKm ?? 50);
  const [threshold, setThreshold] = useState(initial?.magnitudeThreshold ?? 4.5);
  const [centerSet, setCenterSet] = useState(!!initial);

  const handleMapClick = useCallback((newLat: number, newLng: number) => {
    setLat(newLat);
    setLng(newLng);
    setCenterSet(true);
  }, []);

  const handleSubmit = () => {
    if (!centerSet) return;
    onSave({
      name: name.trim() || `Zone ${Date.now().toString(36).slice(-4)}`,
      latitude: lat,
      longitude: lng,
      radiusKm: radius,
      magnitudeThreshold: threshold,
      enabled: initial?.enabled ?? true,
    });
  };

  const markerIcon = L.divIcon({
    className: 'alert-zone-marker',
    html: `<div style="width:14px;height:14px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px #ef444488;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  return (
    <div className="azf glass">
      <div className="azf-header">
        <h4>{initial ? 'Edit Zone' : 'New Alert Zone'}</h4>
        <button className="azf-close" onClick={onCancel} title="Cancel">
          <X size={16} />
        </button>
      </div>

      <div className="azf-map-wrap">
        <MapContainer
          center={[lat, lng]}
          zoom={6}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%', borderRadius: '12px' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
          <MapClickHandler onMapClick={handleMapClick} />
          {centerSet && (
            <>
              <Circle
                center={[lat, lng]}
                radius={radius * 1000}
                pathOptions={{
                  color: '#ef4444',
                  fillColor: '#ef4444',
                  fillOpacity: 0.12,
                  weight: 2,
                }}
              />
              <Marker position={[lat, lng]} icon={markerIcon} />
            </>
          )}
        </MapContainer>
        {!centerSet && (
          <div className="azf-map-hint">
            <MapPin size={14} /> Click on the map to place zone center
          </div>
        )}
      </div>

      <div className="azf-fields">
        <label className="azf-label">
          Zone Name
          <input
            type="text"
            className="azf-input"
            placeholder="e.g. My Province"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={40}
          />
        </label>

        <div className="azf-coords">
          <span className="azf-coord-chip">
            {lat.toFixed(4)}°N, {lng.toFixed(4)}°E
          </span>
        </div>

        <label className="azf-label">
          Radius: {radius} km
          <input
            type="range"
            className="azf-slider"
            min={10}
            max={500}
            step={10}
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
          />
          <div className="azf-slider-labels">
            <span>10 km</span>
            <span>500 km</span>
          </div>
        </label>

        <label className="azf-label">
          Magnitude Threshold: M{threshold.toFixed(1)}
          <input
            type="range"
            className="azf-slider"
            min={1}
            max={9}
            step={0.5}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
          />
          <div className="azf-slider-labels">
            <span>M1.0</span>
            <span>M9.0</span>
          </div>
        </label>
      </div>

      <div className="azf-actions">
        <button className="azf-btn azf-btn-save" onClick={handleSubmit} disabled={!centerSet}>
          <Check size={14} />
          {initial ? 'Update Zone' : 'Save Zone'}
        </button>
        <button className="azf-btn azf-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AlertZoneManager() {
  const [zones, setZones] = useState<AlertZone[]>(getAlertZones);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleSave = (data: Omit<AlertZone, 'id' | 'createdAt'>) => {
    if (editingId) {
      updateAlertZone(editingId, data);
    } else {
      const zone: AlertZone = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      addAlertZone(zone);
    }
    setZones(getAlertZones());
    setEditingId(null);
    setCreating(false);
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Delete alert zone "${name}"?`)) {
      deleteAlertZone(id);
      setZones(getAlertZones());
    }
  };

  const handleToggle = (id: string, enabled: boolean) => {
    updateAlertZone(id, { enabled: !enabled });
    setZones(getAlertZones());
  };

  const editingZone = editingId ? zones.find(z => z.id === editingId) ?? null : null;
  const atLimit = zones.length >= MAX_ZONES;

  return (
    <div className="azm">
      <div className="azm-header flex-between">
        <h3 className="azm-title">
          <MapPin size={18} />
          Alert Zones
        </h3>
        <span className="azm-count">
          {zones.length}/{MAX_ZONES}
        </span>
      </div>

      {(creating || editingId) && (
        <ZoneForm
          initial={editingZone ?? undefined}
          onSave={handleSave}
          onCancel={() => {
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}

      {!creating && !editingId && (
        <>
          {zones.length === 0 && (
            <div className="azm-empty glass-card">
              <AlertTriangle size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p>No alert zones configured.</p>
              <p className="azm-empty-sub">
                Create a zone to receive notifications when earthquakes occur nearby.
              </p>
            </div>
          )}

          <div className="azm-list">
            {zones.map(zone => (
              <div
                key={zone.id}
                className={`azm-zone glass-card ${!zone.enabled ? 'azm-zone--disabled' : ''}`}
              >
                <div className="azm-zone-top">
                  <div className="azm-zone-info">
                    <span className="azm-zone-name">{zone.name}</span>
                    <span className="azm-zone-meta">
                      M{zone.magnitudeThreshold.toFixed(1)}+ · {zone.radiusKm} km radius
                    </span>
                    <span className="azm-zone-coords">
                      {zone.latitude.toFixed(3)}°N, {zone.longitude.toFixed(3)}°E
                    </span>
                  </div>
                  <div className="azm-zone-actions">
                    <button
                      className="azm-icon-btn"
                      onClick={() => handleToggle(zone.id, zone.enabled)}
                      title={zone.enabled ? 'Disable zone' : 'Enable zone'}
                    >
                      {zone.enabled ? (
                        <Power size={15} style={{ color: '#10b981' }} />
                      ) : (
                        <PowerOff size={15} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </button>
                    <button
                      className="azm-icon-btn"
                      onClick={() => setEditingId(zone.id)}
                      title="Edit zone"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="azm-icon-btn azm-icon-btn--danger"
                      onClick={() => handleDelete(zone.id, zone.name)}
                      title="Delete zone"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!atLimit && (
            <button className="azm-add-btn glass-card" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Add Alert Zone
            </button>
          )}
        </>
      )}
    </div>
  );
}

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, CircleMarker, Tooltip, Popup, useMapEvents } from 'react-leaflet';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { Expand, MapPin, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './InteractiveMap.css';

type InteractiveMapProps = {
  earthquakes: PhivolcsEarthquake[];
  latestEarthquake?: PhivolcsEarthquake | null;
  showAllEvents?: boolean;
  compactMarkers?: boolean;
  autoCenter?: boolean;
  enableLegendFilter?: boolean;
};

function createMagnitudeIcon(magnitude: string, color: string, compact = false) {
  const label = magnitude || '';
  const size = compact ? 22 : 46;
  return L.divIcon({
    className: `eq-magnitude-marker${compact ? ' eq-magnitude-marker--compact' : ''}`,
    html: `<div class="eq-magnitude-marker__circle${compact ? ' eq-magnitude-marker__circle--compact' : ''}" style="--marker-color: ${color}"><span>${label}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function MapBoundsTracker({ onBoundsChange }: { onBoundsChange: (bounds: L.LatLngBounds | null) => void }) {
  useMapEvents({
    moveend: (event) => onBoundsChange(event.target.getBounds()),
    zoomend: (event) => onBoundsChange(event.target.getBounds()),
    load: (event) => onBoundsChange(event.target.getBounds()),
  });

  return null;
}

function getSeverityHexColor(mag: number): string {
  if (mag < 3.0) return "#10b981";
  if (mag < 4.0) return "#3b82f6";
  if (mag < 5.0) return "#eab308";
  if (mag < 6.0) return "#f97316";
  if (mag < 7.0) return "#ef4444";
  return "#8b5cf6";
}

function InteractiveMapBase({ earthquakes, latestEarthquake, showAllEvents = false, compactMarkers = false, autoCenter = false, enableLegendFilter = false }: InteractiveMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [visibleBounds, setVisibleBounds] = useState<L.LatLngBounds | null>(null);
  const [selectedEarthquake, setSelectedEarthquake] = useState<PhivolcsEarthquake | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const latestLat = latestEarthquake ? parseFloat(latestEarthquake.latitude) : NaN;
  const latestLng = latestEarthquake ? parseFloat(latestEarthquake.longitude) : NaN;
  const hasLatestCoords = !Number.isNaN(latestLat) && !Number.isNaN(latestLng);
  const center: [number, number] = hasLatestCoords ? [latestLat, latestLng] : [12.8797, 121.7740];
  const latestColor = latestEarthquake ? getSeverityColor(parseFloat(latestEarthquake.magnitude)) : '#10b981';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (autoCenter && hasLatestCoords && mapRef.current) {
      mapRef.current.setView([latestLat, latestLng], 8, { animate: true });
    }
  }, [autoCenter, hasLatestCoords, latestLat, latestLng]);

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  const visibleEarthquakes = useMemo(() => {
    if (!showAllEvents) return [];
    if (!visibleBounds) return earthquakes;

    return earthquakes.filter((eq) => {
      const lat = Number.parseFloat(eq.latitude);
      const lng = Number.parseFloat(eq.longitude);
      return !Number.isNaN(lat) && !Number.isNaN(lng) && visibleBounds.contains([lat, lng]);
    });
  }, [earthquakes, showAllEvents, visibleBounds]);

  const normalMapMarkers = useMemo(() => {
    return visibleEarthquakes.map((eq, i) => {
      const mag = parseFloat(eq.magnitude);
      const lat = parseFloat(eq.latitude);
      const lng = parseFloat(eq.longitude);

      if (isNaN(lat) || isNaN(lng)) return null;
      if (latestEarthquake && eq.datetime === latestEarthquake.datetime && eq.latitude === latestEarthquake.latitude && eq.longitude === latestEarthquake.longitude) {
        return null;
      }
      if (activeFilter && getSeverityLabel(mag) !== activeFilter) {
        return null;
      }
      const hexColor = getSeverityHexColor(mag);
      const radius = compactMarkers ? Math.max(14, mag * 2.5) : Math.max(18, mag * 4);

      return (
        <CircleMarker
          key={i}
          center={[lat, lng]}
          radius={radius}
          pathOptions={{
            color: hexColor,
            fillColor: hexColor,
            fillOpacity: 0.6,
            weight: 2
          }}
          eventHandlers={{
            click: () => setSelectedEarthquake(eq),
          }}
        >
          <Tooltip direction="center" permanent className="marker-number-tooltip" opacity={1}>
            {mag.toFixed(1)}
          </Tooltip>
        </CircleMarker>
      );
    });
  }, [visibleEarthquakes, latestEarthquake, compactMarkers, activeFilter]);

  const fullscreenMapMarkers = useMemo(() => {
    return visibleEarthquakes.map((eq, i) => {
      const mag = parseFloat(eq.magnitude);
      const lat = parseFloat(eq.latitude);
      const lng = parseFloat(eq.longitude);

      if (isNaN(lat) || isNaN(lng)) return null;
      if (latestEarthquake && eq.datetime === latestEarthquake.datetime && eq.latitude === latestEarthquake.latitude && eq.longitude === latestEarthquake.longitude) {
        return null;
      }
      if (activeFilter && getSeverityLabel(mag) !== activeFilter) {
        return null;
      }
      const hexColor = getSeverityHexColor(mag);
      const radius = compactMarkers ? Math.max(6, mag * 2.5) : Math.max(10, mag * 4);

      return (
        <CircleMarker
          key={`full-${i}`}
          center={[lat, lng]}
          radius={radius}
          pathOptions={{
            color: hexColor,
            fillColor: hexColor,
            fillOpacity: 0.6,
            weight: 2
          }}
          eventHandlers={{
            click: () => setSelectedEarthquake(eq),
          }}
        >
          <Tooltip direction="center" permanent className="marker-number-tooltip" opacity={1}>
            {mag.toFixed(1)}
          </Tooltip>
        </CircleMarker>
      );
    });
  }, [visibleEarthquakes, latestEarthquake, compactMarkers, activeFilter]);

  const popupPosition = useMemo<[number, number] | null>(() => {
    if (!selectedEarthquake) return null;
    const lat = parseFloat(selectedEarthquake.latitude);
    const lng = parseFloat(selectedEarthquake.longitude);
    if (isNaN(lat) || isNaN(lng)) return null;
    return [lat, lng];
  }, [selectedEarthquake]);

  const popupEventHandlers = useMemo(() => ({
    remove: () => setSelectedEarthquake(null)
  }), []);

  const renderPopup = () => {
    if (!selectedEarthquake || !popupPosition) return null;

    return (
      <Popup
        position={popupPosition}
        eventHandlers={popupEventHandlers}
        className="eq-popup-override"
        autoPan={false}
      >
        <div className="eq-modal-popup">
          <div className="eq-modal-head">
            <div className="eq-modal-mag" style={{ color: getSeverityColor(parseFloat(selectedEarthquake.magnitude)) }}>
              M {selectedEarthquake.magnitude}
            </div>
            <div className="eq-modal-label">{getSeverityLabel(parseFloat(selectedEarthquake.magnitude))} Severity</div>
          </div>
          <div className="eq-modal-body">
            <div className="eq-modal-row">
              <span className="eq-modal-key">Location</span>
              <span className="eq-modal-value" style={{ whiteSpace: 'normal' }}>{selectedEarthquake.location}</span>
            </div>
            <div className="eq-modal-row">
              <span className="eq-modal-key">Date & Time</span>
              <span className="eq-modal-value">{selectedEarthquake.datetime}</span>
            </div>
            <div className="eq-modal-row">
              <span className="eq-modal-key">Depth</span>
              <span className="eq-modal-value">{selectedEarthquake.depth} km</span>
            </div>
            <div className="eq-modal-row">
              <span className="eq-modal-key">Coordinates</span>
              <span className="eq-modal-value">{selectedEarthquake.latitude}, {selectedEarthquake.longitude}</span>
            </div>
          </div>
          <Link
            to={`/details/${btoa(`${selectedEarthquake.datetime}-${selectedEarthquake.latitude}-${selectedEarthquake.longitude}`).replace(/=/g, '')}`}
            className="eq-modal-link"
          >
            View Full Details <ExternalLink size={14} />
          </Link>
        </div>
      </Popup>
    );
  };

  return (
    <div className={`map-wrapper glass ${isFullscreen ? 'map-wrapper--fullscreen' : ''}`}>
      <div className="map-header">
        <div className="map-title-row">
          <MapPin size={18} className="map-icon" />
          <h3 className="map-title">Seismic Activity Map</h3>
        </div>
        <div className="map-header-actions">
          <span className="map-count-badge">
            {showAllEvents ? `${earthquakes.length} events` : latestEarthquake ? 'Latest event' : 'No data'}
          </span>
          <button
            type="button"
            className="map-fullscreen-btn"
            onClick={() => setIsFullscreen(true)}
            aria-label="Open map full screen"
            title="Full screen"
          >
            <Expand size={16} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="map-legend">
        {['Micro', 'Minor', 'Light', 'Moderate', 'Strong', 'Major'].map(label => {
          const mag = label === 'Micro' ? 1 : label === 'Minor' ? 3 : label === 'Light' ? 4 : label === 'Moderate' ? 5 : label === 'Strong' ? 6 : 7;
          const isActive = activeFilter === label;
          return (
            <span 
              key={label} 
              className={`legend-chip ${isActive ? 'legend-chip--active' : ''} ${enableLegendFilter ? 'legend-chip--clickable' : ''}`}
              onClick={() => {
                if (enableLegendFilter) {
                  setActiveFilter(prev => prev === label ? null : label);
                }
              }}
            >
              <span className="legend-dot" style={{ backgroundColor: getSeverityColor(mag) }}></span>
              {label}
            </span>
          );
        })}
      </div>

      <div className="map-container-inner">
        <MapContainer
          ref={mapRef}
          center={center}
          zoom={hasLatestCoords ? 8 : 5}
          scrollWheelZoom={false}
          preferCanvas={true}
          style={{ height: '100%', width: '100%', zIndex: 0 }}
        >
          <MapBoundsTracker onBoundsChange={setVisibleBounds} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {latestEarthquake && hasLatestCoords && (
            <Marker
              position={[latestLat, latestLng]}
              icon={createMagnitudeIcon(latestEarthquake.magnitude, latestColor, compactMarkers)}
              eventHandlers={{
                click: () => setSelectedEarthquake(latestEarthquake),
              }}
            >
            </Marker>
          )}
          {normalMapMarkers}
          {!isFullscreen && renderPopup()}
        </MapContainer>
      </div>

      {isFullscreen && createPortal(
        <div
          className="map-fullscreen-overlay"
          role="presentation"
          onClick={() => setIsFullscreen(false)}
        >
          <div
            className="map-fullscreen-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Seismic Activity Map full screen"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="map-fullscreen-topbar">
              <div className="map-title-row">
                <MapPin size={18} className="map-icon" />
                <h3 className="map-title">Seismic Activity Map</h3>
              </div>
              <button
                type="button"
                className="map-fullscreen-close"
                onClick={() => setIsFullscreen(false)}
                aria-label="Close full screen map"
              >
                <X size={18} />
              </button>
            </div>
            <div className="map-fullscreen-body">
              <MapContainer
                ref={mapRef}
                center={center}
                zoom={hasLatestCoords ? 8 : 5}
                scrollWheelZoom={false}
                preferCanvas={true}
                style={{ height: '100%', width: '100%', zIndex: 0 }}
              >
                <MapBoundsTracker onBoundsChange={setVisibleBounds} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                {latestEarthquake && hasLatestCoords && (
                  <Marker
                    position={[latestLat, latestLng]}
                    icon={createMagnitudeIcon(latestEarthquake.magnitude, latestColor, compactMarkers)}
                    eventHandlers={{
                      click: () => setSelectedEarthquake(latestEarthquake),
                    }}
                  />
                )}
                {fullscreenMapMarkers}
                {isFullscreen && renderPopup()}
              </MapContainer>
            </div>
          </div>
        </div>
        ,
        document.body
      )}
    </div>
  );
}

export const InteractiveMap = memo(InteractiveMapBase);

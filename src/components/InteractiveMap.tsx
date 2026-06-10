import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
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

function InteractiveMapBase({ earthquakes, latestEarthquake, showAllEvents = false, compactMarkers = false }: InteractiveMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [visibleBounds, setVisibleBounds] = useState<L.LatLngBounds | null>(null);
  const [selectedEarthquake, setSelectedEarthquake] = useState<PhivolcsEarthquake | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
          return (
            <span key={label} className="legend-chip">
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
          {visibleEarthquakes.map((eq, i) => {
            const mag = parseFloat(eq.magnitude);
            const lat = parseFloat(eq.latitude);
            const lng = parseFloat(eq.longitude);
            
            if (isNaN(lat) || isNaN(lng)) return null;
            if (latestEarthquake && eq.datetime === latestEarthquake.datetime && eq.latitude === latestEarthquake.latitude && eq.longitude === latestEarthquake.longitude) {
              return null;
            }
            const color = getSeverityColor(mag);

            return (
              <Marker
                key={i}
                position={[lat, lng]}
                icon={createMagnitudeIcon(eq.magnitude, color, compactMarkers)}
                eventHandlers={{
                  click: () => setSelectedEarthquake(eq),
                }}
              />
            );
          })}
        </MapContainer>
      </div>

      {selectedEarthquake && createPortal(
        <div
          className="eq-modal-backdrop"
          role="presentation"
          onClick={() => setSelectedEarthquake(null)}
        >
          <div
            className="eq-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Earthquake details"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="eq-modal-close"
              onClick={() => setSelectedEarthquake(null)}
              aria-label="Close details"
            >
              <X size={18} />
            </button>
            <div className="eq-modal-head">
              <div className="eq-modal-mag" style={{ color: getSeverityColor(parseFloat(selectedEarthquake.magnitude)) }}>
                M {selectedEarthquake.magnitude}
              </div>
              <div className="eq-modal-label">{getSeverityLabel(parseFloat(selectedEarthquake.magnitude))} Severity</div>
            </div>
            <div className="eq-modal-body">
              <div className="eq-modal-row">
                <span className="eq-modal-key">Location</span>
                <span className="eq-modal-value">{selectedEarthquake.location}</span>
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
        </div>
        ,
        document.body
      )}

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
                {visibleEarthquakes.map((eq, i) => {
                  const mag = parseFloat(eq.magnitude);
                  const lat = parseFloat(eq.latitude);
                  const lng = parseFloat(eq.longitude);

                  if (isNaN(lat) || isNaN(lng)) return null;
                  if (latestEarthquake && eq.datetime === latestEarthquake.datetime && eq.latitude === latestEarthquake.latitude && eq.longitude === latestEarthquake.longitude) {
                    return null;
                  }
                  const color = getSeverityColor(mag);

                  return (
                    <Marker
                      key={`full-${i}`}
                      position={[lat, lng]}
                      icon={createMagnitudeIcon(eq.magnitude, color, compactMarkers)}
                      eventHandlers={{
                        click: () => setSelectedEarthquake(eq),
                      }}
                    />
                  );
                })}
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

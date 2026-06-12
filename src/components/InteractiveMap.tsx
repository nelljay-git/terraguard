import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMapEvents, useMap } from 'react-leaflet';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import { getSeverityColor, getSeverityLabel } from '../lib/utils';
import { Expand, MapPin, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import useSupercluster from 'use-supercluster';
import 'leaflet/dist/leaflet.css';
import './InteractiveMap.css';

const ZOOM_THRESHOLD = 8;

type InteractiveMapProps = {
  earthquakes: PhivolcsEarthquake[];
  latestEarthquake?: PhivolcsEarthquake | null;
  showAllEvents?: boolean;
  compactMarkers?: boolean;
};

function MapContent({
  earthquakes,
  latestEarthquake,
  showAllEvents,
  setSelectedEarthquake,
  compactMarkers,
}: {
  earthquakes: PhivolcsEarthquake[];
  latestEarthquake?: PhivolcsEarthquake | null;
  showAllEvents?: boolean;
  setSelectedEarthquake: (eq: PhivolcsEarthquake) => void;
  compactMarkers?: boolean;
}) {
  const map = useMap();
  const [bounds, setBounds] = useState<[number, number, number, number] | undefined>(undefined);
  const [zoom, setZoom] = useState(map.getZoom());

  const updateBounds = useCallback(() => {
    const b = map.getBounds();
    setBounds([
      b.getSouthWest().lng,
      b.getSouthWest().lat,
      b.getNorthEast().lng,
      b.getNorthEast().lat,
    ]);
    setZoom(map.getZoom());
  }, [map]);

  useMapEvents({
    moveend: updateBounds,
    zoomend: updateBounds,
  });

  useEffect(() => {
    updateBounds();
  }, [updateBounds]);

  const points = useMemo(() => {
    if (!showAllEvents) return [];

    return earthquakes
      .filter((eq) => {
        const lat = parseFloat(eq.latitude);
        const lng = parseFloat(eq.longitude);
        if (isNaN(lat) || isNaN(lng)) return false;

        if (
          latestEarthquake &&
          eq.datetime === latestEarthquake.datetime &&
          eq.latitude === latestEarthquake.latitude &&
          eq.longitude === latestEarthquake.longitude
        ) {
          return false;
        }
        return true;
      })
      .map((eq) => {
        const lat = parseFloat(eq.latitude);
        const lng = parseFloat(eq.longitude);
        const mag = parseFloat(eq.magnitude);
        return {
          type: 'Feature' as const,
          properties: {
            cluster: false,
            eqId: `${eq.datetime}-${lat}-${lng}`,
            magnitude: mag,
            maxMag: mag, // Added for supercluster reduce
            earthquake: eq,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
        };
      });
  }, [earthquakes, showAllEvents, latestEarthquake]);

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds,
    zoom,
    options: {
      radius: 60,
      maxZoom: 16,
      map: (props) => ({ maxMag: props.maxMag }),
      reduce: (accumulated, props) => {
        accumulated.maxMag = Math.max(accumulated.maxMag, props.maxMag);
      }
    },
  });

  const latestLat = latestEarthquake ? parseFloat(latestEarthquake.latitude) : NaN;
  const latestLng = latestEarthquake ? parseFloat(latestEarthquake.longitude) : NaN;
  const hasLatestCoords = !isNaN(latestLat) && !isNaN(latestLng);
  const latestColor = latestEarthquake ? getSeverityColor(parseFloat(latestEarthquake.magnitude)) : '#10b981';

  return (
    <>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {latestEarthquake && hasLatestCoords && (
        <CircleMarker
          center={[latestLat, latestLng]}
          radius={compactMarkers ? 10 : 16}
          pathOptions={{
            color: '#ffffff',
            fillColor: latestColor,
            fillOpacity: 0.8,
            weight: 3,
          }}
          eventHandlers={{
            click: () => setSelectedEarthquake(latestEarthquake),
          }}
        >
          {zoom >= ZOOM_THRESHOLD && (
            <Tooltip direction="center" permanent className="eq-canvas-tooltip">
              {latestEarthquake.magnitude}
            </Tooltip>
          )}
        </CircleMarker>
      )}

      {clusters.map((cluster) => {
        const [longitude, latitude] = cluster.geometry.coordinates;
        const { cluster: isCluster, point_count: pointCount } = cluster.properties as any;

        if (isCluster) {
          const maxMag = cluster.properties.maxMag || 1;
          const clusterColor = getSeverityColor(maxMag);
          const size = Math.min(18 + (pointCount / points.length) * 25, 36);

          return (
            <CircleMarker
              key={`cluster-${cluster.id}`}
              center={[latitude, longitude]}
              radius={size}
              pathOptions={{
                color: clusterColor,
                fillColor: clusterColor,
                fillOpacity: 0.35,
                weight: 2,
              }}
              eventHandlers={{
                click: () => {
                  if (!supercluster) return;
                  const expansionZoom = Math.min(
                    supercluster.getClusterExpansionZoom(cluster.id as number),
                    16
                  );
                  map.setView([latitude, longitude], expansionZoom, {
                    animate: true,
                  });
                },
              }}
            >
              <Tooltip direction="center" permanent className="eq-cluster-tooltip">
                {pointCount}
              </Tooltip>
            </CircleMarker>
          );
        }

        const props = cluster.properties as any;
        const eq = props.earthquake;
        const mag = props.magnitude;
        const color = getSeverityColor(mag);

        return (
          <CircleMarker
            key={`eq-${props.eqId}`}
            center={[latitude, longitude]}
            radius={compactMarkers ? 7 : 10}
            pathOptions={{ color: '#ffffff', fillColor: color, fillOpacity: 0.8, weight: 1.5 }}
            eventHandlers={{
              click: () => setSelectedEarthquake(eq),
            }}
          >
            {zoom >= ZOOM_THRESHOLD && (
              <Tooltip direction="center" permanent className={`eq-canvas-tooltip ${mag >= 5 ? 'eq-canvas-tooltip--glow' : ''}`}>
                {eq.magnitude}
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}
    </>
  );
}

const MemoizedMapContent = memo(MapContent);

function InteractiveMapBase({
  earthquakes,
  latestEarthquake,
  showAllEvents = false,
  compactMarkers = false,
}: InteractiveMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const fullscreenMapRef = useRef<L.Map | null>(null);
  const [selectedEarthquake, setSelectedEarthquake] = useState<PhivolcsEarthquake | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const latestLat = latestEarthquake ? parseFloat(latestEarthquake.latitude) : NaN;
  const latestLng = latestEarthquake ? parseFloat(latestEarthquake.longitude) : NaN;
  const hasLatestCoords = !isNaN(latestLat) && !isNaN(latestLng);
  const center: [number, number] = hasLatestCoords ? [latestLat, latestLng] : [12.8797, 121.7740];

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
        {['Micro', 'Minor', 'Light', 'Moderate', 'Strong', 'Major'].map((label) => {
          const mag =
            label === 'Micro' ? 1 : label === 'Minor' ? 3 : label === 'Light' ? 4 : label === 'Moderate' ? 5 : label === 'Strong' ? 6 : 7;
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
          preferCanvas={true}
        >
          <MemoizedMapContent
            earthquakes={earthquakes}
            latestEarthquake={latestEarthquake}
            showAllEvents={showAllEvents}
            setSelectedEarthquake={setSelectedEarthquake}
            compactMarkers={compactMarkers}
          />
        </MapContainer>
      </div>

      {selectedEarthquake &&
        createPortal(
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
                <div
                  className="eq-modal-mag"
                  style={{ color: getSeverityColor(parseFloat(selectedEarthquake.magnitude)) }}
                >
                  M {selectedEarthquake.magnitude}
                </div>
                <div className="eq-modal-label">
                  {getSeverityLabel(parseFloat(selectedEarthquake.magnitude))} Severity
                </div>
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
                  <span className="eq-modal-value">
                    {selectedEarthquake.latitude}, {selectedEarthquake.longitude}
                  </span>
                </div>
              </div>
              <Link
                to={`/details/${btoa(
                  `${selectedEarthquake.datetime}-${selectedEarthquake.latitude}-${selectedEarthquake.longitude}`
                ).replace(/=/g, '')}`}
                className="eq-modal-link"
              >
                View Full Details <ExternalLink size={14} />
              </Link>
            </div>
          </div>,
          document.body
        )}

      {isFullscreen &&
        createPortal(
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
                  ref={fullscreenMapRef}
                  center={center}
                  zoom={hasLatestCoords ? 8 : 5}
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%', zIndex: 0 }}
                  preferCanvas={true}
                >
                  <MemoizedMapContent
                    earthquakes={earthquakes}
                    latestEarthquake={latestEarthquake}
                    showAllEvents={showAllEvents}
                    setSelectedEarthquake={setSelectedEarthquake}
                    compactMarkers={compactMarkers}
                  />
                </MapContainer>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export const InteractiveMap = memo(InteractiveMapBase);

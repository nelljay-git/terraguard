import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { fetchEarthquakeData, fetchArchiveData, fetchEarthquakeDetails, fetchBulletins, normalizeEarthquakes, type PhivolcsEarthquake, type EarthquakeDetails, type BulletinRef } from '../api/phivolcs';
import { getPreferredApi } from '../lib/apiPreference';
import { earthquakeToEqId, migrateEventEngagement } from '../lib/supabase';
import { getSeverityColor, getSeverityLabel, haversineKm, timeAgo } from '../lib/utils';
import { PH_PROVINCES, PH_CITIES } from '../data/phLocations';
import { MapContainer, TileLayer, Marker, WMSTileLayer } from 'react-leaflet';
import L from 'leaflet';
import { ArrowLeft, MapPin, Activity, Clock, ShieldAlert, Users, Info, Share2, Copy, Check, Zap, AlertTriangle, X, Map as MapIcon, Image as ImageIcon, ExternalLink, Waves, Navigation } from 'lucide-react';
import { motion } from 'framer-motion';
import { ImageModal } from '../components/ImageModal';
import { FunFactLoader } from '../components/FunFactLoader';
import { ActiveFaultsLayer } from '../components/ActiveFaultsLayer';
import { AftershockTracker } from '../components/AftershockTracker';
import { SeismicWaveLayer } from '../components/SeismicWaveLayer';
import { CommunitySection } from '../components/CommunitySection';
import './Details.css';

// Match earthquakes even when PHIVOLCS revises the data (e.g. coordinates change),
// which would otherwise invalidate shared /details links. We fall back to matching
// on the event's datetime, the portion PHIVOLCS keeps stable.
function normalizeDatetime(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Extract the PHIVOLCS Information/Bulletin number from the event's detail link.
// e.g. ".../2026_0714_154928_B1.html" -> No. 1, ".../2026_0714_1549_B2F.html" -> No. 2 (Final)
function extractBulletin(link: string | undefined): { no: number; final: boolean } | null {
  if (!link) return null;
  const m = /_B(\d+)(F)?/i.exec(link);
  if (!m) return null;
  return { no: parseInt(m[1], 10), final: m[2]?.toUpperCase() === 'F' };
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(' ');
}

// Rough bounding box covering the Philippine archipelago. Used to decide
// whether listing distances to PH provinces/cities is meaningful for an event
// (USGS can report quakes anywhere in the world).
function isInPhilippines(lat: number, lng: number): boolean {
  return lat >= 4.5 && lat <= 21.5 && lng >= 116.0 && lng <= 127.0;
}

// Pull just the clock portion out of a PHIVOLCS datetime ("05 August 2026 - 12:13 PM"
// -> "12:13 PM") so revision notices read compactly.
function extractTime(s: string): string {
  const m = /(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)/i.exec(s);
  return m ? m[1].toUpperCase() : s;
}

// Classify the reporting agency's tsunami text into a banner state. The "none"
// phrasing ("No destructive tsunami threat exists") must be matched first so it
// isn't swallowed by the warning pattern. Unreadable text yields no banner.
function classifyTsunami(text: string): { level: 'warning' | 'advisory' | 'none'; label: string } | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/no destructive|no tsunami|no threat|not expect|does not pose|no hazard/i.test(t)) {
    return { level: 'none', label: 'No Tsunami Threat' };
  }
  if (/warning|destructive tsunami may|destructive tsunami threat exists/i.test(t)) {
    return { level: 'warning', label: 'Tsunami Warning' };
  }
  if (/advisory|watch|potential tsunami|low tsunami|may generate/i.test(t)) {
    return { level: 'advisory', label: 'Tsunami Advisory' };
  }
  return null;
}

interface RevisionInfo {
  changedTime: boolean;
  changedCoords: boolean;
  changedMag: boolean;
  origMag?: string;
  curMag?: string;
  origTime?: string;
  curTime?: string;
  origLat?: string;
  origLng?: string;
  curLat?: string;
  curLng?: string;
}

// Bottom-right toast announcing the reporting agency revised this event.
// Slides in from the right, auto-dismisses after 10 seconds (or on close
// click), then slides back out to the right before unmounting. Keyed by event
// id in the parent so it remounts (and the timer restarts) when navigating to
// a different event.
function RevisionToast({ info, sourceName }: { info: RevisionInfo; sourceName: string }) {
  const [closing, setClosing] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setClosing(true), 10000);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;

  return (
    <div
      className={`revision-toast${closing ? ' revision-toast--closing' : ''}`}
      onTransitionEnd={() => { if (closing) setGone(true); }}
    >
      <div className="revision-toast-header">
        <AlertTriangle size={18} />
        <span>Earthquake data was updated</span>
        <button
          type="button"
          className="revision-toast-close"
          aria-label="Dismiss"
          onClick={() => setClosing(true)}
        >
          <X size={14} />
        </button>
      </div>
      <ul className="revision-toast-changes">
        {info.changedMag && info.origMag && info.curMag && (
          <li>
            Magnitude: <strong>M{info.origMag}</strong> → <strong>M{info.curMag}</strong>
          </li>
        )}
        {info.changedTime && info.origTime && info.curTime && (
          <li>
            Origin time: <strong>{extractTime(info.origTime)}</strong> → <strong>{extractTime(info.curTime)}</strong>
          </li>
        )}
        {info.changedCoords && info.origLat && info.origLng && (
          <li>
            Epicenter: <strong>{info.origLat}°N, {info.origLng}°E</strong> →{' '}
            <strong>{info.curLat}°N, {info.curLng}°E</strong>
          </li>
        )}
      </ul>
      <div className="revision-toast-note">Showing the latest info from {sourceName}.</div>
    </div>
  );
}

function decodeEqId(id: string): { datetime?: string; latitude?: string; longitude?: string } {
  try {
    const pad = id.length % 4;
    const paddedId = pad ? id + '='.repeat(4 - pad) : id;
    const decoded = atob(paddedId).trim();
    // Slug format is "DATETIME-LAT-LNG". Latitude/longitude are always the last
    // two tokens, but longitudes can be negative, which turns the separator
    // into "--" and would confuse a plain split(). Match them from the end.
    const m = /^(.*?)-(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(decoded);
    if (m) {
      return { datetime: m[1].trim(), latitude: m[2], longitude: m[3] };
    }
  } catch {
    /* ignore decode errors */
  }
  return {};
}

// PHIVOLCS tables and bulletins vary in format ("14 August 2026 - 07:53 AM",
// "13 Jun 2026 - 10:05:46 AM", etc.), so parse leniently to let revised event
// times still be compared as timestamps.
function parseDateTime(s: string): Date | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s.trim());
  if (!m) return null;
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthIdx = monthNames.indexOf(m[2].slice(0, 3).toLowerCase());
  if (monthIdx === -1) return null;
  let hour = parseInt(m[4], 10);
  const ap = (m[7] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  const date = new Date(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10), hour, parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0);
  return isNaN(date.getTime()) ? null : date;
}

// PHIVOLCS frequently revises event data: the origin time can shift by a minute
// or more, and the coordinates are refined too. When exact ID and datetime-string
// matches fail, match on the parsed time within a small tolerance, using
// coordinates only as a coarse rejector (a couple of degrees) plus a tiebreaker,
// preferring the closest candidate.
function fuzzyMatchEarthquake(data: PhivolcsEarthquake[], decoded: { datetime?: string; latitude?: string; longitude?: string }): PhivolcsEarthquake | null {
  if (!decoded.datetime) return null;
  const targetTime = parseDateTime(decoded.datetime);
  if (!targetTime) return null;
  const targetLat = parseFloat(decoded.latitude || '');
  const targetLng = parseFloat(decoded.longitude || '');
  const TIME_TOLERANCE_MIN = 5;
  const COORD_TOLERANCE_DEG = 5.0;

  let best: PhivolcsEarthquake | null = null;
  let bestScore = Infinity;
  for (const eq of data) {
    const t = parseDateTime(eq.datetime);
    if (!t) continue;
    const timeDiffMin = Math.abs(t.getTime() - targetTime.getTime()) / 60000;
    if (timeDiffMin > TIME_TOLERANCE_MIN) continue;

    const lat = parseFloat(eq.latitude);
    const lng = parseFloat(eq.longitude);
    if (!isNaN(targetLat) && !isNaN(targetLng) && !isNaN(lat) && !isNaN(lng)) {
      if (Math.abs(lat - targetLat) > COORD_TOLERANCE_DEG || Math.abs(lng - targetLng) > COORD_TOLERANCE_DEG) continue;
    }

    const latDiff = isNaN(lat) || isNaN(targetLat) ? 0 : Math.abs(lat - targetLat);
    const lngDiff = isNaN(lng) || isNaN(targetLng) ? 0 : Math.abs(lng - targetLng);
    const score = timeDiffMin * 2 + latDiff + lngDiff;
    if (score < bestScore) {
      bestScore = score;
      best = eq;
    }
  }
  return best;
}

export function Details() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  const [earthquake, setEarthquake] = useState<PhivolcsEarthquake | null>(state?.earthquake || null);
  const [details, setDetails] = useState<EarthquakeDetails | null>(null);
  const [loading, setLoading] = useState(!state?.earthquake);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mapView, setMapView] = useState<'interactive' | 'official'>('interactive');
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [bulletins, setBulletins] = useState<BulletinRef[]>([]);
  const [activeLink, setActiveLink] = useState<string | undefined>(earthquake?.link);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  // Tracks which old->new slug pairs have already been merged server-side, so
  // the migration RPC runs at most once per resolution even when the load
  // effect re-runs after the earthquake snapshot is set.
  const migratedEngagementRef = useRef<Set<string>>(new Set());
  const reportingAgency = getPreferredApi() === 'usgs' ? 'USGS' : 'PHIVOLCS-DOST';
  const isUsgs = getPreferredApi() === 'usgs';
  const [originExpanded, setOriginExpanded] = useState(false);

  // Set document title immediately and update when data arrives
  useEffect(() => {
    if (earthquake) {
      const sev = getSeverityLabel(parseFloat(earthquake.magnitude));
      document.title = `M${earthquake.magnitude} ${sev} – ${earthquake.location} | TerraGuard`;
    } else {
      document.title = 'Loading Earthquake Details... | TerraGuard';
    }
    return () => { document.title = 'TerraGuard - Earthquake Monitoring'; };
  }, [earthquake]);

  // Reset the Origin "See more" expansion whenever a different quake loads
  const [originExpandedId, setOriginExpandedId] = useState(id);
  if (originExpandedId !== id) {
    setOriginExpandedId(id);
    setOriginExpanded(false);
  }

  // Update OG meta tags in the DOM for any JS-based scrapers
  const metaTagsSet = useRef(false);
  useEffect(() => {
    if (!earthquake || metaTagsSet.current) return;
    metaTagsSet.current = true;
    const sev = getSeverityLabel(parseFloat(earthquake.magnitude));
    const title = `M${earthquake.magnitude} Earthquake – ${earthquake.location}`;
    const desc = `A magnitude ${earthquake.magnitude} (${sev}) earthquake occurred at ${earthquake.location} on ${earthquake.datetime}. Depth: ${earthquake.depth} km.`;
    const lat = parseFloat(earthquake.latitude);
    const lng = parseFloat(earthquake.longitude);
    const img = (!isNaN(lat) && !isNaN(lng))
      ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,300&l=map&pt=${lng},${lat},pm2rdl`
      : `${window.location.origin}/pwa-512x512.png`;
    const url = window.location.href.replace(/[?&]_spa=1/, '');

    const setMeta = (attr: string, key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    setMeta('name', 'description', desc);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:image', img);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:type', 'article');
    setMeta('property', 'og:site_name', 'TerraGuard');
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', desc);
    setMeta('name', 'twitter:image', img);
  }, [earthquake]);

  useEffect(() => {
    async function loadEq() {
      if (!id) return;

      const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

      const matchId = (data: PhivolcsEarthquake[]) => {
        // 1. Exact match (data unchanged since the link was created)
        const exact = data.find(eq =>
          btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, '') === id
        );
        if (exact) return exact;

        // 2. PHIVOLCS likely revised the event (coords/depth/magnitude), so match
        //    on the datetime portion of the original ID.
        const decoded = decodeEqId(id);
        if (decoded.datetime) {
          const target = normalizeDatetime(decoded.datetime);
          const strMatch = data.find(eq => normalizeDatetime(eq.datetime) === target);
          if (strMatch) return strMatch;
        }

        // 3. PHIVOLCS also revises the origin time (sometimes by a minute or more),
        //    so fall back to fuzzy time + coordinate matching.
        return fuzzyMatchEarthquake(data, decoded);
      };

      try {
        // --- Decode the ID to find target year/month ---
        let targetYear = new Date().getFullYear();
        let targetMonthIndex = new Date().getMonth();

        try {
          const pad = id.length % 4;
          const paddedId = pad ? id + '='.repeat(4 - pad) : id;
          const decodedStr = atob(paddedId);
          const datePart = decodedStr.split('-')[0].trim();
          const match = datePart.match(/(\d+)\s+([A-Za-z]+)\s+(\d{4})/);
          if (match) {
            targetYear = parseInt(match[3], 10);
            const idx = months.findIndex(m => m.toLowerCase() === match[2].toLowerCase());
            if (idx !== -1) targetMonthIndex = idx;
          }
        } catch (e) {
          console.warn('Could not decode ID for historical fetch', e);
        }

        // When navigated with a snapshot that has no bulletin link (e.g. from
        // the Stars page), the event must still be resolved against the PHIVOLCS
        // feeds so reported intensities, origin, and bulletins can load.
        const needsResolution = !earthquake?.link;
        let found = needsResolution ? null : earthquake;

        if (!found) {
          // 1. Always try the live feed first (covers most recent events).
          //    fetchEarthquakeData respects the preferred source (PHIVOLCS or
          //    USGS); normalize so USGS GeoJSON features match the same shape
          //    as PHIVOLCS rows.
          try {
            const liveRes = await fetchEarthquakeData();
            found = matchId(normalizeEarthquakes(liveRes.data));
          } catch { /* continue */ }
        }

        if (!found) {
          // 2. Try the archive for the decoded month (respects the preferred API)
          try {
            const archiveRes = await fetchArchiveData(targetYear, months[targetMonthIndex]);
            found = matchId(normalizeEarthquakes(archiveRes.data));
          } catch { /* continue */ }
        }

        if (!found) {
          // 3. Try the previous month (handles month-boundary events)
          const prevMonthIndex = targetMonthIndex === 0 ? 11 : targetMonthIndex - 1;
          const prevYear = targetMonthIndex === 0 ? targetYear - 1 : targetYear;
          try {
            const prevRes = await fetchArchiveData(prevYear, months[prevMonthIndex]);
            found = matchId(normalizeEarthquakes(prevRes.data));
          } catch { /* continue */ }
        }

        if (!found) {
          // 4. Try next month (in case of time-zone edge cases)
          const nextMonthIndex = (targetMonthIndex + 1) % 12;
          const nextYear = targetMonthIndex === 11 ? targetYear + 1 : targetYear;
          try {
            const nextRes = await fetchArchiveData(nextYear, months[nextMonthIndex]);
            found = matchId(normalizeEarthquakes(nextRes.data));
          } catch { /* continue */ }
        }

        if (found) {
          if (needsResolution) setEarthquake(found);
          setLoading(false);
          setActiveLink(found.link);

          // PHIVOLCS revises events, so the URL slug may encode pre-revision
          // time/coords and differ from the resolved event's canonical slug.
          // Merge engagement (stars/likes/comments) that users recorded under
          // that old slug into the canonical slug, so the state shows no matter
          // which entry point led here (old link, Archive, Notifications).
          const canonicalEqId = earthquakeToEqId(found);
          if (id && canonicalEqId !== id) {
            const pair = `${id}|${canonicalEqId}`;
            if (!migratedEngagementRef.current.has(pair)) {
              migratedEngagementRef.current.add(pair);
              migrateEventEngagement(id, canonicalEqId).catch(() => {
                // Allow a retry on the next visit if the merge failed.
                migratedEngagementRef.current.delete(pair);
              });
            }
          }

          if (found.link) {
            try {
              const det = await fetchEarthquakeDetails(found.link);
              if (det) setDetails(det);
            } catch (err) {
              console.error('Failed to load extra details:', err);
            }
          }
        } else if (earthquake) {
          // Snapshot exists (e.g. a starred event) but the event can't be
          // re-resolved — keep showing the saved data rather than an error.
          setLoading(false);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error(err);
        setError(true);
      } finally {
        setLoading(false);
        setDetailsLoading(false);
      }
    }
    loadEq();
  }, [id, earthquake]);

   // Discover all bulletins PHIVOLCS published for this earthquake sequence
   useEffect(() => {
     if (!earthquake?.link) return;
     let cancelled = false;
     fetchBulletins(earthquake.link)
       .then(list => { if (!cancelled) setBulletins(list); })
       .catch(() => { if (!cancelled) setBulletins([]); });
      return () => { cancelled = true; };
   }, [earthquake?.link]);

   // Detect when the event data shown differs from what the /details/:id link
   // originally encoded (PHIVOLCS revised the event). Shows a notice on old
   // links. Magnitude can only be compared when navigation carried a snapshot
   // (e.g. from the Stars page), since the slug itself only stores time+coords.
   const revisionInfo = useMemo<RevisionInfo | null>(() => {
     if (!earthquake || !id) return null;
     const decoded = decodeEqId(id);

     const curTime = parseDateTime(earthquake.datetime);
     const origTime = parseDateTime(decoded.datetime || '');
     const changedTime = !!(curTime && origTime && Math.abs(curTime.getTime() - origTime.getTime()) >= 60000);

     const origLat = parseFloat(decoded.latitude || '');
     const origLng = parseFloat(decoded.longitude || '');
     const curLat = parseFloat(earthquake.latitude);
     const curLng = parseFloat(earthquake.longitude);
     const changedCoords = !isNaN(origLat) && !isNaN(origLng) && !isNaN(curLat) && !isNaN(curLng) &&
       (Math.abs(curLat - origLat) > 0.0005 || Math.abs(curLng - origLng) > 0.0005);

     const origMag = state?.earthquake?.magnitude;
     const changedMag = !!origMag && !!earthquake.magnitude && origMag !== earthquake.magnitude;

     if (!changedTime && !changedCoords && !changedMag) return null;

     return {
       changedTime,
       changedCoords,
       changedMag,
       origMag,
       curMag: changedMag ? earthquake.magnitude : undefined,
       origTime: decoded.datetime,
       curTime: earthquake.datetime,
       origLat: decoded.latitude,
       origLng: decoded.longitude,
       curLat: earthquake.latitude,
       curLng: earthquake.longitude,
      };
   }, [earthquake, id, state]);

   // Live relative time: tick once a minute so "happened X ago" stays fresh.
   const [now, setNow] = useState(() => Date.now());
   useEffect(() => {
     const t = setInterval(() => setNow(Date.now()), 60_000);
     return () => clearInterval(t);
   }, []);

   // Rank provinces and major cities by distance from the epicenter.
   const nearestProvinces = useMemo(() => {
    const eLat = parseFloat(earthquake?.latitude ?? '');
    const eLng = parseFloat(earthquake?.longitude ?? '');
    if (isNaN(eLat) || isNaN(eLng) || !isInPhilippines(eLat, eLng)) return [];
     return [...PH_PROVINCES, ...PH_CITIES]
       .map(p => ({ name: p.name, km: Math.round(haversineKm(eLat, eLng, p.lat, p.lng)) }))
       .sort((a, b) => a.km - b.km)
       .slice(0, 6);
   }, [earthquake]);

   if (loading) {
     return (
       <div className="container flex-center" style={{ height: '50vh' }}>
         <FunFactLoader
           title="Loading Details..."
           subtitle="Fetching event data from PHIVOLCS"
           icon={<Activity size={28} className="spinner-icon" />}
         />
       </div>
     );
   }

   if (error || !earthquake) {
     return (
       <div className="container flex-center" style={{ height: '50vh', flexDirection: 'column', gap: '16px' }}>
         <div className="error-icon-wrapper">
           <AlertTriangle size={48} color="var(--color-strong)" />
         </div>
         <h2>Earthquake Details Unavailable</h2>
         <p className="text-muted" style={{ textAlign: 'center', maxWidth: '400px' }}>
           This event may be historical or currently unavailable in the recent PHIVOLCS feed.
         </p>
         <Link to="/archive" className="back-btn glass">Back to Archive</Link>
       </div>
     );
   }

   const mag = parseFloat(earthquake.magnitude);
   const color = getSeverityColor(mag);
   const severityLabel = getSeverityLabel(mag);
   const lat = parseFloat(earthquake.latitude);
   const lng = parseFloat(earthquake.longitude);
   const isSevere = mag >= 6.0;
   const bulletin = extractBulletin(activeLink);
   const occurredAgo = timeAgo(parseDateTime(earthquake.datetime), now);
   const tsunamiInfo = classifyTsunami(details?.tsunami || '');

  const loadBulletinDetails = async (url: string) => {
    setDetailsLoading(true);
    try {
      const det = await fetchEarthquakeDetails(url);
      if (det) setDetails(det);
    } catch (err) {
      console.error('Failed to load bulletin details:', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleSelectBulletin = (b: BulletinRef) => {
    if (b.url === activeLink) return;
    setActiveLink(b.url);
    loadBulletinDetails(b.url);
  };


  // Energy Calculation: E = 10^(1.5 * M + 4.8) Joules
  // 1 Ton of TNT = 4.184e9 Joules
  const calculateEnergy = (magnitude: number) => {
    const joules = Math.pow(10, 1.5 * magnitude + 4.8);
    const tntTons = joules / 4.184e9;
    if (tntTons < 1) {
      return `${(tntTons * 1000).toFixed(1)} kg of TNT`;
    } else if (tntTons < 1000) {
      return `${tntTons.toLocaleString(undefined, { maximumFractionDigits: 1 })} Tons of TNT`;
    } else if (tntTons < 1000000) {
      return `${(tntTons / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Kilotons of TNT`;
    } else {
      return `${(tntTons / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Megatons of TNT`;
    }
  };

  // Generate responsive seismograph wavy path based on severity
  const generateSeismographPath = (magnitude: number) => {
    const amp = Math.min(Math.max((magnitude - 2) * 12, 4), 45); // Amplitude scaled with magnitude
    return `M 0 50 
            Q 30 50, 60 ${50 - amp * 0.2} 
            T 120 ${50 + amp * 0.4} 
            T 180 ${50 - amp * 0.8} 
            T 240 ${50 + amp} 
            T 300 ${50 - amp * 0.9} 
            T 360 ${50 + amp * 0.5} 
            T 420 ${50 - amp * 0.2} 
            T 480 50 L 600 50`;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleShare = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `M${earthquake.magnitude} Earthquake - ${earthquake.location}`,
          text: `Check out details for this M${earthquake.magnitude} earthquake in ${earthquake.location} at ${earthquake.datetime}`,
          url: window.location.href,
        });
      } catch (err) {
        console.error('Error sharing', err);
      }
    } else {
      handleCopy();
    }
  };

  const renderIntensities = (text: string) => {
    if (!text) return null;
    const lines = text.split(/Intensity\s+/i).filter(line => line.trim().length > 0);
    
    if (lines.length === 0 || !text.toLowerCase().includes('intensity')) {
      return (
        <div className="scrollable-content">
          <p className="text-muted" style={{ whiteSpace: 'pre-line', fontSize: '0.9rem', lineHeight: '1.5', margin: 0 }}>
            {text.replace(/Intensity /g, '\nIntensity ').trim()}
          </p>
        </div>
      );
    }

    return (
      <div className="intensities-list scrollable-content">
        {lines.map((line, idx) => {
          const parts = line.split(/\s*-\s*/);
          if (parts.length >= 2) {
            const level = parts[0].trim();
            const locations = parts.slice(1).join(' - ').trim();
            // Map Roman numerals to a safe CSS class name if possible, fallback to default
            const safeLevel = level.replace(/[^A-Za-z0-9]/g, '');
            return (
              <div key={idx} className="intensity-row">
                <div className={`intensity-badge intensity-${safeLevel}`}>{level}</div>
                <div className="intensity-locations">{locations}</div>
              </div>
            );
          }
          return (
            <div key={idx} className="intensity-row">
              <div className="intensity-locations">{line}</div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <motion.div 
        className="details-container container"
        initial={{ x: 0 }}
        animate={isSevere ? { 
          x: [0, -10, 10, -10, 10, -5, 5, 0],
          y: [0, 5, -5, 5, -5, 0, 0, 0]
        } : {}}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      >
      <div className="details-nav flex-between">
        <Link to="/archive" className="back-link flex-center">
          <ArrowLeft size={18} />
          <span>Back to Archive</span>
        </Link>
        <div className="action-buttons flex-center">
          <button
            className="action-btn glass flex-center"
            onClick={() => window.open(activeLink || earthquake?.link, '_blank', 'noopener')}
            title={activeLink || earthquake?.link}
          >
            <ExternalLink size={16} />
            <span>Open to {reportingAgency === 'USGS' ? 'USGS' : 'PHIVOLCS'}</span>
          </button>
          <button className="action-btn glass flex-center" onClick={handleCopy} title="Copy Link">
            {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
            <span>{copied ? 'Copied!' : 'Copy Link'}</span>
          </button>
          {typeof navigator.share === 'function' && (
            <button
              className="action-btn glass flex-center"
              onClick={handleShare}
              title="Share Event"
            >
              <Share2 size={16} />
              <span>Share</span>
            </button>
          )}
        </div>
      </div>

      {/* Hero Header Card */}
      <div
        className="details-hero glass"
        style={{
          '--severity-color': color,
          backgroundImage: isUsgs ? "url('/image-usgs.jpg')" : "url('/image.png')",
          backgroundRepeat: 'repeat',
          color: '#ffffffff'

        } as React.CSSProperties}
      >
        <div className="hero-backdrop-glow" style={{ backgroundColor: `${color}15` }}></div>
        <div className="hero-content">
          <div className="hero-left">
            <span
              className="hero-subtitle text-muted"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "left",
                gap: "8px",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-activity"
                aria-hidden="true"
              >
                <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
              </svg>
              SEISMIC EVENT RECORDED
            </span>
            <h1 className="hero-title" style={{ color: '#ffffffff' }}>{earthquake.location}</h1>
            <span className="hero-subtitle text-muted">{earthquake.datetime}</span>
            <div className="coordinates-badge">
              <MapPin size={14} style={{ color }} />
              <span>{earthquake.latitude}°N, {earthquake.longitude}°E - {earthquake.depth} km depth</span>
            </div>
          </div>

          <div className="hero-right">
            <div className="magnitude-display" style={{ boxShadow: `0 0 30px ${color}30`, borderColor: color }}>
              <div className="mag-glow" style={{ background: `radial-gradient(circle, ${color}30 0%, transparent 70%)` }}></div>
              <span className="mag-num" style={{ color }}>{earthquake.magnitude}</span>
              <span className="mag-txt">MAGNITUDE</span>
            </div>
          </div>
        </div>

        {/* Dynamic Seismograph Animation */}
        <div className="seismograph-container">
          <svg
            className="seismograph-svg"
            viewBox="0 0 600 200"
            preserveAspectRatio="none"
            style={{
              overflow: 'visible',
              width: '100%',
              height: '100%',
            }}
          >
            {/* Baseline */}
            <path
              className="seismograph-line-static"
              d="M 0 100 L 600 100"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
              fill="none"
            />

            {/* Seismograph Wave */}
            <path
              className="seismograph-line"
              d={generateSeismographPath(mag)}
              stroke={color}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{
                animationDuration: `${Math.max(1, 4 - mag / 3)}s`,
              }}
            />
          </svg>
        </div>
        <div style={{ position: 'absolute', bottom: '20px', left: '5%', float: 'left', color: '#424242ff', fontSize: '12px' }}>Source data: PHIVOLCS</div>
      </div>

      {/* Tsunami status strip (from the reporting agency's bulletin text) */}
      {tsunamiInfo && (
        <div className={`tsunami-banner tsunami-banner--${tsunamiInfo.level}`} role="status">
          <Waves size={18} className="tsunami-banner-icon" />
          <div className="tsunami-banner-body">
            <strong>{tsunamiInfo.label}</strong>
            {details?.tsunami && <span>{details.tsunami}</span>}
          </div>
        </div>
      )}

      {/* Bulletin navigation across the earthquake sequence */}
      {bulletins.length > 1 && (
        <div className="details-card glass bulletin-nav">
          <div className="flex-between" style={{ marginBottom: '14px' }}>
            <h3 className="card-title" style={{ marginBottom: 0 }}>Information Bulletins</h3>
            <span className="text-muted" style={{ fontSize: '0.8rem' }}>{bulletins.length} released</span>
          </div>
          <div className="bulletin-chips">
            {bulletins.map((b) => (
              <button
                key={b.url}
                type="button"
                className={`bulletin-chip ${activeLink === b.url ? 'active' : ''}`}
                style={activeLink === b.url ? { background: color, borderColor: color, color: '#fff' } : undefined}
                onClick={() => handleSelectBulletin(b)}
              >
                No. {b.no}{b.final ? ' (Final)' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="details-grid">
        <div className="details-main-pane">


          {/* Combined Map View */}
          <div className="details-card glass map-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="flex-between" style={{ marginBottom: '24px' }}>
              <h3 className="card-title" style={{ marginBottom: 0 }}>Seismic Epicenter Location</h3>
              {details && details.mapUrl && (
                <div className="map-toggle-group" style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px' }}>
                  <button 
                    className={`map-toggle-btn ${mapView === 'interactive' ? 'active' : ''}`}
                    onClick={() => setMapView('interactive')}
                    style={{ 
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px',
                      background: mapView === 'interactive' ? color : 'transparent',
                      color: mapView === 'interactive' ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      transition: 'all 0.2s'
                    }}
                  >
                    <MapIcon size={14} /> Interactive
                  </button>
                  <button 
                    className={`map-toggle-btn ${mapView === 'official' ? 'active' : ''}`}
                    onClick={() => setMapView('official')}
                    style={{ 
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px',
                      background: mapView === 'official' ? color : 'transparent',
                      color: mapView === 'official' ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      transition: 'all 0.2s'
                    }}
                  >
                    <ImageIcon size={14} /> Official
                  </button>
                </div>
              )}
            </div>
            
            <div className="details-map-container" ref={mapContainerRef} style={{ flex: 1, minHeight: '380px' }}>
              {mapView === 'interactive' ? (
                !isNaN(lat) && !isNaN(lng) ? (
                  <MapContainer center={[lat, lng]} zoom={8} scrollWheelZoom={false} style={{ height: '100%', width: '100%', zIndex: 0 }}>
                    <TileLayer
                      attribution='&copy; OpenStreetMap &copy; CARTO'
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    <WMSTileLayer
                      url="https://gisweb.phivolcs.dost.gov.ph/arcgis/services/PHIVOLCSPublic/Trenches/MapServer/WMSServer"
                      layers="0"
                      format="image/png"
                      transparent={true}
                      version="1.3.0"
                      className="wms-trench-layer"
                    />
                    <ActiveFaultsLayer />
                    {(() => {
                      const pulseSize = Math.max(mag * 30, 50);
                      const coreSize = Math.max(mag * 4, 12);
                      return (
                        <Marker
                          position={[lat, lng]}
                          icon={L.divIcon({
                            className: 'details-pulse-marker',
                            html: `<div class="pulse-ring" style="--pulse-color: ${color}; width: ${pulseSize}px; height: ${pulseSize}px;"></div><div class="pulse-core" style="background-color: ${color}; width: ${coreSize}px; height: ${coreSize}px;"></div>`,
                            iconSize: [pulseSize, pulseSize],
                            iconAnchor: [pulseSize / 2, pulseSize / 2],
                          })}
                        />
                      );
                    })()}
                    <SeismicWaveLayer
                      lat={lat}
                      lng={lng}
                      magnitude={mag}
                      color={color}
                      containerRef={mapContainerRef}
                    />
                  </MapContainer>
                ) : (
                  <div className="flex-center" style={{ height: '100%' }}>Invalid Coordinates</div>
                )
              ) : (
                <div className="official-map-container flex-center" style={{ height: '100%', padding: '10px' }}>
                  <div className="official-map-wrapper" onClick={() => setIsImageModalOpen(true)}>
                    <img 
                      src={details?.mapUrl} 
                      alt={`Official map for earthquake in ${earthquake.location}`} 
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Richter Scale & Key Details */}
          <div className="details-card glass">
            <h3 className="card-title">Key Parameters</h3>
            <div className="info-grid">
              <div className="info-item glass-card">
                <Clock size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Date & Time (PST)</div>
                  <div className="info-value">{earthquake.datetime}</div>
                  {occurredAgo && <div className="info-subvalue">{occurredAgo}</div>}
                </div>
              </div>
              <div className="info-item glass-card">
                <Activity size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Depth of Focus</div>
                  <div className="info-value">{earthquake.depth} km</div>
                </div>
              </div>
              <div className="info-item glass-card">
                <Zap size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Energy Equivalent</div>
                  <div className="info-value">{calculateEnergy(mag)}</div>
                </div>
              </div>
              <div className="info-item glass-card">
                <Info size={20} className="info-icon" style={{ color }} />
                <div>
                  <div className="info-label">Reporting Agency</div>
                  <div className="info-value">{reportingAgency}</div>
                </div>
              </div>
              {bulletin && (
                <div className="info-item glass-card" style={{ gridColumn: 'span 2' }}>
                  <Info size={20} className="info-icon" style={{ color }} />
                  <div>
                    <div className="info-label">Information Bulletin</div>
                    <div className="info-value">No. {bulletin.no}{bulletin.final ? ' (Final)' : ''}</div>
                  </div>
                </div>
              )}
              {detailsLoading ? (
                <div className="info-item glass-card flex-center" style={{ gridColumn: 'span 2', minHeight: '60px' }}>
                  <div className="pulse-loader" style={{ width: '20px', height: '20px', borderColor: color, borderWidth: '2px' }}></div>
                </div>
              ) : details && details.origin && (
                <div className="info-item glass-card" style={{ gridColumn: 'span 2' }}>
                  <Info size={20} className="info-icon" style={{ color }} />
                  <div>
                    <div className="info-label">Origin</div>
                    {details.origin.length < 80 ? (
                      <div className="info-value" style={{ textTransform: 'capitalize' }}>{details.origin.toLowerCase()}</div>
                    ) : (
                      <>
                        <div className="info-value" style={{ fontSize: '0.85rem', lineHeight: 1.5, fontWeight: 'normal' }}>
                          {originExpanded ? details.origin : `${truncateWords(details.origin, 30)}...`}
                        </div>
                        <button
                          onClick={() => setOriginExpanded(prev => !prev)}
                          style={{ background: 'none', border: 'none', padding: 0, color: '#60a5fa', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                        >
                          {originExpanded ? 'See less' : 'See more...'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Richter Scale Visualizer */}
            <div className="richter-visualizer">
              <div className="richter-labels flex-between">
                <span>Richter Scale</span>
                <span style={{ color, fontWeight: 700 }}>M{mag} - {severityLabel}</span>
              </div>
              <div className="richter-bar-container">
                <div className="richter-bar-bg"></div>
                <div className="richter-bar-fill" style={{ width: `${Math.min(mag * 10, 100)}%`, background: `linear-gradient(to right, #10b981 0%, ${color} 100%)` }}></div>
                <div className="richter-marker" style={{ left: `${Math.min(mag * 10, 100)}%`, backgroundColor: color, boxShadow: `0 0 12px ${color}` }}></div>
              </div>
              <div className="richter-ticks flex-between">
                <span>1.0</span>
                <span>3.0</span>
                <span>5.0</span>
                <span>7.0</span>
                <span>9.0+</span>
              </div>
            </div>
          </div>
        </div>



        <div className="details-sidebar-pane">
          {/* Impact assessment */}
          <div className="impact-card glass" style={{ borderTop: `4px solid ${color}` }}>
            <h3 className="card-title flex-center" style={{ gap: '8px', justifyContent: 'flex-start' }}>
              <ShieldAlert size={20} style={{ color }} />
              Impact Assessment
            </h3>
            <div className="impact-severity" style={{ color }}>{severityLabel}</div>
            <p className="impact-desc text-muted">
              {mag < 4 ? "Generally not felt by people, but recorded by local seismographs near the epicenter." :
                mag < 5 ? "Felt by many indoors, some outdoors. Shaking of indoor items and windows is common." :
                  mag < 6 ? "Felt by everyone. Slight damage to poorly constructed buildings; generally safe for modern structures." :
                    mag < 7 ? "Can cause moderate to severe damage to standard buildings and structures within the epicentral zone." :
                      "Major earthquake. High potential for severe damage, ground rupture, and risk to life over wider regions."}
            </p>

            <div className="pop-estimate flex-center glass-card" style={{ marginTop: '20px', padding: '14px', gap: '12px' }}>
              <Users size={20} className="text-muted" />
              <div style={{ flex: 1 }}>
                <div className="info-label">Potential Shaking Zone</div>
                <div className="info-value">{mag < 4.5 ? "Local Only" : mag < 6 ? "Regional Alert" : "Widespread"}</div>
              </div>
            </div>
          </div>

          {/* Nearest provinces/cities by epicenter distance */}
          {nearestProvinces.length > 0 && (
            <div className="details-card glass" style={{ marginTop: '20px' }}>
              <h3 className="card-title flex-center" style={{ gap: '8px', justifyContent: 'flex-start' }}>
                <Navigation size={20} style={{ color }} />
                Nearest Provinces
              </h3>
              <ul className="nearby-list">
                {nearestProvinces.map((p, idx) => (
                  <li key={p.name} className="nearby-item">
                    <span className="nearby-rank" style={{ color }}>{idx + 1}</span>
                    <span className="nearby-name">{p.name}</span>
                    <span className="nearby-distance">{p.km.toLocaleString()} km</span>
                    {p.km <= 50 ? (
                      <span className="nearby-flag nearby-flag--close">Within 50 km</span>
                    ) : p.km <= 150 ? (
                      <span className="nearby-flag nearby-flag--near">&lt;150 km</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Aftershock Tracker */}
          <AftershockTracker currentEarthquake={earthquake} />

          {/* Intensities from PHIVOLCS */}
          {detailsLoading ? (
             <div className="safety-card glass flex-center" style={{ marginTop: '20px', minHeight: '120px' }}>
               <div className="pulse-loader" style={{ width: '30px', height: '30px', borderColor: 'var(--color-minor)' }}></div>
             </div>
          ) : details && (details.reportedIntensities || details.instrumentalIntensities) ? (
            <div className="safety-card glass" style={{ marginTop: '20px' }}>
              <h3 className="card-title">Intensities</h3>
              {details.reportedIntensities && (
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ color: 'var(--color-minor)', marginBottom: '8px' }}>Reported</h4>
                  {renderIntensities(details.reportedIntensities)}
                </div>
              )}
              {details.instrumentalIntensities && (
                <div>
                  <h4 style={{ color: 'var(--color-minor)', marginBottom: '8px' }}>Instrumental</h4>
                  {renderIntensities(details.instrumentalIntensities)}
                </div>
              )}
              {details.note && (
                <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.85rem' }} className="text-muted">
                  {details.note}
                </div>
              )}
            </div>
          ) : null}

          {/* Safety Guidelines */}
          <div className="safety-card glass">
            <h3 className="card-title">Safety Protocol</h3>
            <div className="safety-timeline">
              <div className="safety-step">
                <div className="step-indicator">1</div>
                <div className="step-content">
                  <h4>Before Shaking</h4>
                  <p>Secure overhead shelves, heavy appliances, and emergency supplies.</p>
                </div>
              </div>
              <div className="safety-step">
                <div className="step-indicator">2</div>
                <div className="step-content">
                  <h4>During Shaking</h4>
                  <p><strong>DROP, COVER, and HOLD ON.</strong> Protect your head, stay clear of glass.</p>
                </div>
              </div>
              <div className="safety-step">
                <div className="step-indicator">3</div>
                <div className="step-content">
                  <h4>After Shaking</h4>
                  <p>Check for structural hazards, anticipate potential aftershocks, monitor official reports.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Community: star, like, comments */}
      {/* Community: star, like, comments. Keyed by the resolved event's
          canonical slug so every entry point (old link, Archive, Notifications)
          reads the same engagement bucket. */}
      {earthquake && (
        <CommunitySection key={earthquakeToEqId(earthquake)} eqId={earthquakeToEqId(earthquake)} earthquake={earthquake} />
      )}

      <ImageModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        imageUrl={details?.mapUrl}
        altText={`Official map for earthquake in ${earthquake.location}`}
      />
      </motion.div>

      {/* Revision toast: old link -> the reporting agency revised the event.
          Rendered outside the motion.div so position: fixed stays
          viewport-relative (a transformed ancestor would otherwise become its
          containing block). */}
      {revisionInfo && <RevisionToast key={id} info={revisionInfo} sourceName={getPreferredApi() === 'usgs' ? 'USGS' : 'PHIVOLCS'} />}
    </>
  );
}

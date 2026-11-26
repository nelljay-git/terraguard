import { useEffect, useState } from 'react';
import { GeoJSON } from 'react-leaflet';

export function ActiveFaultsLayer() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/assets/geojson/gem_active_faults_harmonized.geojson')
      .then(res => {
        // Optional dataset: when it isn't shipped, the dev server returns the
        // SPA's HTML fallback. Skip it instead of throwing a JSON parse error.
        if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
        return res.json();
      })
      .then(setData)
      .catch(() => { /* optional layer — ignore */ });
  }, []);

  if (!data) return null;

  return (
    <GeoJSON 
      data={data} 
      style={{
        color: '#ef4444',
        weight: 1,
        opacity: 0.6
      }}
    />
  );
}

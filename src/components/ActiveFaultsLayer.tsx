import { useEffect, useState } from 'react';
import { GeoJSON } from 'react-leaflet';

export function ActiveFaultsLayer() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/assets/geojson/gem_active_faults_harmonized.geojson')
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then(setData)
      .catch(err => console.error("Error loading active faults:", err));
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

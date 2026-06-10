export interface PhivolcsEarthquake {
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
}

export interface PhivolcsResponse {
  success: boolean;
  count: number;
  data: PhivolcsEarthquake[];
}

export async function fetchPhivolcsData(): Promise<PhivolcsResponse> {
  try {
    const res = await fetch('/api/phivolcs');
    if (!res.ok) throw new Error("Failed to fetch from proxy");
    
    const html = await res.text();
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    const rows = doc.querySelectorAll("table tr");
    const earthquakes: PhivolcsEarthquake[] = [];
    
    rows.forEach((row) => {
      const cols = row.querySelectorAll("td");
      // Header rows use <th> so cols.length will be 0. Data rows have >= 6 <td> elements.
      if (cols.length >= 6) {
        earthquakes.push({
          datetime: cols[0].textContent?.trim() || "",
          latitude: cols[1].textContent?.trim() || "",
          longitude: cols[2].textContent?.trim() || "",
          depth: cols[3].textContent?.trim() || "",
          magnitude: cols[4].textContent?.trim() || "",
          location: cols[5].textContent?.trim() || ""
        });
      }
    });

    return {
      success: true,
      count: earthquakes.length,
      data: earthquakes
    };
  } catch (error) {
    console.error("Error scraping PHIVOLCS:", error);
    throw error;
  }
}

export function getSignificantEarthquakes(data: PhivolcsEarthquake[]): PhivolcsEarthquake[] {
  return data.filter(eq => parseFloat(eq.magnitude) >= 4.5);
}

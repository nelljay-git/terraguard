// Feed fetchers for the push monitor. The normalized rows here MUST match
// src/api/phivolcs.ts::normalizeEarthquake byte-for-byte (datetime format,
// 2-decimal coordinates, 1-decimal magnitude), otherwise the /details/:id
// deep-link slug won't resolve in the app.

const UTC_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

function formatUtc(date) {
    const day = date.getUTCDate();
    const month = UTC_MONTHS[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(date.getUTCSeconds()).padStart(2, "0");
    return `${day} ${month} ${year} - ${hours}:${minutes}:${seconds} UTC`;
}

const round2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const round1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

export async function fetchUsgsRows() {
    const res = await fetch(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
        { headers: { "User-Agent": "TerraGuard-PushMonitor/1.0" } },
    );
    if (!res.ok) throw new Error(`USGS responded with ${res.status}`);
    const data = await res.json();
    return (data.features ?? []).map((f) => {
        const p = f.properties ?? {};
        const c = f.geometry?.coordinates ?? [];
        return {
            source: "usgs",
            datetime: formatUtc(new Date(p.time)),
            latitude: round2(c[1]),
            longitude: round2(c[0]),
            depth: String(Math.round(c[2])),
            magnitude: round1(p.mag),
            location: p.place ?? "",
            link: p.url ?? "",
        };
    });
}

export async function fetchEmscRows() {
    const res = await fetch(
        "https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=2000&orderby=time&minmag=1.0",
        { headers: { "User-Agent": "TerraGuard-PushMonitor/1.0" } },
    );
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`EMSC responded with ${res.status}`);
    const data = await res.json();
    return (data.features ?? []).map((f) => {
        const p = f.properties ?? {};
        return {
            source: "emsc",
            datetime: formatUtc(new Date(p.time)),
            latitude: round2(p.lat),
            longitude: round2(p.lon),
            depth: String(Math.round(p.depth)),
            magnitude: round1(p.mag),
            location: p.flynn_region ?? "",
            link: `https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${p.source_id}`,
        };
    });
}

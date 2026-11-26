// PHIVOLCS live-index scraper (push monitor).
//
// Regex parser mirroring functions/api/phivolcs.ts:extractEarthquakes —
// same row/cell regexes, first <tr> skipped, >=6 cells required, and the
// first cell's <a href> becomes `link`. Used by the push monitor to fetch
// the same event feed the app reads.

const USER_AGENT = "TerraGuard-PushMonitor/1.0 (alerts; contact: Terra Guard PH)";

export async function fetchPhivolcsIndex() {
    const res = await fetch("https://earthquake.phivolcs.dost.gov.ph/", {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
    });
    if (!res.ok) throw new Error(`PHIVOLCS index responded with ${res.status}`);
    return await res.text();
}

export function extractPhivolcsRows(html) {
    const rows = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let rowIndex = 0;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        if (rowIndex++ === 0) continue;
        const rowHtml = rowMatch[1];
        const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let link = "";
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
            const cellHtml = cellMatch[1];
            if (cells.length === 0) {
                const linkMatch = /href=(?:'|")([^'"]+)(?:'|")/i.exec(cellHtml);
                if (linkMatch) link = linkMatch[1];
            }
            const value = cellHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            cells.push(value);
        }

        if (cells.length >= 6) {
            if (link && !link.startsWith("http")) {
                link = new URL(link, "https://earthquake.phivolcs.dost.gov.ph/").href;
            }
            rows.push({
                datetime: cells[0] || "",
                latitude: cells[1] || "",
                longitude: cells[2] || "",
                depth: cells[3] || "",
                magnitude: cells[4] || "",
                location: cells[5] || "",
                link,
            });
        }
    }
    return rows;
}

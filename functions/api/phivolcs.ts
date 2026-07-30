export async function onRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';

  const targetUrl = path
    ? `https://earthquake.phivolcs.dost.gov.ph/${path}`
    : 'https://earthquake.phivolcs.dost.gov.ph/';

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `PHIVOLCS responded with ${response.status}`, status: response.status }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const html = await response.text();
    const earthquakes = extractEarthquakes(html);

    return new Response(
      JSON.stringify({ success: true, count: earthquakes.length, data: earthquakes }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }
    );
  }
}

function extractEarthquakes(html: string): Array<{
  datetime: string;
  latitude: string;
  longitude: string;
  depth: string;
  magnitude: string;
  location: string;
  link: string;
}> {
  const earthquakes: Array<{
    datetime: string;
    latitude: string;
    longitude: string;
    depth: string;
    magnitude: string;
    location: string;
    link: string;
  }> = [];

  const rows = html.split('<tr');

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split('<td');
    if (cells.length < 7) continue;

    const cellValues = cells.slice(1, 7).map((cell) => {
      const text = cell.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      return text;
    });

    let link = '';
    const linkMatch = cells[1].match(/href=(?:'|")([^'"]+)(?:'|")/i);
    if (linkMatch) {
      link = linkMatch[1];
      if (link && !link.startsWith('http')) {
        link = link.replace(/\\/g, '/');
        link = new URL(link, 'https://earthquake.phivolcs.dost.gov.ph/').href;
      }
    }

    earthquakes.push({
      datetime: cellValues[0],
      latitude: cellValues[1],
      longitude: cellValues[2],
      depth: cellValues[3],
      magnitude: cellValues[4],
      location: cellValues[5],
      link: link,
    });
  }

  return earthquakes;
}
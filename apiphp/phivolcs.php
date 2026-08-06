<?php
/**
 * phivolcs.php  — exact PHP port of api/phivolcs.ts (the PHIVOLCS scraper).
 *
 * Mirrors, precisely:
 *  - extractEarthquakes(): same row/cell regexes; first <tr> skipped as header;
 *    >= 6 cells required; first cell's <a href> becomes `link`; relative links
 *    normalized against the base built from ?path=.
 *  - The 60-second in-memory cache (here file-backed, since PHP has no
 *    cross-request memory), keyed per path (live = '__live__', archives per path).
 *  - Stale-fallback: on scrape failure, return the cached entry if any
 *    (even if stale) instead of an error.
 *  - Identical JSON shape: { success, count, data, error? }
 *
 * Run:  php -S localhost:8080 apiphp/   then  GET http://localhost:8080/phivolcs.php
 *       (add ?path=2026_Earthquake_Information/July/2026_0701_0004_B1.html for a single event)
 */

// --- Error handling: surface failures as JSON, never a blank page ---
// On hosts where display_errors is off (typical), an uncaught Error fatal-errors
// the script and returns nothing. This converts fatal/throwable errors into a
// JSON error response so clients always get a structured body.
error_reporting(E_ALL);

/** Emit JSON without crashing if headers were already sent (used by the shutdown
 *  handler, which may fire after partial output). */
function emitJsonSafe(array $payload, int $status, string $cacheControl): void {
    if (!headers_sent()) {
        header('Content-Type: application/json');
        header('Cache-Control: ' . $cacheControl);
        http_response_code($status);
    }
    echo json_encode($payload);
}

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err !== null && in_array((int)$err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR])) {
        emitJsonSafe(['success' => false, 'count' => 0, 'data' => [], 'error' => $err['message']], 500, 'no-store');
    }
});

// --- Configuration (mirrors CACHE_TTL_MS) ---
define('CACHE_TTL_MS', 60 * 1000);
define('PHIVOLCS_BASE', 'https://earthquake.phivolcs.dost.gov.ph');
define('CACHE_DIR', sys_get_temp_dir() . '/phivolcs_cache');
if (!is_dir(CACHE_DIR)) { @mkdir(CACHE_DIR, 0777, true); }

// Headers (mirrors the handler prelude)
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: ' . ($_SERVER['REQUEST_METHOD'] === 'OPTIONS' ? 'GET, OPTIONS' : 'GET'));
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'Method not allowed'], 405, 'no-store');
    exit;
}

// --- Query parsing ---
// Robust input handling: when a caller passes ?url=<full URL> unencoded, PHP's
// query-string parser may split the value on '/' into a nested array. We read
// $_GET first (encoded values arrive as clean strings), then fall back to
// parse_str on the raw query string so an unencoded ?url=https://... is still
// recovered. This keeps the endpoint tolerant of both forms.
$pathQuery = '';
if (isset($_GET['path']) && is_string($_GET['path'])) {
    $pathQuery = $_GET['path'];
}
$detailUrl = '';
if (isset($_GET['url']) && is_string($_GET['url'])) {
    $detailUrl = $_GET['url'];
} elseif (isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== '') {
    $parsed = array();
    parse_str($_SERVER['QUERY_STRING'], $parsed);
    if (isset($parsed['url']) && is_string($parsed['url'])) {
        $detailUrl = $parsed['url'];
    }
}
$isDetail = false;
if (isset($_GET['detail'])) {
    $detailVal = is_array($_GET['detail']) ? '' : $_GET['detail'];
    $isDetail = ($detailVal === '1' || $detailVal === 'true');
}
$cacheKey = $detailUrl !== '' ? $detailUrl : ($pathQuery !== '' ? $pathQuery : '__live__');

// --- Step 1: fresh in-memory (file-backed) cache -> serve immediately ---
$cached = getCached($cacheKey);
if ($cached !== null) {
    emitJson($cached, 200, 's-maxage=60, stale-while-revalidate');
    exit;
}

// --- Step 2: scrape PHIVOLCS (mirrors fetch(..., { headers: { User-Agent } })) ---
// Returns { ok, body, error } so a non-2xx produces the same error string the
// TS handler throws: "PHIVOLCS responded with <status>".

// NEW: detail mode — handle BEFORE any other fetch, so we don't fetch the
// homepage unnecessarily (the app passes the full detail URL via ?url=).
if ($isDetail && $detailUrl !== '') {
    $detailScrape = fetchPhivolcsPage($detailUrl);
    if (!$detailScrape['ok']) {
        $stale = getCachedAny($cacheKey);
        if ($stale !== null) {
            emitJson($stale, 200, 's-maxage=60, stale-while-revalidate');
            exit;
        }
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => $detailScrape['error']], 200, 'no-store');
        exit;
    }
    $details = null;
    try {
        $details = extractDetails($detailScrape['body'], $detailUrl);
    } catch (Throwable $e) {
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'extractDetails: ' . $e->getMessage()], 500, 'no-store');
        exit;
    }
    $payload = ['success' => true, 'count' => 1, 'data' => $details];
    // No caching for detail responses to avoid serving stale details; TTL = 0.
    emitJson($payload, 200, 'no-store');
    exit;
}

$targetUrl = $pathQuery !== ''
    ? PHIVOLCS_BASE . '/' . $pathQuery
    : PHIVOLCS_BASE . '/';

$scrape = fetchPhivolcsPage($targetUrl); // mirror of await fetch(...).text() (throws on !ok)

if (!$scrape['ok']) {
    // Step 3: scrape failed -> return stale cache (even if stale) if present,
    // exactly like the TS handler's catch block.
    $stale = getCachedAny($cacheKey);
    if ($stale !== null) {
        emitJson($stale, 200, 's-maxage=60, stale-while-revalidate');
        exit;
    }
    emitJson(
        ['success' => false, 'count' => 0, 'data' => [], 'error' => $scrape['error']],
        200,
        'no-store'
    );
    exit;
}

$html = $scrape['body'];

$earthquakes = extractEarthquakes($html, $pathQuery);

$payload = [
    'success' => true,
    'count' => count($earthquakes),
    'data' => $earthquakes,
];

// Refresh the cache (mirrors responseCache.set(cacheKey, { timestamp, payload }))
setCached($cacheKey, $payload);

emitJson($payload, 200, 's-maxage=60, stale-while-revalidate');

/**
 * Emit a JSON response (mirrors res.setHeader('Cache-Control', ...); res.status(...).json(...)).
 */
function emitJson(array $payload, int $status, string $cacheControl): void {
    header('Content-Type: application/json');
    header('Cache-Control: ' . $cacheControl);
    http_response_code($status);
    echo json_encode($payload);
}

/**
 * Return a fresh (< CACHE_TTL_MS) cached payload, or null if missing/stale.
 * Mirrors: cached && Date.now() - cached.timestamp < CACHE_TTL_MS
 *
 * Stored file shape: { "timestamp": <ms>, "payload": <array> }
 */
function getCached(string $key): ?array {
    $entry = readCacheFile($key);
    if ($entry === null) return null;
    if (msNow() - (int)$entry['timestamp'] >= CACHE_TTL_MS) return null;
    return $entry['payload'];
}

/**
 * Return ANY cached payload regardless of age (mirrors the stale fallback that
 * reads responseCache.get(cacheKey) even if stale).
 */
function getCachedAny(string $key): ?array {
    $entry = readCacheFile($key);
    if ($entry === null) return null;
    return $entry['payload'];
}

function readCacheFile(string $key): ?array {
    $file = cacheFile($key);
    if (!is_file($file)) return null;
    $raw = @file_get_contents($file);
    if ($raw === false) return null;
    $entry = json_decode($raw, true);
    if (!is_array($entry) || !isset($entry['timestamp'], $entry['payload'])) return null;
    return $entry;
}

function setCached(string $key, array $payload): void {
    $entry = ['timestamp' => msNow(), 'payload' => $payload];
    @file_put_contents(cacheFile($key), json_encode($entry));
}

function cacheFile(string $key): string {
    $safe = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $key);
    return CACHE_DIR . '/' . $safe . '.json';
}

function msNow(): int {
    return (int)round(microtime(true) * 1000);
}

/**
 * mirror of: await fetch(targetUrl, { headers: { 'User-Agent': ... } }).text()
 * Returns ['ok'=>bool,'body'=>?string,'error'=>string]. On 2xx this is the body
 * (like await res.text()). On non-2xx/network failure it mirrors !response.ok
 * (which the TS handler turns into a thrown Error).
 */
function fetchPhivolcsPage(string $targetUrl): array {
    $ch = curl_init($targetUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // mirrors process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch);
    curl_close($ch);

    if ($body === false || $err) {
        return ['ok' => false, 'body' => null, 'error' => 'Unable to reach PHIVOLCS'];
    }
    if ($code >= 400) {
        // Mirrors: throw new Error(`PHIVOLCS responded with ${response.status}`)
        return ['ok' => false, 'body' => null, 'error' => 'PHIVOLCS responded with ' . $code];
    }
    return ['ok' => true, 'body' => (string)$body, 'error' => ''];
}

/**
 * EXACT replica of extractEarthquakes(html, req) from api/phivolcs.ts.
 *   const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
 *   const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi
 *   linkMatch = /href=(?:'|")([^'"]+)(?:'|")/i
 *   value = cellHtml.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
 */
function extractEarthquakes(string $html, string $pathQuery): array {
    $earthquakes = [];
    $rowRegex = '/<tr\b[^>]*>([\s\S]*?)<\/tr>/i';
    $cellRegex = '/<td\b[^>]*>([\s\S]*?)<\/td>/i';
    $linkRegex = '/href=(?:\'|")([^\'"]+)(?:\'|")/i';
    $tagRegex = '/<[^>]+>/';
    $wsRegex = '/\s+/';

    $rowMatches = [];
    if (preg_match_all($rowRegex, $html, $rowMatches, PREG_SET_ORDER) === false) {
        return $earthquakes;
    }

    $rowIndex = 0;
    foreach ($rowMatches as $rowMatch) {
        if ($rowIndex === 0) { $rowIndex++; continue; }   // first <tr> is the header -> skip
        $rowIndex++;

        $rowHtml = $rowMatch[1];
        $cells = [];
        $link = '';

        $cellMatches = [];
        preg_match_all($cellRegex, $rowHtml, $cellMatches, PREG_SET_ORDER);
        foreach ($cellMatches as $cellMatch) {
            $cellHtml = $cellMatch[1];

            if (count($cells) === 0) {
                // const linkMatch = /href=(?:'|")([^'"]+)(?:'|")/i.exec(cellHtml)
                if (preg_match($linkRegex, $cellHtml, $linkMatch)) {
                    $link = $linkMatch[1];
                }
            }

            // .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            $value = preg_replace($tagRegex, ' ', $cellHtml);
            $value = preg_replace($wsRegex, ' ', $value);
            $value = trim($value);
            $cells[] = $value;
        }

        // if (cells.length >= 6) {
        if (count($cells) >= 6) {
            // if (link && !link.startsWith('http')) {   // startsWith is case-sensitive
            if ($link !== '' && strpos($link, 'http') !== 0) {
                $link = str_replace('\\', '/', $link); // link.replace(/\\/g, '/')

                // const baseUrl = pathQuery ? `.../${pathQuery}` : 'https://.../'
                $baseUrl = $pathQuery !== ''
                    ? PHIVOLCS_BASE . '/' . $pathQuery
                    : PHIVOLCS_BASE . '/';

                // link = new URL(link, baseUrl).href   (resolve relative against base)
                $resolved = resolveUrl($link, $baseUrl);
                if ($resolved !== null) {
                    $link = $resolved;
                } else {
                    $link = $baseUrl . $link; // fallback: baseUrl + link
                }
            }

            $earthquakes[] = [
                'datetime'   => $cells[0] ?? '',
                'latitude'    => $cells[1] ?? '',
                'longitude'   => $cells[2] ?? '',
                'depth'       => $cells[3] ?? '',
                'magnitude'   => $cells[4] ?? '',
                'location'    => $cells[5] ?? '',
                'link'        => $link,
            ];
        }
    }

    return $earthquakes;
}

/**
 * Resolve a (possibly relative) URL against a base, mirroring `new URL(link, baseUrl).href`.
 * Returns the normalized absolute URL string, or null if it can't be resolved
 * (-> caller does baseUrl + link, exactly like the TS try/catch).
 */
function resolveUrl(string $input, string $base): ?string {
    // absolute (scheme://...)
    if (preg_match('#^[a-z][a-z0-9+.\-]*://#i', $input)) {
        return normalizeAbsolute($input);
    }

    $baseParts = parse_url($base);
    if ($baseParts === false || !isset($baseParts['scheme'], $baseParts['host'])) {
        return null;
    }
    $schemeHost = $baseParts['scheme'] . '://' . $baseParts['host']
        . (isset($baseParts['port']) ? ':' . $baseParts['port'] : '');

    // absolute-path reference: /foo  -> scheme+host + /foo
    if (strlen($input) > 0 && $input[0] === '/') {
        return $schemeHost . $input;
    }

    // path-relative reference: resolve against base's directory
    $basePath = isset($baseParts['path']) ? $baseParts['path'] : '/';
    if ($basePath === '' ) {
        $dir = '/';
    } elseif (substr($basePath, -1) === '/') {
        $dir = $basePath;                 // ends with '/', keep as dir
    } else {
        $dir = dirname($basePath) . '/';  // strip last segment, keep dir
    }
    // dirname('/') === '/'; paths ending in '/' are handled by the elseif above
    // (so dirname is only reached for paths with a final segment). '.' is guarded.
    if ($dir === '.') $dir = '/';

    return $schemeHost . $dir . $input;
}

function normalizeAbsolute(string $url): string {
    $p = parse_url($url);
    if ($p === false || !isset($p['scheme'], $p['host'])) return $url;
    $out = $p['scheme'] . '://' . $p['host'];
    if (isset($p['port'])) $out .= ':' . $p['port'];
    $out .= ($p['path'] ?? '/');
    if (isset($p['query'])) $out .= '?' . $p['query'];
    if (isset($p['fragment'])) $out .= '#' . $p['fragment'];
    return $out;
}

/**
 * PHP port of parseDetailsHtml() from src/api/phivolcs.ts.
 * Returns { origin, reportedIntensities, instrumentalIntensities, note, mapUrl }
 */
function extractDetails(string $html, string $detailUrl): array {
    // Mirrors: const cleanText = html.replace(/&nbsp;/g, ' ')
    //     .replace(/<[^>]+>/g, ' ')
    //     .replace(/\s+/g, ' ')
    //     .trim();
    $cleanText = preg_replace('/&nbsp;/i', ' ', $html);
    $cleanText = preg_replace('/<[^>]+>/', ' ', $cleanText);
    $cleanText = preg_replace('/\s+/', ' ', $cleanText);
    $cleanText = trim($cleanText);

    // Origin extraction: const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
    $origin = 'Unknown';
    $originMatch = null;
    if (preg_match('/Origin\s*:\s*(.*?)\s*Magnitude/i', $cleanText, $originMatch)) {
        $origin = trim($originMatch[1] ?? '');
    }

    // Reported Intensities
    $reported = '';
    $reportedMatch = null;
    $reportedPattern = '/Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i';
    if (preg_match($reportedPattern, $cleanText, $reportedMatch)) {
        $reported = trim($reportedMatch[1] ?? '');
    }

    // Instrumental Intensities: const instrumentalMatch = /Instrumental Intensities\s*:?\s*(.*?)(?:This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
    $instrumental = '';
    $instrumentalMatch = null;
    $instrumentalPattern = '/Instrumental Intensities\s*:?\s*(.*?)(?:This is an aftershock|Expecting Damage|$)/i';
    if (preg_match($instrumentalPattern, $cleanText, $instrumentalMatch)) {
        $instrumental = trim($instrumentalMatch[1] ?? '');
    }

    // Note: const noteMatch = /(This is an aftershock.*?)(?:Expecting Damage|$)/i.exec(cleanText);
    $note = '';
    $noteMatch = null;
    $notePattern = '/(This is an aftershock.*?)(?:Expecting Damage|$)/i';
    if (preg_match($notePattern, $cleanText, $noteMatch)) {
        $note = trim($noteMatch[1] ?? '');
    }

    // Map URL: const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    $mapUrl = '';
    $imgRegex = '/<img[^>]+src=["\']([^"\']+)["\']/i';
    $matches = [];
    if (preg_match_all($imgRegex, $html, $matches)) {
        foreach ($matches[1] as $src) {
            $src = trim($src);
            $lowerSrc = strtolower($src);
            if (strpos($lowerSrc, 'logo') === false && strpos($lowerSrc, 'header') === false) {
                $mapUrl = $src;
                break;
            }
        }
    }

    if ($mapUrl !== '' && strpos($mapUrl, 'http') !== 0) {
        $parsedDetailUrl = parse_url($detailUrl);
        if ($parsedDetailUrl !== false && isset($parsedDetailUrl['scheme'], $parsedDetailUrl['host'])) {
            $base = $parsedDetailUrl['scheme'] . '://' . $parsedDetailUrl['host'];
            if (isset($parsedDetailUrl['path'])) {
                $dir = dirname($parsedDetailUrl['path']);
                if ($dir === '.') $dir = '';
                $mapUrl = $base . ($dir !== '' ? $dir . '/' : '/') . $mapUrl;
            } else {
                $mapUrl = $base . '/' . $mapUrl;
            }
        }
    }

    return [
        'origin' => $origin,
        'reportedIntensities' => $reported,
        'instrumentalIntensities' => $instrumental,
        'note' => $note,
        'mapUrl' => $mapUrl,
    ];
}

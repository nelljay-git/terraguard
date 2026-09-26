<?php
/**
 * tsunami.php — PHIVOLCS tsunami bulletin scraper API (sister file to phivolcs.php / pagasa.php / volcano.php).
 *
 * PHIVOLCS publishes no public tsunami API, so this scrapes the official
 * PHIVOLCS-TSUNAMI site and serves it as clean JSON:
 *
 *   ?page=events            https://tsunami.phivolcs.dost.gov.ph/
 *                             (current-year event table, #table_events)
 *   ?page=archive&year=2023 https://tsunami.phivolcs.dost.gov.ph/tsunamiLatest_yearly/2023/tsunami_latest.html
 *                             (per-year archive; only 2020-2023 use the same #table_events
 *                              layout — 2010-2019 are legacy flat-HTML/JS pages, not parsed)
 *   detail: GET tsunami.php?detail=1&url=<full advisory url>
 *     -> { success, count:1, data:{ number, headline, threat, occurredAtUtc,
 *                                  issuedAt, issuedBy, latitude, longitude,
 *                                  depth, magnitude, location, evaluation,
 *                                  recommendedAction, important } }
 *
 * Conventions mirror pagasa.php / volcano.php: file-backed cache per page
 * (10 min TTL — tsunami bulletins are rare), stale-fallback on scrape failure,
 * CORS *, GET-only, JSON errors never blank pages.
 *
 * Requirements: PHP 8+ with cURL, DOM (libxml), mbstring.
 *
 * Run: php -S localhost:8080 apiphp/ then GET http://localhost:8080/tsunami.php?page=events
 */

error_reporting(E_ALL);

function emitJsonSafe(array $payload, int $status, string $cacheControl): void {
    if (!headers_sent()) {
        header('Content-Type: application/json');
        header('Cache-Control: ' . $cacheControl);
        http_response_code($status);
    }
    echo json_encode(withCacheStatus($payload), JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
}

/**
 * Attach cache diagnostics to a payload. Makes a dead cache visible instead of
 * silent: check `"cache": {"state":"miss","enabled":false}` to spot a host where
 * no writable cache directory was found, which means every call re-scrapes
 * PHIVOLCS.
 */
function withCacheStatus(array $payload): array {
    $dir = tsunamiCacheDir();
    $payload['cache'] = [
        'state' => cacheState(),
        'enabled' => $dir !== '',
        'dir' => $dir,
        'ttlMs' => CACHE_TTL_MS,
    ];
    return $payload;
}

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err !== null && in_array((int)$err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR])) {
        emitJsonSafe(['success' => false, 'count' => 0, 'data' => [], 'error' => $err['message']], 500, 'no-store');
    }
});

define('CACHE_TTL_MS', 10 * 60 * 1000); // tsunami bulletins are rare — cache 10 min like pagasa.php
define('TSUNAMI_UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
define('TSUNAMI_FETCH_TIMEOUT', 10);
define('TSUNAMI_ORIGIN', 'https://tsunami.phivolcs.dost.gov.ph');
define('TSUNAMI_INDEX', TSUNAMI_ORIGIN . '/');
define('TSUNAMI_ARCHIVE_FIRST_YEAR', 2020);
define('TSUNAMI_ARCHIVE_LAST_YEAR', 2023); // PHIVOLCS has not published 2024+ archives yet

/**
 * Pick a cache directory that is actually writable, and prove it before use.
 *
 * The obvious sys_get_temp_dir() is unwritable on plenty of shared hosts
 * (open_basedir, read-only /tmp, no permission to mkdir). The old code silenced
 * those failures with @mkdir / @file_put_contents, so a dead cache was invisible:
 * the endpoint kept working but silently re-scraped PHIVOLCS on every single
 * request. This walks a candidate list, write-probes each one, and reports which
 * directory was chosen (or that caching is off) in every response.
 */
function tsunamiCacheDir(): string {
    static $resolved = null;
    if ($resolved !== null) return $resolved;
    $candidates = [];
    $tmp = sys_get_temp_dir();
    if (is_string($tmp) && $tmp !== '') $candidates[] = rtrim($tmp, '/\\') . DIRECTORY_SEPARATOR . 'tsunami_cache';
    $envTmp = getenv('TMPDIR');
    if (is_string($envTmp) && $envTmp !== '') $candidates[] = rtrim($envTmp, '/\\') . DIRECTORY_SEPARATOR . 'tsunami_cache';
    // Fallbacks for hosts with a locked-down temp dir. Kept out of the way, and
    // dot-prefixed so it is not picked up by directory listings.
    $candidates[] = __DIR__ . DIRECTORY_SEPARATOR . '.tsunami_cache';
    $home = getenv('HOME');
    if (is_string($home) && $home !== '') $candidates[] = rtrim($home, '/\\') . DIRECTORY_SEPARATOR . '.tsunami_cache';

    foreach ($candidates as $dir) {
        if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) continue;
        // Prove writability rather than assuming it.
        $probe = $dir . '/.probe-' . getmypid();
        if (@file_put_contents($probe, 'x') === false) continue;
        @unlink($probe);
        // If we had to fall back inside the web root, block direct HTTP access to
        // the cached JSON (Apache/LiteSpeed honour this).
        if (strpos($dir, __DIR__) === 0) {
            @file_put_contents($dir . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
            @file_put_contents($dir . '/index.html', '');
        }
        $resolved = $dir;
        return $resolved;
    }
    // Nothing writable: run uncached rather than fail.
    $resolved = '';
    return $resolved;
}

// How the payload being emitted was obtained: 'fresh' (served from a cache entry
// inside the TTL), 'stale' (upstream failed, fell back to an expired entry) or
// 'miss' (fetched live). Reported in every response so cache health is visible.
function cacheState(): string { return cacheFlag('get'); }
function markCacheState(string $state): void { cacheFlag('set', $state); }
function cacheFlag(string $mode, string $v = ''): string {
    static $state = 'miss';
    if ($mode === 'set') $state = $v;
    return $state;
}


header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: ' . ($_SERVER['REQUEST_METHOD'] === 'OPTIONS' ? 'GET, OPTIONS' : 'GET'));
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'Method not allowed'], 405, 'no-store'); exit; }

$page = 'events';
if (isset($_GET['page']) && is_string($_GET['page']) && $_GET['page'] !== '') $page = strtolower(trim($_GET['page']));
// Accept the same aliases the sibling scrapers use.
if ($page === 'list' || $page === 'hub' || $page === 'current') $page = 'events';
if ($page === 'year' || $page === 'archive') $page = 'archive';

$year = isset($_GET['year']) && is_string($_GET['year']) ? (int)trim($_GET['year']) : 0;

$detailUrl = '';
if (isset($_GET['url']) && is_string($_GET['url'])) $detailUrl = trim($_GET['url']);
elseif (isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== '') {
    $parsed = []; parse_str($_SERVER['QUERY_STRING'], $parsed);
    if (isset($parsed['url']) && is_string($parsed['url'])) $detailUrl = trim($parsed['url']);
}
$isDetail = false;
if (isset($_GET['detail'])) {
    $detailVal = is_array($_GET['detail']) ? '' : $_GET['detail'];
    $isDetail = ($detailVal === '1' || $detailVal === 'true');
}

if ($isDetail && $detailUrl !== '') {
    // Only ever fetch from the PHIVOLCS tsunami host, so this endpoint can't be
    // abused as an open proxy for arbitrary URLs.
    if (!isTsunamiUrl($detailUrl)) {
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'URL must be on ' . TSUNAMI_ORIGIN], 400, 'no-store'); exit;
    }
    $cacheKey = 'detail:' . $detailUrl;
    $cached = getCached($cacheKey);
    if ($cached !== null) { emitJson($cached, 200, 'no-store'); exit; }
    $scrape = fetchTsunamiPage($detailUrl);
    if (!$scrape['ok']) {
        $stale = getCachedAny($cacheKey);
        if ($stale !== null) { emitJson($stale, 200, 'no-store'); exit; }
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => $scrape['error']], 200, 'no-store'); exit;
    }
    // Advisory archives are mostly .html, but a few rows link a .pdf instead.
    if (isPdfUrl($detailUrl)) {
        $payload = [
            'success' => true,
            'count' => 1,
            'data' => [
                'number' => advisoryNumberFromUrl($detailUrl),
                'headline' => '',
                'threat' => '',
                'occurredAtUtc' => occurredAtFromUrl($detailUrl),
                'issuedAt' => '',
                'issuedBy' => '',
                'latitude' => null,
                'longitude' => null,
                'depth' => null,
                'magnitude' => null,
                'location' => '',
                'evaluation' => '',
                'recommendedAction' => '',
                'important' => '',
                'url' => $detailUrl,
                'isPdf' => true,
                'note' => 'Advisory is published as a PDF; no text to parse.',
            ],
        ];
        setCached($cacheKey, $payload);
        emitJson($payload, 200, 'no-store'); exit;
    }
    try { $detail = extractAdvisory($scrape['body'], $detailUrl); }
    catch (Throwable $e) {
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'extractAdvisory: ' . $e->getMessage()], 500, 'no-store'); exit;
    }
    $payload = ['success' => true, 'count' => 1, 'data' => $detail];
    setCached($cacheKey, $payload);
    emitJson($payload, 200, 'no-store'); exit;
}

if ($page === 'archive') {
    if ($year < TSUNAMI_ARCHIVE_FIRST_YEAR || $year > TSUNAMI_ARCHIVE_LAST_YEAR) {
        emitJson([
            'success' => false, 'count' => 0, 'data' => [],
            'error' => 'year must be between ' . TSUNAMI_ARCHIVE_FIRST_YEAR . ' and ' . TSUNAMI_ARCHIVE_LAST_YEAR
                . '. Use page=events for the current year. Note: PHIVOLCS only renders the #table_events'
                . ' layout from ' . TSUNAMI_ARCHIVE_FIRST_YEAR . ' onward; 2010-2019 use legacy/JS layouts that this'
                . ' scraper does not parse yet.',
        ], 400, 'no-store'); exit;
    }
    $source = TSUNAMI_ORIGIN . '/tsunamiLatest_yearly/' . $year . '/tsunami_latest.html';
} elseif ($page === 'events') {
    $source = TSUNAMI_INDEX;
} else {
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'Unknown page. Valid: events, archive'], 400, 'no-store'); exit;
}

$cacheKey = 'page:' . $page . ($page === 'archive' ? ':' . $year : '');
$cached = getCached($cacheKey);
if ($cached !== null) { emitJson($cached, 200, 'no-store'); exit; }
$scrape = fetchTsunamiPage($source);
if (!$scrape['ok']) {
    $stale = getCachedAny($cacheKey);
    if ($stale !== null) { emitJson($stale, 200, 'no-store'); exit; }
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => $scrape['error']], 200, 'no-store'); exit;
}
try { $items = extractEvents($scrape['body'], $source); }
catch (Throwable $e) {
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'extractEvents: ' . $e->getMessage()], 500, 'no-store'); exit;
}
$payload = [
    'success' => true,
    'page' => $page,
    'year' => $page === 'archive' ? $year : null,
    'source' => $source,
    'count' => count($items),
    'data' => $items,
];
setCached($cacheKey, $payload);
emitJson($payload, 200, 'no-store');

function emitJson(array $payload, int $status, string $cacheControl): void {
    header('Content-Type: application/json');
    header('Cache-Control: ' . $cacheControl);
    http_response_code($status);
    // PRESERVE_ZERO_FRACTION so a 7.0 magnitude stays 7.0 in JSON instead of
    // collapsing to 7, which would change its type for JS consumers.
    echo json_encode(withCacheStatus($payload), JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
}
function getCached(string $key): ?array {
    $entry = readCacheFile($key);
    if ($entry === null) return null;
    if (msNow() - (int)$entry['timestamp'] >= CACHE_TTL_MS) return null;
    markCacheState('fresh');
    return $entry['payload'];
}
function getCachedAny(string $key): ?array {
    $entry = readCacheFile($key);
    if ($entry === null) return null;
    markCacheState('stale');
    return $entry['payload'];
}
function readCacheFile(string $key): ?array {
    $file = cacheFile($key);
    if ($file === '' || !is_file($file)) return null;
    $raw = @file_get_contents($file);
    if ($raw === false) return null;
    $entry = json_decode($raw, true);
    if (!is_array($entry) || !isset($entry['timestamp'], $entry['payload'])) return null;
    return $entry;
}
function setCached(string $key, array $payload): void {
    $file = cacheFile($key);
    if ($file === '') return; // no writable cache dir — serve uncached
    $entry = ['timestamp' => msNow(), 'payload' => $payload];
    // Same flags as emitJson: without PRESERVE_ZERO_FRACTION a cached 7.0
    // magnitude is written as 7 and reads back as an int on the next request.
    @file_put_contents($file, json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
}
function cacheFile(string $key): string {
    $dir = tsunamiCacheDir();
    if ($dir === '') return '';
    $safe = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $key);
    return $dir . DIRECTORY_SEPARATOR . $safe . '.json';
}
function msNow(): int { return (int)round(microtime(true) * 1000); }

function fetchTsunamiPage(string $targetUrl): array {
    $ch = curl_init($targetUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_USERAGENT, TSUNAMI_UA);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_TIMEOUT, TSUNAMI_FETCH_TIMEOUT);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch);
    curl_close($ch);
    if ($body === false || $err) return ['ok' => false, 'body' => null, 'error' => 'Unable to reach PHIVOLCS'];
    if ($code >= 400) return ['ok' => false, 'body' => null, 'error' => 'PHIVOLCS responded with ' . $code];
    return ['ok' => true, 'body' => (string)$body, 'error' => ''];
}

function loadDom(string $html): DOMDocument {
    $dom = new DOMDocument();
    @$dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    return $dom;
}
function nodeText(?DOMNode $node): string {
    if ($node === null) return '';
    $t = html_entity_decode($node->textContent ?? '', ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = preg_replace('/\s+/u', ' ', $t);
    return trim((string)$t);
}
function resolveLink(string $href, string $pageUrl): string {
    $href = trim($href);
    if ($href === '' || $href[0] === '#') return '';
    if (preg_match('#^[a-z][a-z0-9+.\-]*://#i', $href)) return $href;
    $p = parse_url($pageUrl);
    if ($p === false || !isset($p['scheme'], $p['host'])) return $href;
    $origin = $p['scheme'] . '://' . $p['host'];
    if ($href[0] === '/') return $origin . $href;
    $dir = '/';
    if (isset($p['path']) && $p['path'] !== '' && substr($p['path'], -1) !== '/') {
        $dir = rtrim(dirname($p['path']), '/') . '/';
        if ($dir === '/') $dir = '/';
    } elseif (isset($p['path'])) $dir = $p['path'];
    return $origin . $dir . $href;
}

function isTsunamiUrl(string $url): bool {
    $p = parse_url($url);
    if ($p === false || !isset($p['host'])) return false;
    $host = strtolower($p['host']);
    return $host === 'tsunami.phivolcs.dost.gov.ph';
}
function isPdfUrl(string $url): bool {
    return (bool)preg_match('/\.pdf$/i', parse_url($url, PHP_URL_PATH) ?? '');
}

/**
 * PHIVOLCS serves coordinates like "21.20??S" — the degree sign is emitted as
 * literal "?" bytes (a server-side charset bug), so tolerate "°", "º", "?" or
 * no symbol at all. Returns signed float, or null when unparseable.
 */
function parseCoord(string $raw): ?float {
    $s = trim($raw);
    if ($s === '') return null;
    // \W* absorbs the mangled degree symbol ("21.20??S") as well as a clean "°".
    if (!preg_match('/(-?\d+(?:\.\d+)?)\W*([NSEW])/i', $s, $m)) {
        // Bare number with no hemisphere — usable only if already signed.
        return preg_match('/^-?\d+(?:\.\d+)?$/', $s) ? (float)$s : null;
    }
    $val = (float)$m[1];
    $hemi = strtoupper($m[2]);
    if ($hemi === 'S' || $hemi === 'W') $val = -abs($val);
    return $val;
}

/** Zero-padded depth ("018") -> int. */
function parseDepth(string $raw): ?int {
    $s = trim($raw);
    if ($s === '' || !preg_match('/\d+/', $s, $m)) return null;
    return (int)$m[0];
}

function parseMagnitude(string $raw): ?float {
    $s = trim($raw);
    if ($s === '' || !preg_match('/\d+(?:\.\d+)?/', $s, $m)) return null;
    return (float)$m[0];
}

/**
 * Advisory filenames encode the UTC origin time, e.g.
 *   20260925_2123z_Advisory0_1.html  ->  2026-09-25T21:23:00Z
 * This is the most reliable timestamp on the site (the visible date is PST).
 */
function occurredAtFromUrl(string $url): string {
    $path = parse_url($url, PHP_URL_PATH) ?? '';
    if (!preg_match('/(\d{8})_(\d{4})z/i', $path, $m)) return '';
    $d = $m[1]; $t = $m[2];
    if (!checkdate((int)substr($d, 4, 2), (int)substr($d, 6, 2), (int)substr($d, 0, 4))) return '';
    return sprintf('%s-%s-%sT%s:%s:00Z', substr($d, 0, 4), substr($d, 4, 2), substr($d, 6, 2), substr($t, 0, 2), substr($t, 2, 2));
}

function advisoryNumberFromUrl(string $url): ?int {
    $path = parse_url($url, PHP_URL_PATH) ?? '';
    if (!preg_match('/_(\d+)\.(?:html?|pdf)$/i', $path, $m)) return null;
    return (int)$m[1];
}

/**
 * Parse a "26 Sep 2026 - 05:23 AM" cell into a DateTime in Asia/Manila.
 * PHIVOLCS is inconsistent about month names — the 2024-04-03 event reads
 * "03 April 2024" while every other row abbreviates to "Apr" — so normalise to
 * a canonical 3-letter token rather than relying on DateTime's leniency.
 */
function parsePst(string $raw): ?DateTime {
    $s = trim(preg_replace('/\s+/', ' ', $raw));
    static $months = [
        'january' => 'Jan', 'jan' => 'Jan', 'february' => 'Feb', 'feb' => 'Feb',
        'march' => 'Mar', 'mar' => 'Mar', 'april' => 'Apr', 'apr' => 'Apr',
        'may' => 'May', 'june' => 'Jun', 'jun' => 'Jun', 'july' => 'Jul', 'jul' => 'Jul',
        'august' => 'Aug', 'aug' => 'Aug', 'september' => 'Sep', 'sept' => 'Sep', 'sep' => 'Sep',
        'october' => 'Oct', 'oct' => 'Oct', 'november' => 'Nov', 'nov' => 'Nov',
        'december' => 'Dec', 'dec' => 'Dec',
    ];
    $norm = preg_replace_callback('/\b([A-Za-z]{3,9})\b/', function ($m) use ($months) {
        $k = strtolower($m[1]);
        return $months[$k] ?? $m[1];
    }, $s);
    if (!is_string($norm) || $norm === '') return null;
    // "!" resets every unparsed field to the epoch, so no leftover time leaks in.
    $dt = DateTime::createFromFormat('!d M Y - h:i A', $norm, new DateTimeZone('Asia/Manila'));
    return $dt === false ? null : $dt;
}

/** "26 Sep 2026 - 05:23 AM" (PST, UTC+8) -> ISO 8601 with explicit +08:00 offset. */
function pstToIso(string $raw): string {
    $dt = parsePst($raw);
    return $dt === null ? '' : $dt->format('Y-m-d\TH:i:sP');
}

/** Same cell -> UTC. The Philippines is a fixed UTC+8 with no DST, so this is exact. */
function pstToUtcIso(string $raw): string {
    $dt = parsePst($raw);
    if ($dt === null) return '';
    $dt->setTimezone(new DateTimeZone('UTC'));
    return $dt->format('Y-m-d\TH:i:s\Z');
}

/** Advisory links are always site-root relative, whatever prefix PHIVOLCS used. */
function resolveAdvisoryLink(string $href, string $pageUrl): string {
    $href = trim($href);
    // Every advisory href targets /Tsunami_Information/... at the site root, but
    // the yearly archives emit a variable number of "../" segments and at least
    // one 2023 row omits them entirely (which would 404). Normalise to the root
    // instead of trusting the page-relative path.
    if (preg_match('#^(?:\.\./)*(?:Tsunami_Information)/#i', $href, $m)) {
        $rest = preg_replace('#^(?:\.\./)*#', '', $href);
        return TSUNAMI_ORIGIN . '/' . ltrim((string)$rest, '/');
    }
    return resolveLink($href, $pageUrl);
}

/**
 * Parse the #table_events rows shared by the index and every yearly archive.
 * Columns: Date and Time(PST) | Latitude | Longitude | Depth | Magnitude | Location | Advisory
 */
function extractEvents(string $html, string $pageUrl): array {
    $dom = loadDom($html);
    $xp = new DOMXPath($dom);

    $tables = $xp->query('//table[@id="table_events"]');
    if ($tables === false || $tables->length === 0) {
        $tables = $xp->query('//table'); // archive pages keep the same id, but fall back defensively
    }
    if ($tables === false || $tables->length === 0) {
        throw new RuntimeException('no #table_events table found');
    }
    $table = $tables->item(0);

    $out = [];
    $rows = $xp->query('.//tr', $table);
    if ($rows === false) return $out;
    foreach ($rows as $row) {
        $cells = $xp->query('./td', $row);
        if ($cells === false || $cells->length !== 7) continue; // header row uses <th>

        $c = [];
        for ($i = 0; $i < 7; $i++) $c[$i] = nodeText($cells->item($i));

        $advisories = [];
        $links = $xp->query('.//a[@href]', $cells->item(6));
        if ($links !== false) {
            foreach ($links as $a) {
                $href = resolveAdvisoryLink((string)$a->getAttribute('href'), $pageUrl);
                if ($href === '') continue;
                $advisories[] = [
                    'label' => nodeText($a),
                    'url' => $href,
                    'isPdf' => isPdfUrl($href),
                    'number' => advisoryNumberFromUrl($href),
                    // Advisory filenames embed the UTC origin time, but at least one
                    // link on the live index carries a wrong year in the filename, so
                    // this stays advisory-only — occurredAt below comes from the table
                    // cell, which PHIVOLCS renders correctly.
                    'fileUtc' => occurredAtFromUrl($href),
                ];
            }
        }

        $dtPst = $c[0];
        $out[] = [
            'dateTimePST' => $dtPst,
            'occurredAtPST' => pstToIso($dtPst),
            'occurredAtUtc' => pstToUtcIso($dtPst),
            'latitude' => parseCoord($c[1]),
            'longitude' => parseCoord($c[2]),
            'latitudeRaw' => $c[1],
            'longitudeRaw' => $c[2],
            'depth' => parseDepth($c[3]),
            'depthRaw' => $c[3],
            'magnitude' => parseMagnitude($c[4]),
            'location' => $c[5],
            'advisories' => $advisories,
            'link' => $advisories[0]['url'] ?? '', // back-compat with volcano.php
        ];
    }
    return $out;
}

/**
 * Advisory detail page. PHIVOLCS marks the sections with HTML comments
 * (<!--ADVISORY-->, <!-- PRELIMINARY EARTHQUAKE PARAMETERS-->, <!-- EVALUATION -->,
 * <!-- RECOMMENDED ACTION-->, <!--ISSUANCE-->), which are the sturdiest anchors.
 */
function extractAdvisory(string $html, string $pageUrl): array {
    $dom = loadDom($html);
    $xp = new DOMXPath($dom);

    $number = null;
    $flat = nodeText($dom);
    if (preg_match('/TSUNAMI\s+INFORMATION\s+NO\.?\s*(\d+)/i', $flat, $m)) $number = (int)$m[1];
    if ($number === null) $number = advisoryNumberFromUrl($pageUrl);

    // Headline ("NO TSUNAMI THREAT", "TSUNAMI THREAT", ...) is rendered in the
    // coloured banner cell that also carries "TSUNAMI INFORMATION NO. n". The
    // 40px styling lives on an inner <span>, not the <td>, so target the banner
    // by its text and use the span only as a fallback.
    $headline = '';
    $banners = $xp->query('//td[contains(normalize-space(.),"TSUNAMI INFORMATION")]');
    if ($banners !== false) {
        foreach ($banners as $td) {
            $t = nodeText($td);
            if (stripos($t, 'TSUNAMI INFORMATION NO') !== false) { $headline = $t; break; }
        }
    }
    if ($headline === '') {
        $spans = $xp->query('//span[contains(@style,"font-size: 40px")]');
        if ($spans !== false && $spans->length > 0) $headline = nodeText($spans->item(0));
    }
    if ($headline === '') {
        foreach (['NO TSUNAMI THREAT', 'TSUNAMI THREAT', 'POTENTIAL TSUNAMI THREAT'] as $guess) {
            if (stripos($flat, $guess) !== false) { $headline = strtoupper($guess); break; }
        }
    }
    $headline = trim((string)preg_replace('/^TSUNAMI\s+INFORMATION\s+NO\.?\s*\d*\s*/i', '', $headline));

    $threat = 'none';
    $hu = strtoupper($headline);
    if (strpos($hu, 'NO TSUNAMI') !== false) $threat = 'none';
    elseif (strpos($hu, 'WARNING') !== false) $threat = 'warning';
    elseif (strpos($hu, 'THREAT') !== false) $threat = 'threat';
    elseif (strpos($hu, 'ADVISORY') !== false || strpos($hu, 'INFORMATION') !== false) $threat = 'information';
    elseif (strpos($hu, 'CANCEL') !== false || strpos($hu, 'ALL CLEAR') !== false) $threat = 'cancelled';

    // Label/value pairs from the "PRELIMINARY EARTHQUAKE PARAMETERS" table.
    $params = [];
    $trs = $xp->query('//tr');
    if ($trs !== false) {
        foreach ($trs as $tr) {
            $tds = $xp->query('./td', $tr);
            if ($tds === false || $tds->length < 2) continue;
            $label = rtrim(nodeText($tds->item(0)), ':');
            $value = nodeText($tds->item($tds->length - 1));
            if ($label === '' || $value === '') continue;
            $params[strtolower($label)] = $value;
        }
    }

    $location = $params['location'] ?? '';
    $lat = $lon = null;
    // "21.2??S, 168.5??E - Loyalty Islands"
    if (preg_match('/(-?\d+(?:\.\d+)?)\s*\S*\s*([NS])[^,]*,\s*(-?\d+(?:\.\d+)?)\s*\S*\s*([EW])/i', $location, $m)) {
        $lat = parseCoord($m[1] . $m[2]);
        $lon = parseCoord($m[3] . $m[4]);
    }
    $place = trim((string)preg_replace('/^.*?[EW]\s*/i', '', $location));
    $place = trim((string)preg_replace('/^[\s,\-–—]+|[\s,\-–—]+$/u', '', $place));
    if (strpos($place, '-') === 0) $place = ltrim($place, '- ');

    $issuedAt = '';
    $issuedBy = '';
    foreach ($params as $k => $v) {
        if (strpos($k, 'issued on') === 0) $issuedAt = $v;
        if (strpos($k, 'issued by') === 0) $issuedBy = $v;
    }

    $evaluation = sectionText($html, 'EVALUATION');
    $recommendedAction = sectionText($html, 'RECOMMENDED ACTION');
    // IMPORTANT is a plain table row with no HTML comment marker, so read it back
    // out of the parsed label/value pairs.
    $important = sectionText($html, 'IMPORTANT');
    if ($important === '' && isset($params['important'])) $important = $params['important'];

    return [
        'number' => $number,
        'headline' => $headline,
        'threat' => $threat,
        'occurredAtUtc' => occurredAtFromUrl($pageUrl),
        'issuedAt' => $issuedAt,
        'issuedBy' => $issuedBy,
        'latitude' => $lat,
        'longitude' => $lon,
        'depth' => isset($params['depth (km)']) ? parseDepth($params['depth (km)']) : (isset($params['depth']) ? parseDepth($params['depth']) : null),
        'magnitude' => isset($params['magnitude']) ? parseMagnitude($params['magnitude']) : null,
        'location' => $place,
        'dateTimeOrigin' => $params['date and time'] ?? '',
        'evaluation' => $evaluation,
        'recommendedAction' => $recommendedAction,
        'important' => $important,
        'url' => $pageUrl,
        'isPdf' => false,
    ];
}

/**
 * Grab the prose that follows a <!-- MARKER --> comment up to the next marker,
 * then flatten it to plain text.
 */
function sectionText(string $html, string $marker): string {
    $quoted = preg_quote($marker, '/');
    if (!preg_match('/<!--\s*' . $quoted . '\s*-->(.*?)(?=<!--\s*(?:ADVISANCE|EVALUATION|RECOMMENDED|ISSUANCE)|\<\/tr)/is', $html, $m)) {
        return '';
    }
    $chunk = $m[1];
    $chunk = preg_replace('#<br\s*/?>#i', ' ', $chunk);
    $chunk = preg_replace('#<[^>]+>#', ' ', $chunk);
    $chunk = html_entity_decode($chunk, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $chunk = preg_replace('/\s+/u', ' ', $chunk);
    $chunk = trim((string)$chunk);
    // The section heading is inside the captured chunk — drop it so callers get
    // only the prose.
    return trim((string)preg_replace('/^' . preg_quote($marker, '/') . '\s*/i', '', $chunk));
}

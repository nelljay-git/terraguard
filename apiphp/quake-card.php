<?php
/**
 * quake-card.php — PHP/GD earthquake visual-report card (720x900 PNG) for
 * Facebook auto-posts. Alert-banner design (no header/footer bars):
 * full-bleed Esri satellite stitch (the same "satellite mode" tiles the
 * app's Leaflet map shows), "EARTHQUAKE DETECTED" banner,
 * magnitude/depth panel, epicenter rings + callout, location box,
 * bottom info bar (date/source/synthetic seismograph).
 *
 * (Leaflet itself is a browser JS lib and can't run inside PHP/GD — but
 * its tile *source* can: one Esri export request renders the whole 720x900
 * map server-side (plus one transparent labels overlay). This replaced the
 * old Yandex static-maps endpoint, which shared hosts increasingly
 * block/rate-limit, yielding blank dark cards.)
 *
 * Query: ?lat=&lng=&mag=&place=&date=&time=&depth=&source=&info=&sat=
 *   (lat/lng/mag required; source defaults to PHIVOLCS; info = PHIVOLCS
 *   bulletin number, shows an "INFORMATION NO." pill when present)
 *   title / title2  banner headline halves (default EARTHQUAKE / DETECTED;
 *                   the tsunami monitor passes TSUNAMI / INFORMATION)
 *   debug=tiles  plain-text tile-fetch report (no image, no cache) to
 *                   diagnose blank maps from the browser
 * Output: image/png (720x900), cached to disk per query (24h).
 *
 * Requirements: PHP 8+ with GD + FreeType (imagettftext), cURL (or
 * allow_url_fopen for tile fetch). Fonts: apiphp/fonts/*.ttf (bundled)
 * or ../public/fonts/*.ttf (repo layout).
 *
 * Upload bundle for shared hosting (e.g. x10): this file + fonts/*.ttf.
 */

// --- Error handling: image endpoints must never die blank ---
// On failure we emit HTTP 500 plain text (the FB worker treats non-image
// responses as failure and falls back), never a corrupt PNG.
error_reporting(E_ALL);

function emitError(string $msg, int $status = 500): void {
    if (!headers_sent()) {
        header('Content-Type: text/plain');
        header('Cache-Control: no-store');
        http_response_code($status);
    }
    echo 'quake-card error: ' . $msg;
}

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err !== null && in_array((int)$err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR])) {
        emitError($err['message'], 500);
    }
});

// --- Configuration ---
define('CARD_W', 720);
define('CARD_H', 900);
define('MAP_H', 900); // full-bleed map; bars are overlays
define('CACHE_TTL', 86400); // cards are immutable per event
define('CACHE_DIR', sys_get_temp_dir() . '/quakecard_cache');
define('TILE_TIMEOUT', 20); // export renders server-side; allow slow uplinks
// Map style: true = satellite + labels (sat,skl), false = normal map.
// Overridable per request with ?sat=1 / ?sat=0. Otherwise auto day/night:
// event time 6PM-6AM -> satellite, 6AM-6PM -> normal map. When the event
// time is missing/unparseable, this default applies.
define('SATELLITE_MODE', true);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Input ---
// (mb_* when available so multibyte place names are never cut mid-character)
function safeSubstr(string $s, int $len): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $len, 'UTF-8') : substr($s, 0, $len);
}
function safeUpper(string $s): string {
    return function_exists('mb_strtoupper') ? mb_strtoupper($s, 'UTF-8') : strtoupper($s);
}
$lat = isset($_GET['lat']) ? (float)$_GET['lat'] : NAN;
$lng = isset($_GET['lng']) ? (float)$_GET['lng'] : NAN;
$magRaw = isset($_GET['mag']) ? (string)$_GET['mag'] : '';
$mag = is_numeric($magRaw) ? (float)$magRaw : NAN;
if (!is_finite($lat) || !is_finite($lng) || !is_finite($mag)) {
    emitError('Missing/invalid lat, lng, mag', 400);
    exit;
}
$place = safeSubstr(isset($_GET['place']) && $_GET['place'] !== '' ? (string)$_GET['place'] : ($lat . ', ' . $lng), 90);
$date = safeSubstr((string)($_GET['date'] ?? ''), 40);
$time = safeSubstr((string)($_GET['time'] ?? ''), 20);
$depth = safeSubstr((string)($_GET['depth'] ?? ''), 12);
$source = safeSubstr((string)($_GET['source'] ?? 'PHIVOLCS'), 24);
// PHIVOLCS bulletin number (digits only): renders the INFORMATION pill.
// Absent for EMSC/USGS cards, which simply omit the pill.
$infoNo = safeSubstr(preg_replace('/\D+/', '', (string)($_GET['info'] ?? '')), 4);
// Tsunami threat label (?tsunami=Tsunami+Warning): renders a red/amber
// warning pill top-left (mirrors the magnitude panel). Omitted when empty,
// NONE, N/A, or a "no threat" phrase — normal cards stay byte-identical.
$tsunamiRaw = safeSubstr((string)($_GET['tsunami'] ?? ''), 40);
$tsunamiText = '';
if ($tsunamiRaw !== '' && !preg_match('/^(none|n\/?a)\b/i', trim($tsunamiRaw))
    && !preg_match('/no tsunami|no threat|no hazard|not expect|does not pose/i', $tsunamiRaw)) {
    $tsunamiText = safeUpper($tsunamiRaw);
}
// Banner headline, two parts: part 1 renders white, part 2 in the alert colour.
// Defaults keep the original "EARTHQUAKE DETECTED" card byte-identical; the
// tsunami monitor reuses this generator with title=TSUNAMI INFORMATION so it
// does not need its own 24 KB copy.
$titleA = safeUpper(safeSubstr((string)($_GET['title'] ?? 'EARTHQUAKE'), 20));
$titleB = safeUpper(safeSubstr((string)($_GET['title2'] ?? 'DETECTED'), 20));
if ($titleA === '') $titleA = 'EARTHQUAKE';
if ($titleB === '') $titleB = 'DETECTED';
// Event hour (24h) from the card's time string ("09:22 PM", "14:30", ...).
function eventHour24(string $t): ?int {
    if (preg_match('/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])\.?\s*M\.?/i', $t, $m)) {
        $h = ((int)$m[1]) % 12;
        if (strtoupper($m[3]) === 'P') $h += 12;
        return $h;
    }
    if (preg_match('/\b(\d{1,2}):(\d{2})\b/', $t, $m) && (int)$m[1] < 24) {
        return (int)$m[1];
    }
    return null;
}
if (isset($_GET['sat'])) {
    $satellite = ($_GET['sat'] !== '0' && strtolower((string)$_GET['sat']) !== 'false');
} else {
    $hour = eventHour24($time);
    // Night (6PM-6AM) reads better on satellite; day (6AM-6PM) on the map.
    $satellite = ($hour === null) ? SATELLITE_MODE : ($hour >= 18 || $hour < 6);
}
$mapLayer = $satellite ? 'esri-exp-sat' : 'esri-exp-map'; // cache key (v3: single-export, busts old caches)

// --- Disk cache (cards never change for the same query) ---
if (!is_dir(CACHE_DIR)) { @mkdir(CACHE_DIR, 0777, true); }
// $titleA/$titleB are part of the key: without them a tsunami card and an
// earthquake card at the same coordinates/magnitude would share a cache entry.
$cacheKey = md5(implode('|', [$lat, $lng, $magRaw, $place, $date, $time, $depth, $mapLayer, $source, $infoNo, $titleA, $titleB, $tsunamiText]));
$cacheFile = CACHE_DIR . '/' . $cacheKey . '.png';
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    header('Content-Type: image/png');
    header('Cache-Control: public, max-age=86400');
    readfile($cacheFile);
    exit;
}

if (!function_exists('imagecreatetruecolor') || !function_exists('imagettftext')) {
    emitError('PHP GD with FreeType is required', 500);
    exit;
}

// --- Fonts ---
function findFont(string $name): ?string {
    $candidates = [__DIR__ . '/fonts/' . $name, dirname(__DIR__) . '/public/fonts/' . $name];
    foreach ($candidates as $p) {
        if (is_file($p)) return $p;
    }
    return null;
}
$fontOswald = findFont('oswald-700.ttf');
$fontInter = findFont('inter-400.ttf');
if ($fontOswald === null) {
    emitError('fonts missing (expected apiphp/fonts/*.ttf)', 500);
    exit;
}
if ($fontInter === null) $fontInter = $fontOswald; // fallback, better than fatal

// --- Zoom by magnitude (tighter framing than the old pill design) ---
$zoom = $mag >= 7 ? 5 : ($mag >= 6 ? 6 : 7);

// --- Base map: ONE Esri export request for the whole 720x900 card (same
// World_Imagery source as the app's Leaflet satellite mode + video
// renderer). Single-export avoids the burst throttling that kills
// multi-tile stitching on shared hosting (32 parallel tiles -> 429s).
// Satellite mode adds one transparent Reference export (place labels).
// Day mode uses World_Street_Map (labels baked in, 1 request total).
// Framing matches the old zoom math: $P = lng degrees per px at $zoom,
// epicenter at CARD_W/2 x 58% height (matches $epiX/$epiY below).
$P = 360 / (256 * (2 ** $zoom));
$leftLng = $lng - (CARD_W / 2) * $P;
$rightLng = $lng + (CARD_W / 2) * $P;
$topLat = max(-80, min(80, $lat + 0.58 * MAP_H * $P));
$botLat = max(-80, min(80, $lat - 0.42 * MAP_H * $P));
// Wrap antimeridian (PH never crosses it, but keep it correct).
if ($leftLng < -180) { $leftLng += 360; $rightLng += 360; }
if ($rightLng > 180) { $leftLng -= 360; $rightLng -= 360; }
$bbox = number_format($leftLng, 6, '.', '') . ',' . number_format($botLat, 6, '.', '')
    . ',' . number_format($rightLng, 6, '.', '') . ',' . number_format($topLat, 6, '.', '');
$esriBase = $satellite
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export';
$esriRef = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/export';
$tileJobs = [[
    'url' => $esriBase . '?bbox=' . $bbox . '&bboxSR=4326&imageSR=4326'
        . '&size=' . CARD_W . ',' . MAP_H . '&format=png&f=image',
    'left' => 0, 'top' => 0, 'overlay' => false,
]];
if ($satellite) {
    $tileJobs[] = [
        'url' => $esriRef . '?bbox=' . $bbox . '&bboxSR=4326&imageSR=4326'
            . '&size=' . CARD_W . ',' . MAP_H . '&format=png32&transparent=true&f=image',
        'left' => 0, 'top' => 0, 'overlay' => true,
    ];
}

// --- Fetch tiles ---
// Esri/x10 throttle 32-at-once bursts (first tile OK, rest rejected), so:
// pass 1 = curl_multi in small batches; pass 2 = sequential retry with a
// delay for leftovers. HTTP codes are kept for ?debug=tiles.
$tileImages = array_fill(0, count($tileJobs), null);
$tileInfo = array_fill(0, count($tileJobs), 'no attempt');
function fetchTileBody(string $url, string &$info) { // no union return type: stays PHP 7.x compatible
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => TILE_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_USERAGENT => 'TerraGuard-Card/2.0 (Esri tiles)',
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
    ];
    // Shared hosts often have broken IPv6 DNS (curl_err=6). Esri has A
    // records, so prefer IPv4 when the constant exists.
    if (defined('CURL_IPRESOLVE_V4')) $opts[CURLOPT_IPRESOLVE] = CURL_IPRESOLVE_V4;
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch);
    $info = "http=$code" . ($err ? " curl_err=$err:" . curl_error($ch) : '') . ' len=' . strlen((string)$body);
    curl_close($ch);
    if ($body === false || $body === '' || $code < 200 || $code >= 300) return false;
    return $body;
}
if (function_exists('curl_init')) {
    // 1-2 sequential requests: no burst, nothing to throttle.
    // Up to 4 attempts with growing pauses — x10 DNS flakes (err 6) and
    // resolve failures return instantly, so retries are cheap.
    foreach ($tileJobs as $i => $job) {
        $tries = [];
        for ($a = 1; $a <= 4; $a++) {
            if ($a > 1) usleep(500000 * ($a - 1));
            $info = '';
            $body = fetchTileBody($job['url'], $info);
            $tries[] = "try$a: $info";
            if ($body !== false) {
                $img = @imagecreatefromstring($body);
                if ($img !== false) { $tileImages[$i] = $img; break; }
                $tries[count($tries) - 1] .= ' (bad image)';
            }
        }
        $tileInfo[$i] = implode(' / ', $tries);
    }
} else {
    foreach ($tileJobs as $i => $job) {
        $ctx = stream_context_create(['http' => ['timeout' => TILE_TIMEOUT, 'header' => 'User-Agent: TerraGuard-Card/2.0 (Esri tiles)']]);
        $body = @file_get_contents($job['url'], false, $ctx);
        $tileInfo[$i] = 'file_get_contents len=' . strlen((string)$body);
        if ($body !== false) {
            $img = @imagecreatefromstring($body);
            if ($img !== false) $tileImages[$i] = $img;
        }
    }
}

// --- Canvas ---
$im = imagecreatetruecolor(CARD_W, CARD_H);
$navy = imagecolorallocate($im, 11, 16, 32);
$mapBg = imagecolorallocate($im, 16, 21, 28);
$white = imagecolorallocate($im, 255, 255, 255);
$red = imagecolorallocate($im, 239, 68, 68);
$redDeep = imagecolorallocate($im, 185, 28, 28);
$muted = imagecolorallocate($im, 203, 213, 225);
$divider = imagecolorallocate($im, 51, 65, 85);
$panelBg = imagecolorallocatealpha($im, 8, 12, 24, 28); // ~0.78
$ringMid = imagecolorallocatealpha($im, 239, 68, 68, 70);
$ringInner = imagecolorallocatealpha($im, 239, 68, 68, 44);
$ringFaint = imagecolorallocatealpha($im, 239, 68, 68, 100);
$depthGray = imagecolorallocate($im, 229, 231, 235);
imagefill($im, 0, 0, $mapBg);

// Debug mode: plain-text tile-fetch report (browser-checkable, no cache).
// e.g. quake-card.php?lat=..&lng=..&mag=..&debug=tiles
if (isset($_GET['debug']) && $_GET['debug'] === 'tiles') {
    header('Content-Type: text/plain');
    header('Cache-Control: no-store');
    $ok = count(array_filter($tileImages));
    echo "jobs=" . count($tileJobs) . " ok=$ok zoom=$zoom layer=$mapLayer\n";
    echo "curl_multi=" . (function_exists('curl_multi_init') ? 'yes' : 'no') . " curl=" . (function_exists('curl_init') ? 'yes' : 'no') . "\n";
    foreach ($tileJobs as $i => $job) {
        $t = $tileImages[$i];
        echo ($t === null ? 'FAIL' : ('OK ' . imagesx($t) . 'x' . imagesy($t))) . ' [' . $tileInfo[$i] . '] ' . $job['url'] . "\n";
    }
    exit;
}

// Composite tiles (1:1; imagery first, transparent Reference labels over).
imagealphablending($im, true);
foreach ($tileJobs as $i => $job) {
    $tile = $tileImages[$i];
    if ($tile === null) continue;
    imagecopy(
        $im, $tile,
        (int)round($job['left']), (int)round($job['top']),
        0, 0,
        imagesx($tile), imagesy($tile)
    );
    imagedestroy($tile);
}
// EXPERIMENT (?glow=0 disables): highlight the country named in ?place=
// (e.g. "..., INDONESIA") with a thin light-blue ADM0 outline from
// geoBoundaries. Drawn on the bare map; fails soft when unmatched.
$COUNTRY_ISO3 = [
    'PHILIPPINES' => 'PHL', 'INDONESIA' => 'IDN', 'MALAYSIA' => 'MYS', 'JAPAN' => 'JPN',
    'TAIWAN' => 'TWN', 'CHINA' => 'CHN', 'HONG KONG' => 'HKG', 'MONGOLIA' => 'MNG',
    'SOUTH KOREA' => 'KOR', 'KOREA' => 'KOR', 'NORTH KOREA' => 'PRK', 'THAILAND' => 'THA',
    'VIETNAM' => 'VNM', 'CAMBODIA' => 'KHM', 'LAOS' => 'LAO', 'MYANMAR' => 'MMR',
    'BANGLADESH' => 'BGD', 'BHUTAN' => 'BTN', 'NEPAL' => 'NPL', 'INDIA' => 'IND',
    'PAKISTAN' => 'PAK', 'AFGHANISTAN' => 'AFG', 'SRI LANKA' => 'LKA', 'MALDIVES' => 'MDV',
    'PAPUA NEW GUINEA' => 'PNG', 'FIJI' => 'FJI', 'VANUATU' => 'VUT', 'SOLOMON ISLANDS' => 'SLB',
    'NEW CALEDONIA' => 'NCL', 'TONGA' => 'TON', 'SAMOA' => 'WSM', 'NEW ZEALAND' => 'NZL',
    'AUSTRALIA' => 'AUS', 'PALAU' => 'PLW', 'MICRONESIA' => 'FSM', 'MARSHALL ISLANDS' => 'MHL',
    'KIRIBATI' => 'KIR', 'TUVALU' => 'TUV', 'NAURU' => 'NRU', 'GUAM' => 'GUM',
    'HAWAII' => 'USA', 'ALASKA' => 'USA', 'CALIFORNIA' => 'USA', 'UNITED STATES' => 'USA',
    'USA' => 'USA', 'CANADA' => 'CAN', 'MEXICO' => 'MEX', 'GUATEMALA' => 'GTM',
    'EL SALVADOR' => 'SLV', 'HONDURAS' => 'HND', 'NICARAGUA' => 'NIC', 'COSTA RICA' => 'CRI',
    'PANAMA' => 'PAN', 'CUBA' => 'CUB', 'JAMAICA' => 'JAM', 'HAITI' => 'HTI',
    'DOMINICAN REPUBLIC' => 'DOM', 'PUERTO RICO' => 'PRI', 'COLOMBIA' => 'COL',
    'VENEZUELA' => 'VEN', 'ECUADOR' => 'ECU', 'PERU' => 'PER', 'BOLIVIA' => 'BOL',
    'CHILE' => 'CHL', 'ARGENTINA' => 'ARG', 'BRAZIL' => 'BRA', 'URUGUAY' => 'URY',
    'PARAGUAY' => 'PRY', 'TURKEY' => 'TUR', 'TURKIYE' => 'TUR', 'GREECE' => 'GRC',
    'ITALY' => 'ITA', 'SPAIN' => 'ESP', 'PORTUGAL' => 'PRT', 'ICELAND' => 'ISL',
    'UNITED KINGDOM' => 'GBR', 'UK' => 'GBR', 'ENGLAND' => 'GBR', 'IRELAND' => 'IRL',
    'FRANCE' => 'FRA', 'GERMANY' => 'DEU', 'NETHERLANDS' => 'NLD', 'BELGIUM' => 'BEL',
    'SWITZERLAND' => 'CHE', 'AUSTRIA' => 'AUT', 'POLAND' => 'POL', 'CZECHIA' => 'CZE',
    'SLOVAKIA' => 'SVK', 'HUNGARY' => 'HUN', 'ROMANIA' => 'ROU', 'BULGARIA' => 'BGR',
    'SERBIA' => 'SRB', 'CROATIA' => 'HRV', 'SLOVENIA' => 'SVN', 'BOSNIA' => 'BIH',
    'ALBANIA' => 'ALB', 'NORTH MACEDONIA' => 'MKD', 'UKRAINE' => 'UKR', 'RUSSIA' => 'RUS',
    'KAZAKHSTAN' => 'KAZ', 'UZBEKISTAN' => 'UZB', 'TAJIKISTAN' => 'TJK', 'KYRGYZSTAN' => 'KGZ',
    'TURKMENISTAN' => 'TKM', 'AZERBAIJAN' => 'AZE', 'GEORGIA' => 'GEO', 'ARMENIA' => 'ARM',
    'IRAN' => 'IRN', 'IRAQ' => 'IRQ', 'SAUDI ARABIA' => 'SAU', 'YEMEN' => 'YEM',
    'OMAN' => 'OMN', 'UAE' => 'ARE', 'QATAR' => 'QAT', 'KUWAIT' => 'KWT',
    'ISRAEL' => 'ISR', 'JORDAN' => 'JOR', 'LEBANON' => 'LBN', 'SYRIA' => 'SYR',
    'EGYPT' => 'EGY', 'MOROCCO' => 'MAR', 'ALGERIA' => 'DZA', 'TUNISIA' => 'TUN',
    'ETHIOPIA' => 'ETH', 'KENYA' => 'KEN', 'TANZANIA' => 'TZA', 'MOZAMBIQUE' => 'MOZ',
    'MADAGASCAR' => 'MDG', 'SOUTH AFRICA' => 'ZAF', 'GHANA' => 'GHA', 'NIGERIA' => 'NGA',
    'SOMALIA' => 'SOM', 'SUDAN' => 'SDN',
];
function resolveCountryIso3(string $place, array $table): ?string {
    $tail = $place;
    if (($p = strrpos($place, ',')) !== false) $tail = trim(substr($place, $p + 1));
    $up = strtoupper(trim($tail));
    if ($up !== '' && isset($table[$up])) return $table[$up];
    $full = strtoupper($place);
    foreach ($table as $name => $iso) {
        if ($up !== '' && (strpos($up, $name) !== false || strpos($name, $up) !== false)) return $iso;
    }
    foreach ($table as $name => $iso) {
        if (strpos($full, $name) !== false) return $iso;
    }
    return null;
}
$wantGlow = true;
if (isset($_GET['glow'])) {
    $gv = strtolower(trim((string)$_GET['glow']));
    $wantGlow = !in_array($gv, ['0', 'false', 'no', 'off'], true);
}
if ($wantGlow) {
    // PHIVOLCS = Philippine events: always the Philippines boundary.
    // Other sources resolve the country from ?place= as before.
    $glowIso = strcasecmp(trim((string)($source ?? '')), 'PHIVOLCS') === 0
        ? 'PHL'
        : resolveCountryIso3($place, $COUNTRY_ISO3);
    if ($glowIso !== null) {
        $boundary = fetchCountryBoundary($glowIso);
        if ($boundary !== null) {
            $rings = countryRings($boundary);
            // Only touch the map when the boundary actually crosses the view:
            // a loaded-but-offscreen boundary must leave a normal full-color
            // card (otherwise the mask turns everything gray with no outline).
            $spanX = $rightLng - $leftLng; $spanY = $topLat - $botLat;
            $inView = false;
            if ($spanX > 0 && $spanY > 0) {
                foreach ($rings as $ring) {
                    foreach ($ring as $pt) {
                        if (!is_array($pt) || count($pt) < 2) continue;
                        $px = ($pt[0] - $leftLng) / $spanX * CARD_W;
                        $py = ($topLat - $pt[1]) / $spanY * MAP_H;
                        if ($px >= -20 && $px <= CARD_W + 20 && $py >= -20 && $py <= MAP_H + 20) { $inView = true; break 2; }
                    }
                }
            }
            if ($inView) {
                // Country stays in color, everything outside goes black & white.
                grayOutsideCountry($im, $rings, $leftLng, $rightLng, $topLat, $botLat, CARD_W, MAP_H);
                drawBoundaryGlow($im, $boundary, $leftLng, $rightLng, $topLat, $botLat, CARD_W, MAP_H, [147, 197, 253]);
            }
        }
    }
}

// --- Shape helpers ---
// Scanline polygon fill (version-proof: imagefilledpolygon() changed its
// signature between PHP 7 and 8, so raw calls silently draw nothing on
// some hosts — every polygon on this card goes through here).
function fillPoly($im, array $pts, int $color): void {
    $n = (int)(count($pts) / 2);
    if ($n < 3) return;
    $minY = PHP_INT_MAX;
    $maxY = PHP_INT_MIN;
    for ($i = 0; $i < $n; $i++) {
        $yy = $pts[$i * 2 + 1];
        if ($yy < $minY) $minY = $yy;
        if ($yy > $maxY) $maxY = $yy;
    }
    for ($y = (int)floor($minY); $y <= (int)ceil($maxY); $y++) {
        $xs = [];
        for ($i = 0; $i < $n; $i++) {
            $x1 = $pts[$i * 2];
            $y1 = $pts[$i * 2 + 1];
            $j = ($i + 1) % $n;
            $x2 = $pts[$j * 2];
            $y2 = $pts[$j * 2 + 1];
            if (($y1 <= $y && $y2 > $y) || ($y2 <= $y && $y1 > $y)) {
                $xs[] = $x1 + ($y - $y1) / ($y2 - $y1) * ($x2 - $x1);
            }
        }
        sort($xs);
        for ($k = 0; $k + 1 < count($xs); $k += 2) {
            imagefilledrectangle($im, (int)round($xs[$k]), $y, (int)round($xs[$k + 1]), $y, $color);
        }
    }
}

// Magnitude color scale (same coding as the old banner).
function magColorRgb(float $mag): array {
    if ($mag >= 7) return [220, 38, 38];
    if ($mag >= 6) return [239, 68, 68];
    if ($mag >= 5) return [249, 115, 22];
    if ($mag >= 4) return [217, 119, 6];
    return [34, 197, 94];
}

// Severity word-coding for the header subline.
function severityWord(float $mag): array {
    if ($mag < 3) return ['MICRO', [34, 197, 94]]; // green
    if ($mag < 4) return ['MINOR', [59, 130, 246]]; // blue
    if ($mag < 5) return ['LIGHT', [250, 204, 21]]; // yellow
    if ($mag < 6) return ['MODERATE', [249, 115, 22]]; // orange
    if ($mag < 7) return ['STRONG', [239, 68, 68]]; // red
    return ['MAJOR', [139, 92, 246]]; // violet
}

// --- Text helpers ---
function textWidth(string $font, int $size, string $text): int {
    $box = imagettfbbox($size, 0, $font, $text);
    return (int)round($box[2] - $box[0]);
}
function drawCentered($im, string $font, int $size, int $cx, int $baselineY, string $text, int $color): void {
    $box = imagettfbbox($size, 0, $font, $text);
    $w = $box[2] - $box[0];
    imagettftext($im, $size, 0, (int)round($cx - $w / 2 - $box[0]), $baselineY, $color, $font, $text);
}
function drawLeft($im, string $font, int $size, int $x, int $baselineY, string $text, int $color): void {
    $box = imagettfbbox($size, 0, $font, $text);
    imagettftext($im, $size, 0, (int)round($x - $box[0]), $baselineY, $color, $font, $text);
}
// Transparent scrim: horizontal spotlight ($centerRgb mid-width fading to
// $edgeRgb at the edges) combined with a vertical alpha fade ($alphaTop at
// $y0 → $alphaBottom at $y1, GD alpha: 0 = opaque, 127 = transparent).
// The map shows through where alpha is high — no solid bands, no lines.
// Rendered per-pixel at small width then resampled up: drawing it directly
// in slices leaves visible segment boundaries (stripes) on the map.
function fillScrimX($im, int $x0, int $y0, int $x1, int $y1, array $edgeRgb, array $centerRgb, int $alphaTop, int $alphaBottom): void {
    $w = $x1 - $x0 + 1; $h = $y1 - $y0 + 1;
    if ($w <= 0 || $h <= 0) return;
    $sw = min(96, $w);
    $small = imagecreatetruecolor($sw, $h);
    imagealphablending($small, false);
    imagesavealpha($small, true);
    for ($sx = 0; $sx < $sw; $sx++) {
        $t = $sw > 1 ? abs($sx - ($sw - 1) / 2) / (($sw - 1) / 2) : 0;
        $t = max(0.0, min(1.0, $t));
        $t = $t * $t * (3 - 2 * $t);
        $r = (int)round($centerRgb[0] + ($edgeRgb[0] - $centerRgb[0]) * $t);
        $g = (int)round($centerRgb[1] + ($edgeRgb[1] - $centerRgb[1]) * $t);
        $b = (int)round($centerRgb[2] + ($edgeRgb[2] - $centerRgb[2]) * $t);
        for ($sy = 0; $sy < $h; $sy++) {
            $v = $h > 1 ? $sy / ($h - 1) : 0;
            $a = max(0, min(127, (int)round($alphaTop + ($alphaBottom - $alphaTop) * $v)));
            imagesetpixel($small, $sx, $sy, imagecolorallocatealpha($small, $r, $g, $b, $a));
        }
    }
    imagealphablending($im, true);
    imagecopyresampled($im, $small, $x0, $y0, 0, 0, $w, $h, $sw, $h);
    imagedestroy($small);
}
// Side fade for the right-column panels (magnitude / info / tsunami) and the
// location box: solid $rgb at the right edge, fading to transparent leftward.
// Rendered small then resampled up so no banding shows.
function fillFadeRightX($im, int $x0, int $y0, int $x1, int $y1, array $rgb, int $alphaRight, int $alphaLeft): void {
    $w = $x1 - $x0 + 1; $h = $y1 - $y0 + 1;
    if ($w <= 0 || $h <= 0) return;
    $sw = min(96, $w);
    $small = imagecreatetruecolor($sw, $h);
    imagealphablending($small, false);
    imagesavealpha($small, true);
    for ($sx = 0; $sx < $sw; $sx++) {
        $v = $sw > 1 ? $sx / ($sw - 1) : 0; // 0 = left, 1 = right
        $a = max(0, min(127, (int)round($alphaLeft + ($alphaRight - $alphaLeft) * $v)));
        imageline($small, $sx, 0, $sx, $h - 1, imagecolorallocatealpha($small, $rgb[0], $rgb[1], $rgb[2], $a));
    }
    imagealphablending($im, true);
    imagecopyresampled($im, $small, $x0, $y0, 0, 0, $w, $h, $sw, $h);
    imagedestroy($small);
}
// --- EXPERIMENT: country-boundary outline (geoBoundaries, ?glow=0 disables) ---
// Thin light-blue outline only — no blurred shadow. Fails soft.
function fetchCountryBoundary(string $iso3): ?array {
    $cache = CACHE_DIR . '/boundary_' . $iso3 . '_ADM0_simp.geojson';
    $fresh = is_file($cache) && (time() - filemtime($cache)) < 30 * 86400;
    if (!$fresh) {
        // Some countries only ship under gbHumanitarian — try both releases.
        $rels = ['gbAuthoritative', 'gbHumanitarian'];
        $geo = false;
        foreach ($rels as $rel) {
            $info = '';
            $meta = function_exists('curl_init') ? fetchTileBody('https://www.geoboundaries.org/api/current/' . $rel . '/' . $iso3 . '/ADM0/', $info) : false;
            if ($meta === false) continue;
            $j = json_decode((string)$meta, true);
            // Prefer the pre-simplified geometry (a fraction of the vertices —
            // full Indonesia is 2.5M); fall back to the standard download.
            $dl = is_array($j) ? ($j['simplifiedGeometryGeoJSON'] ?? $j['gjDownloadURL'] ?? null) : null;
            if (!is_string($dl) || $dl === '') continue;
            $info2 = '';
            $geo = function_exists('curl_init') ? fetchTileBody($dl, $info2) : false;
            if ($geo !== false) break;
        }
        if ($geo !== false) @file_put_contents($cache, (string)$geo);
    }
    $raw = @file_get_contents($cache);
    if ($raw === false) return null;
    $j = json_decode($raw, true);
    return is_array($j) ? $j : null;
}
function countryRings(array $geojson): array {
    $features = $geojson['features'] ?? [$geojson];
    $rings = [];
    foreach ($features as $f) {
        if (!is_array($f)) continue;
        $g = $f['geometry'] ?? $f;
        if (!is_array($g)) continue;
        $type = strtoupper((string)($g['type'] ?? ''));
        $coords = $g['coordinates'] ?? null;
        if (!is_array($coords)) continue;
        if ($type === 'POLYGON') { foreach ($coords as $ring) { if (is_array($ring)) $rings[] = $ring; } }
        elseif ($type === 'MULTIPOLYGON') { foreach ($coords as $poly) { if (is_array($poly)) foreach ($poly as $ring) { if (is_array($ring)) $rings[] = $ring; } } }
    }
    unset($geojson, $features);
    // Decimate giant rings (Indonesia etc.): sub-pixel vertices are invisible
    // at card scale, but 100k-point polygons exhaust PHP memory.
    foreach ($rings as $rk => $ring) {
        $n = count($ring);
        if ($n > 1500) {
            $stride = (int)ceil($n / 1500);
            $thin = [];
            for ($k = 0; $k < $n; $k += $stride) $thin[] = $ring[$k];
            $thin[] = $ring[$n - 1]; // keep closing point
            $rings[$rk] = $thin;
        }
    }
    return $rings;
}
// Grayscale everything OUTSIDE the country: full-res gray copy merged back
// through a blurred country mask (soft edge). Full resolution throughout —
// an earlier half-size round trip visibly softened the whole map.
function grayOutsideCountry($im, array $rings, float $leftLng, float $rightLng, float $topLat, float $botLat, int $mapW, int $mapH): void {
    $spanX = $rightLng - $leftLng; $spanY = $topLat - $botLat;
    if ($spanX <= 0 || $spanY <= 0 || count($rings) === 0) return;
    $gray = imagecreatetruecolor($mapW, $mapH);
    imagecopy($gray, $im, 0, 0, 0, 0, $mapW, $mapH);
    if (function_exists('imagefilter')) imagefilter($gray, IMG_FILTER_GRAYSCALE);
    // Mask built small (fast fill + blur), then sampled up smooth.
    $mw = 360; $mh = 450;
    $mask = imagecreatetruecolor($mw, $mh);
    imagealphablending($mask, false);
    imagefill($mask, 0, 0, imagecolorallocate($mask, 0, 0, 0));
    $white = imagecolorallocate($mask, 255, 255, 255);
    $kx = $mw / $mapW; $ky = $mh / $mapH;
    foreach ($rings as $ring) {
        $pts = [];
        foreach ($ring as $pt) {
            if (!is_array($pt) || count($pt) < 2) continue;
            $pts[] = ($pt[0] - $leftLng) / $spanX * $mapW * $kx;
            $pts[] = ($topLat - $pt[1]) / $spanY * $mapH * $ky;
        }
        if (count($pts) >= 6) fillPoly($mask, $pts, $white);
    }
    if (function_exists('imagefilter')) { imagefilter($mask, IMG_FILTER_GAUSSIAN_BLUR); imagefilter($mask, IMG_FILTER_GAUSSIAN_BLUR); }
    $maskFull = imagecreatetruecolor($mapW, $mapH);
    imagealphablending($maskFull, false);
    imagecopyresampled($maskFull, $mask, 0, 0, 0, 0, $mapW, $mapH, $mw, $mh);
    imagedestroy($mask);
    for ($y = 0; $y < $mapH; $y++) {
        for ($x = 0; $x < $mapW; $x++) {
            $m = (imagecolorat($maskFull, $x, $y) >> 16) & 0xFF;
            if ($m >= 250) continue; // inside: keep original pixel untouched
            $g = imagecolorat($gray, $x, $y);
            if ($m <= 5) { imagesetpixel($im, $x, $y, $g); continue; }
            $c = imagecolorat($im, $x, $y);
            $t = $m / 255;
            imagesetpixel($im, $x, $y, imagecolorallocate($im,
                (int)round((($c >> 16) & 0xFF) * $t + (($g >> 16) & 0xFF) * (1 - $t)),
                (int)round((($c >> 8) & 0xFF) * $t + (($g >> 8) & 0xFF) * (1 - $t)),
                (int)round(($c & 0xFF) * $t + ($g & 0xFF) * (1 - $t))));
        }
    }
    imagedestroy($gray); imagedestroy($maskFull);
}
function drawBoundaryGlow($im, array $geojson, float $leftLng, float $rightLng, float $topLat, float $botLat, int $mapW, int $mapH, array $rgb): void {
    $spanX = $rightLng - $leftLng; $spanY = $topLat - $botLat;
    if ($spanX <= 0 || $spanY <= 0) return;
    $rings = countryRings($geojson);
    if (count($rings) === 0) return;
    $line = imagecolorallocatealpha($im, $rgb[0], $rgb[1], $rgb[2], 20);
    imagesetthickness($im, 2);
    foreach ($rings as $ring) {
        $pts = [];
        foreach ($ring as $pt) {
            if (!is_array($pt) || count($pt) < 2) continue;
            $pts[] = ($pt[0] - $leftLng) / $spanX * $mapW;
            $pts[] = ($topLat - $pt[1]) / $spanY * $mapH;
        }
        if (count($pts) >= 6) imagepolygon($im, $pts, (int)(count($pts) / 2), $line);
    }
    imagesetthickness($im, 1);
}
// Letter-tracked centered line (airy spacing GD can't do natively).
function drawTracked($im, string $font, int $size, int $cx, int $baselineY, string $text, int $color, int $tracking = 2): void {
    $chars = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
    $widths = [];
    $total = 0;
    foreach ($chars as $ch) {
        $box = imagettfbbox($size, 0, $font, $ch);
        $w = $box[2] - $box[0];
        $widths[] = [$w, $box[0]];
        $total += $w;
    }
    $total += $tracking * max(0, count($chars) - 1);
    $x = (int)round($cx - $total / 2);
    foreach ($chars as $i => $ch) {
        imagettftext($im, $size, 0, (int)round($x - $widths[$i][1]), $baselineY, $color, $font, $ch);
        $x += (int)round($widths[$i][0] + $tracking);
    }
}
function autofit(string $font, string $text, int $startSize, int $maxWidth, int $minSize = 20): int {
    $size = $startSize;
    while ($size > $minSize && textWidth($font, $size, $text) > $maxWidth) $size -= 2;
    return $size;
}
function wrapLines(string $font, int $size, string $text, int $maxWidth, int $maxLines = 3): array {
    $words = preg_split('/\s+/', trim($text));
    $lines = [];
    $cur = '';
    foreach ($words as $w) {
        $try = $cur === '' ? $w : $cur . ' ' . $w;
        if (textWidth($font, $size, $try) <= $maxWidth || $cur === '') {
            $cur = $try;
        } else {
            $lines[] = $cur;
            if (count($lines) >= $maxLines) { $cur = ''; break; }
            $cur = $w;
        }
    }
    if ($cur !== '' && count($lines) < $maxLines) $lines[] = $cur;
    return $lines;
}

// --- Epicenter geometry (matches the tile center shift above) ---
$epiX = CARD_W / 2;
$epiY = (int)round(0.58 * MAP_H);

// --- 1. Alert banner (transparent scrim over the full-bleed map) ---
// Opaque down past the subline ("MAJOR EVENT", baseline +128), THEN fading
// to transparent toward the map center — text always sits on solid scrim.
$bannerTop = 0;
$bannerH = 150;
fillScrimX($im, 0, $bannerTop, CARD_W - 1, $bannerTop + 140, [5, 8, 20], [11, 16, 32], 0, 0);
fillScrimX($im, 0, $bannerTop + 140, CARD_W - 1, $bannerTop + $bannerH + 75, [5, 8, 20], [11, 16, 32], 0, 127);
// Title: part 1 white + part 2 red, centered on the card.
// Advances measured per part (trailing-space bbox is unreliable) so the
// halves never overlap.
$titleSize = 56;
$titleW1 = textWidth($fontOswald, $titleSize, $titleA);
$titleW2 = textWidth($fontOswald, $titleSize, $titleB);
$titleWS = textWidth($fontOswald, $titleSize, $titleA . ' ' . $titleB) - $titleW1 - $titleW2;
$titleWS = max(4, $titleWS); // degenerate bbox guard
while ($titleW1 + $titleWS + $titleW2 > 470 && $titleSize > 28) {
    $titleSize -= 2;
    $titleW1 = textWidth($fontOswald, $titleSize, $titleA);
    $titleW2 = textWidth($fontOswald, $titleSize, $titleB);
    $titleWS = max(4, textWidth($fontOswald, $titleSize, $titleA . ' ' . $titleB) - $titleW1 - $titleW2);
}
$titleY = $bannerTop + 92;
$titleX0 = (int)round(360 - ($titleW1 + $titleWS + $titleW2) / 2);
if (!isset($txtShadow)) $txtShadow = imagecolorallocatealpha($im, 0, 0, 0, 70);
drawLeft($im, $fontOswald, $titleSize, $titleX0 + 2, $titleY + 2, $titleA, $txtShadow);
drawLeft($im, $fontOswald, $titleSize, $titleX0, $titleY, $titleA, $white);
drawLeft($im, $fontOswald, $titleSize, (int)round($titleX0 + $titleW1 + $titleWS) + 2, $titleY + 2, $titleB, $txtShadow);
drawLeft($im, $fontOswald, $titleSize, (int)round($titleX0 + $titleW1 + $titleWS), $titleY, $titleB, $red);
// "{WORD} EVENT" subline with severity color, centered under the title.
$subY = $bannerTop + 128;
[$sevWord, $sevRgb] = severityWord($mag);
$sevDot = imagecolorallocate($im, $sevRgb[0], $sevRgb[1], $sevRgb[2]);
$sevWordW = textWidth($fontInter, 19, $sevWord);
$sevEventW = textWidth($fontInter, 19, 'EVENT');
$sevGap = 10;
$sevX0 = (int)round(360 - (14 + $sevGap + $sevWordW + $sevGap + $sevEventW) / 2);
imagefilledellipse($im, $sevX0 + 7, $subY - 7, 14, 14, $sevDot);
drawLeft($im, $fontInter, 19, $sevX0 + 14 + $sevGap + 2, $subY + 2, $sevWord, $txtShadow);
drawLeft($im, $fontInter, 19, $sevX0 + 14 + $sevGap, $subY, $sevWord, $sevDot);
drawLeft($im, $fontInter, 19, $sevX0 + 14 + $sevGap + $sevWordW + $sevGap + 2, $subY + 2, 'EVENT', $txtShadow);
drawLeft($im, $fontInter, 19, $sevX0 + 14 + $sevGap + $sevWordW + $sevGap, $subY, 'EVENT', $muted);

// --- 2. Magnitude panel (right side, dark translucent, compact) ---
$panelW = 288;
$panelX1 = CARD_W - 16;
$panelX0 = $panelX1 - $panelW;
$panelTop = $bannerTop + $bannerH + 26;
$panelH = 136;
fillFadeRightX($im, $panelX0, $panelTop, $panelX1, $panelTop + $panelH, [8, 12, 24], 25, 127);
// Vertical bar on the panel's right edge, severity word-coding color.
[$sevBarWord, $sevBarRgb] = severityWord(is_finite($mag) ? $mag : 0);
$magBar = imagecolorallocate($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2]);
imagefilledrectangle($im, $panelX1 - 8, $panelTop, $panelX1, $panelTop + $panelH, $magBar);
// Magnitude panel (single centered column; depth lives in the footer now).
$magText = 'M' . ($magRaw !== '' ? $magRaw : '?');
$depthText = ($depth !== '' ? $depth : '?') . ' KM';
$magSize = autofit($fontOswald, $magText, 53, 200);
$panelCx = (int)round($panelX0 + ($panelX1 - $panelX0) / 2);
drawCentered($im, $fontInter, 15, $panelCx, $panelTop + 36 + 2, 'MAGNITUDE', $txtShadow);
drawCentered($im, $fontInter, 15, $panelCx, $panelTop + 36, 'MAGNITUDE', $muted);
drawCentered($im, $fontOswald, $magSize, $panelCx + 2, $panelTop + 104 + 2, $magText, $txtShadow);
drawCentered($im, $fontOswald, $magSize, $panelCx, $panelTop + 104, $magText, $white);

// --- 2b. Information number pill (PHIVOLCS bulletins only, ?info=) ---
// Same width/style as the magnitude panel, tucked right below it (clear
// of the epicenter rings, which start ~40px lower).
if ($infoNo !== '') {
    $infoText = 'INFORMATION NO. ' . $infoNo;
    $pillTop = $panelTop + $panelH + 10;
    $pillH = 44;
    fillFadeRightX($im, $panelX0, $pillTop, $panelX1, $pillTop + $pillH, [8, 12, 24], 25, 127);
    imagefilledrectangle($im, $panelX1 - 8, $pillTop, $panelX1, $pillTop + $pillH, $magBar);
    $infoSize = autofit($fontOswald, $infoText, 22, $panelW - 32);
    drawCentered($im, $fontOswald, $infoSize, $panelCx + 2, $pillTop + 31 + 2, $infoText, $txtShadow);
    drawCentered($im, $fontOswald, $infoSize, $panelCx, $pillTop + 31, $infoText, $white);
}

// --- 2c. Tsunami threat pill (?tsunami=, right column under the magnitude
// panel, below the info pill when shown). Same width/style as the magnitude
// panel with the severity bar on the right edge.
// Warning = red, advisory = amber. Plain "!!" markers (GD fonts lack emoji).
if ($tsunamiText !== '') {
    $isAdvisory = stripos($tsunamiText, 'ADVISORY') !== false;
    $tsuRgb = $isAdvisory ? [249, 115, 22] : [239, 68, 68];
    $tsuBar = imagecolorallocate($im, $tsuRgb[0], $tsuRgb[1], $tsuRgb[2]);
    $tsuText = $tsunamiText;
    $tsuSize = autofit($fontOswald, $tsuText, 22, $panelW - 32);
    $tsuX0 = $panelX0;
    $tsuX1 = $panelX1;
    $tsuTop = $panelTop + $panelH + 10;
    if ($infoNo !== '') $tsuTop += 44 + 10; // stack under the info pill
    $tsuH = 44;
    fillFadeRightX($im, $tsuX0, $tsuTop, $tsuX1, $tsuTop + $tsuH, [8, 12, 24], 25, 127);
    imagefilledrectangle($im, $tsuX1 - 8, $tsuTop, $tsuX1, $tsuTop + $tsuH, $tsuBar);
    drawCentered($im, $fontOswald, $tsuSize, $panelCx + 2, $tsuTop + 31 + 2, $tsuText, $txtShadow);
    drawCentered($im, $fontOswald, $tsuSize, $panelCx, $tsuTop + 31, $tsuText, $white);
}

// --- 3. Epicenter rings + dot, severity word-coding color ---
// Rings taper outward: thickest near the epicenter, thinning with distance.
$sevRingFaint = imagecolorallocatealpha($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2], 100);
$sevRingMid = imagecolorallocatealpha($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2], 70);
$sevRingInner = imagecolorallocatealpha($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2], 44);
$sevSolid = imagecolorallocate($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2]);
imagesetthickness($im, 10);
imageellipse($im, $epiX, $epiY, 116, 116, $sevRingInner);
imagesetthickness($im, 5);
imageellipse($im, $epiX, $epiY, 176, 176, $sevRingMid);
imagesetthickness($im, 3);
imageellipse($im, $epiX, $epiY, 236, 236, $sevRingFaint);
imagesetthickness($im, 1);
// Solid severity dot with a white outline ring.
imagefilledellipse($im, $epiX, $epiY, 54, 54, $white);
imagefilledellipse($im, $epiX, $epiY, 46, 46, $sevSolid);

// --- 4. Location box (bottom-right, above the info bar) ---
$infoBarH = 112;
$infoTop = CARD_H - $infoBarH;
$locPlace = safeUpper($place);
$locLines = wrapLines($fontOswald, 17, $locPlace, 255, 3);
$coordsLine = number_format($lat, 2) . '°N, ' . number_format($lng, 2) . '°E';
$locLineH = 24;
$locBoxH = 17 + count($locLines) * $locLineH + 9 + 26 + 14;
$locX1 = CARD_W - 16;
$locX0 = $locX1 - 337;
$locY1 = $infoTop - 16;
$locY0 = $locY1 - $locBoxH;
fillFadeRightX($im, $locX0, $locY0, $locX1, $locY1, [8, 12, 24], 25, 127);
// Red map-pin bullet.
$pinCx = $locX0 + 26;
$pinCy = $locY0 + 29;
imagefilledellipse($im, $pinCx, $pinCy, 22, 22, $red);
fillPoly($im, [$pinCx - 9, $pinCy + 7, $pinCx + 9, $pinCy + 7, $pinCx, $pinCy + 22], $red);
imagefilledellipse($im, $pinCx, $pinCy, 8, 8, $white);
$tx = $locX0 + 44;
$ty = $locY0 + 34;
if (!isset($txtShadow)) $txtShadow = imagecolorallocatealpha($im, 0, 0, 0, 70);
foreach ($locLines as $line) {
    drawLeft($im, $fontOswald, 17, $tx + 2, $ty + 2, $line, $txtShadow);
    drawLeft($im, $fontOswald, 17, $tx, $ty, $line, $white);
    $ty += $locLineH;
}
// Divider sits just under the last text line (no extra bottom margin).
$ty -= 14;
imageline($im, $tx, $ty, $locX1 - 17, $ty, $divider);
$ty += 22;
// Crosshair bullet + coords.
imageellipse($im, $tx + 9, $ty - 6, 17, 17, $white);
imagefilledellipse($im, $tx + 9, $ty - 6, 4, 4, $white);
drawLeft($im, $fontInter, 12, $tx + 24 + 2, $ty + 2, $coordsLine, $txtShadow);
drawLeft($im, $fontInter, 12, $tx + 24, $ty, $coordsLine, $white);

// --- 5. Bottom info bar: date | source ---
// Transparent scrim: fades in from the map edge to opaque at the bottom.
fillScrimX($im, 0, $infoTop, CARD_W - 1, CARD_H - 1, [5, 8, 20], [11, 16, 32], 127, 0);
// Date / time (left) with calendar icon aligned to the date line only.
// Text shadow (soft black offset) under every footer text line.
$txtShadow = imagecolorallocatealpha($im, 0, 0, 0, 70);
$calX0 = 24;
$calTop = $infoTop + 28;
$calX1 = 50;
$calBot = $infoTop + 56;
imagerectangle($im, $calX0, $calTop, $calX1, $calBot, $white);
imagerectangle($im, $calX0 + 1, $calTop + 1, $calX1 - 1, $calBot - 1, $white);
imagefilledrectangle($im, $calX0, $calTop, $calX1, $calTop + 8, $white);
imagefilledrectangle($im, $calX0 + 6, $calTop - 6, $calX0 + 10, $calTop + 4, $white);
imagefilledrectangle($im, $calX1 - 10, $calTop - 6, $calX1 - 6, $calTop + 4, $white);
$dateShort = $date;
if (preg_match('/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/', $date, $dm)) {
    $dateShort = $dm[1] . ' ' . strtoupper(substr($dm[2], 0, 3)) . ' ' . $dm[3];
} else {
    $dateShort = safeUpper($date);
}
drawLeft($im, $fontOswald, 22, 58 + 2, $infoTop + 45 + 2, $dateShort, $txtShadow);
drawLeft($im, $fontOswald, 22, 58, $infoTop + 45, $dateShort, $white);
drawLeft($im, $fontOswald, 18, 58 + 2, $infoTop + 81 + 2, safeUpper($time), $txtShadow);
drawLeft($im, $fontOswald, 18, 58, $infoTop + 81, safeUpper($time), $depthGray);
// Depth (middle): down-arrow icon + value, tucked right after the date
// block so there's no dead space regardless of date length.
$depthSize = autofit($fontOswald, $depthText, 26, 120);
$depthMidY = $infoTop + 43;
// Depth block: centered in the footer, then nudged right 14px. Divider
// and source follow automatically downstream.
$depthW = textWidth($fontOswald, $depthSize, $depthText);
$arrowCx = (int)round(373 - (35 + $depthW) / 2 + 14);
$depthTextX = $arrowCx + 22;
$depthRight = $depthTextX + textWidth($fontOswald, $depthSize, $depthText);
// Divider between depth and source, then the source block.
// Divider between depth and source, then the source block right-anchored
// so no dead space remains on the right.
$srcDivX = 0;
$srcX = 0;
$sourceSize = autofit($fontOswald, safeUpper($source), 22, 170);
$srcW = textWidth($fontOswald, $sourceSize, safeUpper($source));
$srcX = 676 - $srcW;
$srcDivX = $srcX - 16;
if ($srcDivX < $depthRight + 12) {
    $srcDivX = $depthRight + 12;
    $srcX = $srcDivX + 16;
}
if ($srcX + $srcW > 688) {
    $sourceSize = autofit($fontOswald, safeUpper($source), $sourceSize, max(40, 688 - $srcX));
}
imageline($im, $srcDivX, $infoTop + 32, $srcDivX, $infoTop + 62, $divider);
drawLeft($im, $fontInter, 12, $srcX + 4 + 2, $infoTop + 37 + 2, 'S O U R C E', $txtShadow);
drawLeft($im, $fontInter, 12, $srcX + 4, $infoTop + 37, 'S O U R C E', $muted);
drawLeft($im, $fontOswald, $sourceSize, $srcX + 2, $infoTop + 69 + 2, safeUpper($source), $txtShadow);
drawLeft($im, $fontOswald, $sourceSize, $srcX, $infoTop + 69, safeUpper($source), $white);
imagefilledrectangle($im, $arrowCx - 5, $depthMidY - 20, $arrowCx + 5, $depthMidY + 2, $white);
fillPoly($im, [$arrowCx - 13, $depthMidY - 2, $arrowCx + 13, $depthMidY - 2, $arrowCx, $depthMidY + 16], $white);
drawLeft($im, $fontOswald, $depthSize, $depthTextX + 2, $depthMidY + 9 + 2, $depthText, $txtShadow);
drawLeft($im, $fontOswald, $depthSize, $depthTextX, $depthMidY + 9, $depthText, $white);
// Site URL, letter-tracked, low-opacity, with a 4px bottom margin so the
// descenders clear the bar edge.
$footUrl = imagecolorallocatealpha($im, 156, 163, 175, 44);
$footShadow = imagecolorallocatealpha($im, 0, 0, 0, 90);
drawTracked($im, $fontInter, 9, (int)round(CARD_W / 2) + 1, $infoTop + 96 + 1, 'https://terraguard-ph.pages.dev/', $footShadow, 2);
drawTracked($im, $fontInter, 9, (int)round(CARD_W / 2), $infoTop + 96, 'https://terraguard-ph.pages.dev/', $footUrl, 2);

// --- Output + cache ---
// Debug mode: plain-text boundary report (browser-checkable, no cache).
// e.g. quake-card.php?...&place=Panama+City,+PANAMA&debug=glow
if (isset($_GET['debug']) && $_GET['debug'] === 'glow') {
    header('Content-Type: text/plain');
    header('Cache-Control: no-store');
    $dbgIso = resolveCountryIso3($place, $COUNTRY_ISO3);
    echo "place=" . $place . "\niso=" . var_export($dbgIso, true) . "\n";
    echo "curl=" . (function_exists('curl_init') ? 'yes' : 'no') . "\n";
    echo "bbox=" . $leftLng . ',' . $botLat . ',' . $rightLng . ',' . $topLat . "\n";
    if ($dbgIso !== null) {
        $dbgB = fetchCountryBoundary($dbgIso);
        echo "boundary=" . ($dbgB === null ? 'null' : 'ok') . "\n";
        if ($dbgB === null) {
            foreach (['gbAuthoritative', 'gbHumanitarian'] as $rel) {
                $di = '';
                $metaUrl = 'https://www.geoboundaries.org/api/current/' . $rel . '/' . $dbgIso . '/ADM0/';
                $meta = function_exists('curl_init') ? fetchTileBody($metaUrl, $di) : false;
                echo "meta[$rel]=" . ($meta === false ? 'false' : strlen((string)$meta) . ' bytes') . " [$di]\n";
                if ($meta !== false) {
                    $mj = json_decode((string)$meta, true);
                    $ddl = is_array($mj) ? ($mj['gjDownloadURL'] ?? null) : null;
                    echo "dl[$rel]=" . (is_string($ddl) ? $ddl : var_export($ddl, true)) . "\n";
                    if (is_string($ddl) && $ddl !== '') {
                        $di2 = '';
                        $geo = fetchTileBody($ddl, $di2);
                        echo "geo[$rel]=" . ($geo === false ? 'false' : strlen((string)$geo) . ' bytes') . " [$di2]\n";
                    }
                }
            }
        }
        if (is_array($dbgB)) {
            $feats = $dbgB['features'] ?? [$dbgB];
            echo "features=" . count($feats) . "\n";
            $ringCount = 0; $ptCount = 0; $inView = 0;
            foreach ($feats as $f) {
                $g = is_array($f) ? ($f['geometry'] ?? $f) : null;
                if (!is_array($g)) continue;
                $type = strtoupper((string)($g['type'] ?? ''));
                $coords = $g['coordinates'] ?? null;
                if (!is_array($coords)) continue;
                $polys = $type === 'POLYGON' ? [$coords] : ($type === 'MULTIPOLYGON' ? $coords : []);
                foreach ($polys as $poly) {
                    foreach ((array)$poly as $ring) {
                        if (!is_array($ring)) continue;
                        $ringCount++;
                        foreach ($ring as $pt) {
                            if (!is_array($pt) || count($pt) < 2) continue;
                            $ptCount++;
                            $px = ($pt[0] - $leftLng) / ($rightLng - $leftLng) * CARD_W;
                            $py = ($topLat - $pt[1]) / ($topLat - $botLat) * MAP_H;
                            if ($px >= 0 && $px <= CARD_W && $py >= 0 && $py <= MAP_H) $inView++;
                        }
                    }
                }
            }
            echo "rings=$ringCount points=$ptCount inView=$inView\n";
        }
    }
    exit;
}
header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
imagepng($im, $cacheFile);
readfile($cacheFile);
imagedestroy($im);



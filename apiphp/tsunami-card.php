<?php
/**
 * tsunami-card.php — PHP/GD tsunami visual-report card (720x900 PNG).
 * Sibling of quake-card.php / volcano-card.php, fed by the PHIVOLCS tsunami
 * scraper (apiphp/tsunami.php) via the terraguard-monitor worker.
 *
 * Query: ?lat=&lng=&mag=&depth=&place=&threat=&info=&issued=
 *   lat/lng required (epicenter). threat = none|warning|threat|advisory|
 *   cancelled|information (drives the banner colour). info = advisory number.
 * Output: image/png (720x900), cached 24h on disk.
 *
 * Why PHP and not functions/api/tsunami-card.ts: the Pages Function version
 * fetches 9 Yandex tiles inside satori and dies with Cloudflare error 1102
 * ("exceeded resource limits"). The PHP path on trikefare renders the same
 * style with no CPU ceiling — volcano-card.php already serves a 444KB PNG there.
 *
 * Requirements: PHP 8+ with GD + FreeType, cURL, fonts in apiphp/fonts/ or public/fonts/
 */

error_reporting(E_ALL);

// Image endpoints must never die blank: the FB worker treats a non-image
// response as failure and falls back to a text post.
function emitError(string $msg, int $status = 500): void {
    if (!headers_sent()) { header('Content-Type: text/plain'); header('Cache-Control: no-store'); http_response_code($status); }
    echo 'tsunami-card error: ' . $msg;
}
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err !== null && in_array((int)$err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR])) {
        emitError($err['message'], 500);
    }
});

define('CARD_W', 960);
define('CARD_H', 720); // 4:3 — matches the original Pages Function card
// Fullscreen map: the basin fills the whole canvas; header and footer are
// overlays drawn on top. Fit by height and center-crop longitude (the basin is
// wider than 4:3, so ~12 deg per side fall outside the frame).
define('MAP_Y', 0);
define('MAP_H', 720);
define('FOOT_H', 56);    // footer overlay bar
define('AXIS_H', 24);    // axis label bar, sits directly above the footer
define('HEAD_ZONE', 185); // marker centre is clamped below the header stack

// Full-world view, centred on the epicenter's longitude: the visible window is
// always [epicenter - 180, epicenter + 180], so the star sits mid-map no matter
// where the event is (Philippines, Chile, Tonga — always centred).
define('VIEW_SPAN', 360.0);
define('LAT_TOP', 78.0);
define('LAT_BOT', -65.0); // cut before Antarctica — it adds nothing but a white strip
define('MAP_ZOOM', 3);
define('TILE_W', 650);
define('TILE_H', 450);
define('TILE_TIMEOUT', 8);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

// --- Input ---
function safeSubstr(string $s, int $len): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $len, 'UTF-8') : substr($s, 0, $len);
}
function q(string $key, int $max): string {
    return safeSubstr(trim((string)($_GET[$key] ?? '')), $max);
}
$latRaw = q('lat', 32); $lngRaw = q('lng', 32);
if ($latRaw === '' || $lngRaw === '' || !is_numeric($latRaw) || !is_numeric($lngRaw)) {
    header('Content-Type: text/plain'); header('Cache-Control: no-store'); http_response_code(400);
    echo 'tsunami-card error: lat and lng are required'; exit;
}
$lat = (float)$latRaw; $lng = (float)$lngRaw;
if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
    header('Content-Type: text/plain'); header('Cache-Control: no-store'); http_response_code(400);
    echo 'tsunami-card error: lat/lng out of range'; exit;
}
$mag = q('mag', 12);
$depth = q('depth', 12);
$place = q('place', 70);
$threat = strtolower(q('threat', 16));
$info = q('info', 8);
$issued = q('issued', 60);
$source = q('source', 40);
if ($source === '') $source = 'PHIVOLCS';
if ($threat === '') $threat = 'information';

// No disk cache by design: every request renders fresh. Card queries are rare
// (one per new bulletin plus Facebook's scraper hits), so the render cost is
// acceptable and there is no stale-image risk on layout changes.

if (!function_exists('imagecreatetruecolor') || !function_exists('imagettftext')) {
    emitError('PHP GD with FreeType is required', 500); exit;
}
function findFont(string $name): ?string {
    $cands = [__DIR__ . '/fonts/' . $name, dirname(__DIR__) . '/public/fonts/' . $name];
    foreach ($cands as $p) if (is_file($p)) return $p;
    return null;
}
$fontOswald = findFont('oswald-700.ttf');
$fontInter = findFont('inter-400.ttf');
if ($fontOswald === null) { emitError('fonts missing (expected apiphp/fonts/*.ttf)', 500); exit; }
if ($fontInter === null) $fontInter = $fontOswald;

/** Banner colour by threat level. */
function threatColorRgb(string $threat): array {
    switch (strtolower($threat)) {
        case 'threat':    return [220, 38, 38];    // destructive tsunami possible
        case 'warning':   return [234, 88, 12];    // tsunami warning
        case 'advisory':  return [217, 119, 6];    // advisory / watch
        case 'cancelled': return [100, 116, 139];  // cancelled / all clear
        case 'none':      return [22, 163, 74];    // no tsunami threat
        default:          return [37, 99, 235];    // information
    }
}
$threatRgb = threatColorRgb($threat);

/** Human headline for the banner. */
function threatHeadline(string $threat): string {
    switch (strtolower($threat)) {
        case 'threat':    return 'TSUNAMI THREAT';
        case 'warning':   return 'TSUNAMI WARNING';
        case 'advisory':  return 'TSUNAMI ADVISORY';
        case 'cancelled': return 'ALL CLEAR';
        case 'none':      return 'NO TSUNAMI THREAT';
        default:          return 'TSUNAMI INFORMATION';
    }
}
$headline = threatHeadline($threat);

// --- Epicenter-centred world projection (Web Mercator, world px at MAP_ZOOM) ---
function mercY01(float $lat): float {
    $rad = deg2rad(max(-85.0, min(85.0, $lat)));
    return (1 - log(tan($rad) + 1 / cos($rad)) / M_PI) / 2;
}
// Window left edge, normalised to [-180, 180). The epicenter always lands at
// fraction 0.5 — dead centre — by construction.
$viewLonMin = $lng - 180.0;
while ($viewLonMin < -180.0) $viewLonMin += 360.0;
while ($viewLonMin >= 180.0) $viewLonMin -= 360.0;
const WORLD_PX = 256 * (2 ** MAP_ZOOM);
$X0 = (($viewLonMin + 180) / 360) * WORLD_PX;      // world-px x of the view's left edge
$VIEW_W = (VIEW_SPAN / 360) * WORLD_PX;            // view size in world px (= full world)
$Y_TOP = mercY01(LAT_TOP) * WORLD_PX;
$VIEW_H = mercY01(LAT_BOT) * WORLD_PX - $Y_TOP;
// Fit the basin into the map band, preserving aspect (letterbox the remainder).
$DD = MAP_H / $VIEW_H;
$OFF_X = (CARD_W - $VIEW_W * $DD) / 2; // negative: symmetric longitude crop
$OFF_Y = MAP_Y;

/** Project lon/lat into card pixel coords. Longitude is normalised upward into the
 * current window only, so near-edge points stay near their true side. */
function project(float $lat, float $lng): array {
    global $viewLonMin;
    $elng = $lng;
    while ($elng < $viewLonMin) $elng += 360;
    global $VIEW_W, $Y_TOP, $VIEW_H, $DD, $OFF_X, $OFF_Y;
    $x = $OFF_X + (($elng - $viewLonMin) / VIEW_SPAN) * $VIEW_W * $DD;
    $y = $OFF_Y + ((mercY01($lat) * WORLD_PX - $Y_TOP) / $VIEW_H) * $VIEW_H * $DD;
    return [$x, $y];
}

// --- Tile grid over the basin. Neighbours overlap so Yandex's baked-in
// attribution strips are hidden by the row beneath (same trick as the siblings).
$cols = max(1, (int)ceil($VIEW_W / TILE_W));
$rows = max(1, (int)ceil($VIEW_H / TILE_H));
$stepX = $cols > 1 ? ($VIEW_W - TILE_W) / ($cols - 1) : 0;
$stepY = $rows > 1 ? ($VIEW_H - TILE_H) / ($rows - 1) : 0;
$tileJobs = [];
for ($r = 0; $r < $rows; $r++) {
    $tileTop = $r * $stepY;
    // Inverse mercator: world-px row centre -> latitude for the ll= parameter.
    $y01 = ($Y_TOP + $tileTop + TILE_H / 2) / WORLD_PX;
    $cLat = rad2deg(atan(sinh(M_PI * (1 - 2 * $y01))));
    for ($c = 0; $c < $cols; $c++) {
        $tileLeft = $c * $stepX;
        $tLng = ((($X0 + $tileLeft + TILE_W / 2) / WORLD_PX) * 360) - 180;
        // Yandex ll= wants -180..180 (it 400s past 180)
        $tLng = ((((($tLng + 180) % 360) + 360) % 360)) - 180;
        $ll = number_format($tLng, 6, '.', '') . ',' . number_format($cLat, 6, '.', '');
        $tileJobs[] = [
            'url' => 'https://static-maps.yandex.ru/1.x/?lang=en_US&ll=' . $ll . '&z=' . MAP_ZOOM . '&size=' . TILE_W . ',' . TILE_H . '&l=sat,skl',
            'left' => $OFF_X + $tileLeft * $DD,
            'top' => $OFF_Y + $tileTop * $DD,
            'w' => TILE_W * $DD,
            'h' => TILE_H * $DD,
        ];
    }
}

// --- Fetch tiles (parallel; failures degrade to the dark background) ---
// TLS is verified first. Plenty of shared hosts (and any XAMPP install) ship a
// stale CA bundle that cannot validate the tile host's chain, which would
// silently drop every tile and render a map-less card. So: try verified, and
// only if that yields nothing, retry once without verification. Public map tiles
// are not secrets, and this matches the sibling scrapers (phivolcs.php,
// volcano.php, pagasa.php), which all set SSL_VERIFYPEER=false outright.
function fetchTiles(array $jobs, bool $verify): array {
    $opts = [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => TILE_TIMEOUT, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_USERAGENT => 'TerraGuard-Card/1.0', CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
    ];
    if (!$verify) { $opts[CURLOPT_SSL_VERIFYPEER] = false; $opts[CURLOPT_SSL_VERIFYHOST] = 0; }
    $images = array_fill(0, count($jobs), null);
    // NB: some free hosts (e.g. InfinityFree) define curl_multi_init but disable
    // curl_multi_exec via disable_functions — gate on every multi function used.
    if (function_exists('curl_multi_init') && function_exists('curl_multi_exec') && function_exists('curl_multi_getcontent')) {
        $mh = curl_multi_init(); $handles = [];
        foreach ($jobs as $i => $job) {
            $ch = curl_init($job['url']);
            curl_setopt_array($ch, $opts);
            curl_multi_add_handle($mh, $ch); $handles[$i] = $ch;
        }
        $running = null; do { $mrc = curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 1.0); } while ($running && $mrc === CURLM_OK);
        foreach ($handles as $i => $ch) {
            $body = curl_multi_getcontent($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($body !== false && $body !== '' && $code >= 200 && $code < 300) {
                $img = @imagecreatefromstring($body); if ($img !== false) $images[$i] = $img;
            }
            curl_multi_remove_handle($mh, $ch); curl_close($ch);
        }
        curl_multi_close($mh);
    } else {
        foreach ($jobs as $i => $job) {
            $ctx = stream_context_create(['http' => ['timeout' => TILE_TIMEOUT, 'header' => 'User-Agent: TerraGuard-Card/1.0']]);
            $body = @file_get_contents($job['url'], false, $ctx);
            if ($body !== false) { $img = @imagecreatefromstring($body); if ($img !== false) $images[$i] = $img; }
        }
    }
    return $images;
}
$tileImages = fetchTiles($tileJobs, true);
if (count(array_filter($tileImages)) === 0) {
    $tileImages = fetchTiles($tileJobs, false);
}

// --- Canvas ---
$im = imagecreatetruecolor(CARD_W, CARD_H);
$colBg = imagecolorallocate($im, 10, 13, 18);
$colWhite = imagecolorallocate($im, 255, 255, 255);
$colMuted = imagecolorallocate($im, 156, 163, 175);
$colThreat = imagecolorallocate($im, $threatRgb[0], $threatRgb[1], $threatRgb[2]);
$colRed = imagecolorallocate($im, 225, 29, 72);
imagefill($im, 0, 0, $colBg);
foreach ($tileJobs as $i => $job) {
    $tile = $tileImages[$i]; if ($tile === null) continue;
    imagecopyresampled($im, $tile, (int)round($job['left']), (int)round($job['top']), 0, 0,
        (int)round($job['w']), (int)round($job['h']), imagesx($tile), imagesy($tile));
    imagedestroy($tile);
}

// --- Text helpers ---
function textWidth(string $font, int $size, string $text): int {
    $box = imagettfbbox($size, 0, $font, $text); return (int)round($box[2] - $box[0]);
}
function drawCentered($im, string $font, int $size, int $cx, int $y, string $text, int $color): void {
    $box = imagettfbbox($size, 0, $font, $text); $w = $box[2] - $box[0];
    imagettftext($im, $size, 0, (int)round($cx - $w / 2 - $box[0]), $y, $color, $font, $text);
}
/** Shrink the font until the text fits $maxW, then draw it centred. */
function drawCenteredFitted($im, string $font, int $size, int $cx, int $y, string $text, int $color, int $maxW, int $min = 11): int {
    while ($size > $min && textWidth($font, $size, $text) > $maxW) $size -= 1;
    drawCentered($im, $font, $size, $cx, $y, $text, $color);
    return $size;
}

// --- Graticule: parallels every 30 deg, meridians every 30 deg ---
// The axis labels and attribution sit on an opaque bar at the bottom of the
// map band so the tile watermark strips (bottom tile row) can never bleed
// through the text.
$barH = AXIS_H;
$barTop = CARD_H - FOOT_H - AXIS_H;
$gratLine = imagecolorallocatealpha($im, 255, 255, 255, 108);
$gratText = imagecolorallocatealpha($im, 255, 255, 255, 75);
// Legend chip geometry (drawn after the axis labels, below).
$legW = 132; $legH = 20; $legX = 8; $legY = $barTop + 2;
for ($la = -60; $la <= 60; $la += 30) {
    [, $gy] = project((float)$la, $viewLonMin);
    if ($gy < MAP_Y || $gy > $barTop) continue;
    imageline($im, 0, (int)round($gy), CARD_W, (int)round($gy), $gratLine);
    $lbl = $la === 0 ? '0°' : abs($la) . '°' . ($la > 0 ? 'N' : 'S');
    imagettftext($im, 13, 0, 8, (int)round($gy - 5), $gratText, $fontInter, $lbl);
}
// Meridian lines stop at the label bar. Start on a round 30° multiple so labels
// are always clean values whatever window the epicenter produced.
$merX = [];
$lnStart = floor($viewLonMin / 30.0) * 30;
for ($ln = $lnStart; $ln < $viewLonMin + VIEW_SPAN; $ln += 30) {
    [$gx] = project(0.0, $ln);
    if ($gx < -1 || $gx > CARD_W + 1) continue;
    imageline($im, (int)round($gx), (int)round($OFF_Y), (int)round($gx), (int)round($barTop), $gratLine);
    $merX[] = [$gx, $ln];
}
imagefilledrectangle($im, 0, $barTop, CARD_W, $barTop + AXIS_H, $colBg);
$axisText = imagecolorallocatealpha($im, 255, 255, 255, 25);
// Attribution claims the right end of the bar first; longitude labels must not
// collide with it (the 105°W label was unreadable underneath the credit).
$attrText = '© Yandex · NASA';
$attrW = textWidth($fontInter, 11, $attrText);
$attrX = CARD_W - 8 - $attrW;
imagettftext($im, 11, 0, $attrX, $barTop + 16, imagecolorallocatealpha($im, 255, 255, 255, 30), $fontInter, $attrText);
foreach ($merX as [$gx, $ln]) {
    $e = $ln;
    while ($e > 180) $e -= 360;
    while ($e < -180) $e += 360;
    if (abs($e) >= 179.999) { $lbl = '180°'; }
    else { $lbl = abs($e) < 0.001 ? '0°' : abs((int)$e) . '°' . ($e > 0 ? 'E' : 'W'); }
    $w = textWidth($fontInter, 13, $lbl);
    $lx = (int)round($gx - $w / 2);
    if ($lx < 4 || $lx + $w > $attrX - 8) continue;
    // The legend chip occupies the left end of the bar — skip any label under it.
    if ($lx < $legX + $legW + 10) continue;
    imagettftext($im, 13, 0, $lx, $barTop + 17, $axisText, $fontInter, $lbl);
}

// --- Epicenter: tsunami ripple rings + 5-point star ---
/** Filled 5-point star as a polygon (no font glyph needed). */
function drawStar($im, float $cx, float $cy, float $ro, float $ri, int $color): void {
    $pts = [];
    for ($i = 0; $i < 10; $i++) {
        $rad = ($i % 2 === 0) ? $ro : $ri;
        $a = deg2rad(-90 + $i * 36);
        $pts[] = (int)round($cx + $rad * cos($a));
        $pts[] = (int)round($cy + $rad * sin($a));
    }
    // PHP 8.0 dropped the $num_points parameter; PHP 7.x still requires it.
    // Called with 3 args on 7.4, the call warns and draws nothing — which is
    // exactly how both stars silently vanished on the live host.
    if (PHP_VERSION_ID >= 80000) {
        imagefilledpolygon($im, $pts, $color);
    } else {
        imagefilledpolygon($im, $pts, (int)(count($pts) / 2), $color);
    }
}
[$ecx, $ecy] = project($lat, $lng);
// Clamp the marker into the visible frame: longitude is center-cropped, and the
// header overlay covers the top, so an unclamped epicenter could hide under the
// banner or vanish off-canvas.
$ecx = (float)round(max(45.0, min(CARD_W - 45.0, $ecx)));
$ecy = (float)round(max(HEAD_ZONE, min($barTop - 45.0, $ecy)));
// Concentric rings read as outgoing tsunami waves. Drawn late (after the header
// pills) so the marker is never buried under an overlay.
function drawEpicenter($im, float $ecx, float $ecy, int $unused): void {
    // A single light-red star, no rings or disc.
    $lightRed = imagecolorallocate($im, 248, 113, 113);
    drawStar($im, $ecx, $ecy, 22, 8.6, $lightRed);
}

// --- Legend (bottom-left, on the axis bar, labels skip the space it occupies) ---
imagefilledrectangle($im, $legX, $legY, $legX + $legW, $legY + $legH, imagecolorallocatealpha($im, 0, 0, 0, 40));
imagerectangle($im, $legX, $legY, $legX + $legW, $legY + $legH, imagecolorallocatealpha($im, 255, 255, 255, 60));
drawStar($im, $legX + 18, $legY + $legH / 2, 9, 3.5, imagecolorallocate($im, 248, 113, 113));
imagettftext($im, 13, 0, $legX + 34, $legY + 15, $colWhite, $fontInter, 'Epicenter');

// --- Banner 1: threat headline (solid band above the map, never over it) ---
$bannerY = 20;
$padX = 26; $fontSize = 30;
$tw1 = textWidth($fontOswald, $fontSize, $headline);
while ($tw1 + $padX * 2 + 16 > CARD_W - 32 && $fontSize > 14) { $fontSize -= 1; $tw1 = textWidth($fontOswald, $fontSize, $headline); }
$boxW = $tw1 + $padX * 2 + 16; $boxH = 48;
$boxX = (int)round((CARD_W - $boxW) / 2); $boxY = $bannerY;
imagefilledrectangle($im, $boxX, $boxY, $boxX + $boxW, $boxY + $boxH, $colThreat);
drawCentered($im, $fontOswald, $fontSize, (int)(CARD_W / 2), (int)round($boxY + $boxH / 2 + $fontSize * 0.35 + 4), $headline, $colWhite);

// --- Banner 2: advisory number + coordinates ---
$subParts = [];
if ($info !== '') $subParts[] = 'TSUNAMI INFORMATION #' . $info;
$subParts[] = sprintf('%.2f°%s  %.2f°%s', abs($lat), $lat < 0 ? 'S' : 'N', abs($lng), $lng < 0 ? 'W' : 'E');
$subText = implode('  •  ', $subParts);
$fontSize2 = 15; $padX2 = 16;
$tw2 = textWidth($fontInter, $fontSize2, $subText);
while ($tw2 + $padX2 * 2 + 16 > CARD_W - 32 && $fontSize2 > 10) { $fontSize2 -= 1; $tw2 = textWidth($fontInter, $fontSize2, $subText); }
$boxW2 = $tw2 + $padX2 * 2 + 16; $boxH2 = 30;
$boxX2 = (int)round((CARD_W - $boxW2) / 2); $boxY2 = $boxY + $boxH + 8;
$bgSemi = imagecolorallocatealpha($im, 0, 0, 0, 70);
imagefilledrectangle($im, $boxX2, $boxY2, $boxX2 + $boxW2, $boxY2 + $boxH2, $bgSemi);
drawCentered($im, $fontInter, $fontSize2, (int)(CARD_W / 2), (int)round($boxY2 + $boxH2 / 2 + $fontSize2 * 0.35), $subText, $colWhite);

// --- Pills: magnitude / depth / place ---
$pills = [];
if ($mag !== '') {
    $isFloat = (float)$mag == (int)(float)$mag;
    $pills[] = 'M' . ($isFloat ? number_format((float)$mag, 1) : $mag);
}
// Depth unit varies by source: PHIVOLCS gives bare kilometres, NWS/tsunami.gov
// gives "12 mi". Appending "km" unconditionally produced "12 mi km depth".
$depthPill = '';
if ($depth !== '') {
    if (preg_match('/^\s*([\d.]+)\s*mi\b/i', $depth, $dm)) $depthPill = $dm[1] . ' mi depth';
    else $depthPill = preg_replace('/\s*(km|mi)\b/i', '', $depth) . ' km depth';
}
if ($depthPill !== '') $pills[] = $depthPill;
if ($place !== '') $pills[] = $place;
if (count($pills) > 0) {
    $pillY = $boxY2 + $boxH2 + 8;
    $pillFont = 15; $pillPadX = 12;
    // Shrink to fit: NWS/tsunami.gov areaDesc can be a very long zone list, which
    // would otherwise push the pill row off the right edge of the card.
    $pillWs = []; $totalW = 0;
    do {
        $pillWs = []; $totalW = 0;
        foreach ($pills as $p) {
            $w = textWidth($fontInter, $pillFont, $p) + $pillPadX * 2 + 8;
            $pillWs[] = $w; $totalW += $w + 10;
        }
        $totalW -= 10;
        if ($totalW <= CARD_W - 24 || $pillFont <= 9) break;
        $pillFont -= 1;
    } while (true);
    // If even the smallest size overflows, drop trailing pills rather than clip.
    while (count($pills) > 1 && $totalW > CARD_W - 24) {
        array_pop($pills); array_pop($pillWs); $totalW = 0;
        foreach ($pillWs as $w) $totalW += $w + 10;
        $totalW -= 10;
    }
    $x = (int)round((CARD_W - $totalW) / 2);
    foreach ($pills as $i => $p) {
        $w = $pillWs[$i];
        imagefilledrectangle($im, $x, $pillY, $x + $w, $pillY + 36, $bgSemi);
        drawCentered($im, $fontInter, $pillFont, (int)($x + $w / 2), $pillY + 24, $p, $colWhite);
        $x += $w + 10;
    }
}

// --- Marker on top (after every overlay so it is never buried) ---
drawEpicenter($im, $ecx, $ecy, $colRed);

// --- Footer overlay (bottom band, over the map) ---
$footerY = CARD_H - FOOT_H;
imagefilledrectangle($im, 0, $footerY, CARD_W, CARD_H, $colBg);
$issuedUp = $issued !== '' ? 'ISSUED: ' . strtoupper($issued) : 'PHIVOLCS TSUNAMI BULLETIN';
drawCenteredFitted($im, $fontOswald, 20, (int)(CARD_W / 2), $footerY + 30, $issuedUp, $colWhite, CARD_W - 60, 12);
drawCentered($im, $fontInter, 13, (int)(CARD_W / 2), $footerY + 50, strtoupper($source) . ' • Terra Guard Tsunami Watch', $colMuted);

// --- Output (always fresh, never cached) ---
header('Content-Type: image/png');
header('Cache-Control: no-store');
imagepng($im);
imagedestroy($im);

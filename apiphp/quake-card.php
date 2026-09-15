<?php
/**
 * quake-card.php — PHP/GD port of functions/api/quake-card.ts (the 720x900
 * earthquake visual-report card for Facebook auto-posts).
 *
 * Same design: Yandex satellite tile stitch (~1.8x density, overlapping rows
 * so only the bottom row's attribution strip survives), magnitude-scaled
 * banner, place + coords pills, epicenter dot + rings, issued footer.
 *
 * Query: ?lat=&lng=&mag=&place=&date=&time=&depth=  (lat/lng/mag required)
 * Output: image/png (720x900), cached to disk per query (24h).
 *
 * Requirements: PHP with GD + FreeType (imagettftext), cURL (or
 * allow_url_fopen for tile fetch). Fonts: apiphp/fonts/*.ttf (bundled)
 * or ../public/fonts/*.ttf (repo layout).
 *
 * Upload bundle for shared hosting (e.g. x10): this file + fonts/*.ttf.
 *
 * Run:  php -S localhost:8080 apiphp/  then
 *   GET http://localhost:8080/quake-card.php?lat=4.56&lng=126.01&mag=6.0&place=Test&date=01%20September%202026&time=09:22%20PM&depth=93
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
define('MAP_H', 730);
define('CACHE_TTL', 86400); // cards are immutable per event
define('CACHE_DIR', sys_get_temp_dir() . '/quakecard_cache');
define('TILE_TIMEOUT', 8);

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

// --- Disk cache (cards never change for the same query) ---
if (!is_dir(CACHE_DIR)) { @mkdir(CACHE_DIR, 0777, true); }
$cacheKey = md5(implode('|', [$lat, $lng, $magRaw, $place, $date, $time, $depth]));
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

// --- Layout inputs (mirrors quake-card.ts) ---
$zoom = $mag >= 7 ? 6 : ($mag >= 6 ? 7 : 8);
if ($mag >= 7) { $bannerBg = [220, 38, 38]; }
elseif ($mag >= 6) { $bannerBg = [239, 68, 68]; }
elseif ($mag >= 5) { $bannerBg = [249, 115, 22]; }
elseif ($mag >= 4) { $bannerBg = [217, 119, 6]; }
else { $bannerBg = [34, 197, 94]; }
$bannerText = ($mag >= 7 ? 'MAJOR MAGNITUDE ' : 'MAGNITUDE ') . $magRaw;
$coords = number_format($lat, 2) . '°N, ' . number_format($lng, 2) . '°E';

// --- Tile geometry (port of mapTiles(): overlapping rows hide watermarks) ---
$span = (360 * MAP_H) / (256 * (2 ** $zoom));
$clat = max(-85, min(85, $lat + 0.2 * $span));
$P = 360 / (256 * (2 ** $zoom));
$s = max(CARD_W / 650, MAP_H / 450);
$vw = CARD_W / $s;
$vh = MAP_H / $s;
$P1 = $P / 2;
$VW1 = $vw * 2;
$VH1 = $vh * 2;
$d = CARD_W / $VW1;
$tw = 650 * $d;
$th = 450 * $d;
$cosLat = cos($clat * M_PI / 180);
$topLat = $clat + ($VH1 / 2) * $P1 * $cosLat;
$ROW_STEP = 225;
$rows = (int)ceil(($VH1 - 450) / $ROW_STEP) + 1;
$qx = [CARD_W / 4, (3 * CARD_W) / 4];
$tileJobs = [];
for ($r = 0; $r < $rows; $r++) {
    $rowTop = min($r * $ROW_STEP, $VH1 - 450);
    $rowCenter = $rowTop + 225;
    $tLat = max(-85, min(85, $topLat - $rowCenter * $P1 * $cosLat));
    for ($c = 0; $c < 2; $c++) {
        $tLng = $lng + ($c === 0 ? -1 : 1) * (($VW1 / 4) * $P1);
        // number_format with explicit '.' guards against comma-decimal locales.
        $ll = number_format($tLng, 6, '.', '') . ',' . number_format($tLat, 6, '.', '');
        $tileJobs[] = [
            'url' => 'https://static-maps.yandex.ru/1.x/?lang=en_US&ll=' . $ll
                . '&z=' . ($zoom + 1) . '&size=650,450&l=sat,skl',
            'left' => $qx[$c] - $tw / 2,
            'top' => ($rowTop / $VH1) * MAP_H,
        ];
    }
}

// --- Fetch tiles (curl_multi when available, else sequential) ---
function fetchBytes(string $url, int $timeout): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT => 'TerraGuard-Card/1.0',
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
        ]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($body !== false && $code >= 200 && $code < 300) ? $body : null;
    }
    $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => 'User-Agent: TerraGuard-Card/1.0']]);
    $body = @file_get_contents($url, false, $ctx);
    return $body === false ? null : $body;
}

$tileImages = array_fill(0, count($tileJobs), null);
if (function_exists('curl_multi_init')) {
    $mh = curl_multi_init();
    $handles = [];
    foreach ($tileJobs as $i => $job) {
        $ch = curl_init($job['url']);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => TILE_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT => 'TerraGuard-Card/1.0',
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$i] = $ch;
    }
    $running = null;
    do {
        $mrc = curl_multi_exec($mh, $running);
        if ($running) curl_multi_select($mh, 1.0);
    } while ($running && $mrc === CURLM_OK);
    foreach ($handles as $i => $ch) {
        $body = curl_multi_getcontent($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($body !== false && $body !== '' && $code >= 200 && $code < 300) {
            $img = @imagecreatefromstring($body);
            if ($img !== false) $tileImages[$i] = $img;
        }
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
} else {
    foreach ($tileJobs as $i => $job) {
        $body = fetchBytes($job['url'], TILE_TIMEOUT);
        if ($body !== null) {
            $img = @imagecreatefromstring($body);
            if ($img !== false) $tileImages[$i] = $img;
        }
    }
}

// --- Canvas ---
$im = imagecreatetruecolor(CARD_W, CARD_H);
$bgDark = imagecolorallocate($im, 10, 13, 18);
$mapBg = imagecolorallocate($im, 16, 21, 28);
$white = imagecolorallocate($im, 255, 255, 255);
$red = imagecolorallocate($im, 239, 68, 68);
$pillBg = imagecolorallocatealpha($im, 0, 0, 0, 57); // rgba(0,0,0,0.55)
$ringOuter = imagecolorallocatealpha($im, 239, 68, 68, 82); // 0.35
$ringInner = imagecolorallocatealpha($im, 239, 68, 68, 44); // 0.65
$depthGray = imagecolorallocate($im, 229, 231, 235);
$creditGray = imagecolorallocate($im, 156, 163, 175);
$bannerColor = imagecolorallocate($im, $bannerBg[0], $bannerBg[1], $bannerBg[2]);
imagefill($im, 0, 0, $bgDark);
imagefilledrectangle($im, 0, 0, CARD_W - 1, MAP_H - 1, $mapBg);

// Composite tiles.
foreach ($tileJobs as $i => $job) {
    $tile = $tileImages[$i];
    if ($tile === null) continue;
    imagecopyresampled(
        $im, $tile,
        (int)round($job['left']), (int)round($job['top']),
        0, 0,
        (int)round($tw), (int)round($th),
        imagesx($tile), imagesy($tile)
    );
    imagedestroy($tile);
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
function wrapLines(string $font, int $size, string $text, int $maxWidth, int $maxLines = 2): array {
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

// --- Overlays: banner / place / coords ---
$cx = CARD_W / 2;
$y = 36;
// Banner.
$bannerSize = 27;
$bannerPadX = 31;
$bannerPadY = 12;
$bannerPadTop = $bannerPadY + 10; // extra 10px above the banner text only
$bannerW = textWidth($fontOswald, $bannerSize, $bannerText) + $bannerPadX * 2;
$bannerH = $bannerSize + $bannerPadTop + $bannerPadY + 6;
imagefilledrectangle($im, (int)round($cx - $bannerW / 2), $y, (int)round($cx + $bannerW / 2), $y + $bannerH, $bannerColor);
drawCentered($im, $fontOswald, $bannerSize, $cx, $y + $bannerPadTop + $bannerSize, $bannerText, $white);
$y += $bannerH + 12;
// Place pill (up to 2 wrapped lines).
$placeSize = 21;
$placeLines = wrapLines($fontOswald, $placeSize, safeUpper($place), 660, 2);
$lineH = $placeSize + 12;
$pillPadX = 19;
$pillPadY = 7;
$pillPadTop = $pillPadY + 10; // extra 10px above the pill text only
foreach ($placeLines as $line) {
    $lw = textWidth($fontOswald, $placeSize, $line) + $pillPadX * 2;
    $lh = $lineH + $pillPadTop + $pillPadY;
    imagefilledrectangle($im, (int)round($cx - $lw / 2), $y, (int)round($cx + $lw / 2), $y + $lh, $pillBg);
    drawCentered($im, $fontOswald, $placeSize, $cx, $y + $pillPadTop + $placeSize, $line, $white);
    $y += $lh;
}
$y += 7;
// Coords pill.
$coordsSize = 16;
$coordsPadTop = 5 + 10; // extra 10px above the pill text only
$coordsPadBottom = 5;
$cw = textWidth($fontInter, $coordsSize, $coords) + 17 * 2;
$ch = $coordsSize + 10 + $coordsPadTop + $coordsPadBottom;
imagefilledrectangle($im, (int)round($cx - $cw / 2), $y, (int)round($cx + $cw / 2), $y + $ch, $pillBg);
drawCentered($im, $fontInter, $coordsSize, $cx, $y + $coordsPadTop + $coordsSize, $coords, $white);

// --- Epicenter pin + rings at ~70% map height ---
$epiY = (int)round(0.7 * MAP_H);
imagesetthickness($im, 4);
imageellipse($im, $cx, $epiY, 176, 176, $ringOuter);
imageellipse($im, $cx, $epiY, 116, 116, $ringInner);
imagesetthickness($im, 1);
imagefilledellipse($im, $cx, $epiY, 62, 62, $white);
imagefilledellipse($im, $cx, $epiY, 52, 52, $red);
imagefilledellipse($im, $cx, $epiY, 17, 17, $white);

// --- Footer ---
imagefilledrectangle($im, 0, MAP_H, CARD_W - 1, CARD_H - 1, $bgDark);
$footCx = $cx;
$footDate = $date !== '' ? safeUpper($date) . ($time !== '' ? ' - ' . safeUpper($time) : '') : '';
if ($footDate !== '') {
    drawCentered($im, $fontOswald, 22, $footCx, MAP_H + 68, $footDate, $white);
}
drawCentered($im, $fontOswald, 20, $footCx, MAP_H + 68 + 46, 'DEPTH: ' . ($depth !== '' ? $depth : '?') . ' KM', $depthGray);
drawCentered($im, $fontInter, 13, $footCx, MAP_H + 68 + 46 + 38, 'Terra Guard PH • EMSC Visual Report', $creditGray);

// --- Output + cache ---
header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
imagepng($im, $cacheFile);
readfile($cacheFile);
imagedestroy($im);

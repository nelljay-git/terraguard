<?php
/**
 * quake-card.php — PHP/GD earthquake visual-report card (720x900 PNG) for
 * Facebook auto-posts. Alert-banner design (no header/footer bars):
 * full-bleed Yandex satellite stitch, "EARTHQUAKE DETECTED" banner,
 * magnitude/depth panel, epicenter rings + callout, location box,
 * bottom info bar (date/source/synthetic seismograph).
 *
 * Query: ?lat=&lng=&mag=&place=&date=&time=&depth=&source=&sat=
 *   (lat/lng/mag required; source defaults to PHIVOLCS)
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
define('TILE_TIMEOUT', 8);
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
$mapLayer = $satellite ? 'sat,skl' : 'map';

// --- Disk cache (cards never change for the same query) ---
if (!is_dir(CACHE_DIR)) { @mkdir(CACHE_DIR, 0777, true); }
$cacheKey = md5(implode('|', [$lat, $lng, $magRaw, $place, $date, $time, $depth, $mapLayer, $source]));
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

// --- Tile geometry (port of mapTiles(): overlapping rows hide watermarks) ---
$span = (360 * MAP_H) / (256 * (2 ** $zoom));
$clat = max(-85, min(85, $lat + 0.08 * $span)); // epicenter ~58% height
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
                . '&z=' . ($zoom + 1) . '&size=650,450&l=' . $mapLayer,
            'left' => $qx[$c] - $tw / 2,
            'top' => ($rowTop / $VH1) * MAP_H,
        ];
    }
}

// --- Fetch tiles (curl_multi when available, else sequential) ---
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
        $ctx = stream_context_create(['http' => ['timeout' => TILE_TIMEOUT, 'header' => 'User-Agent: TerraGuard-Card/1.0']]);
        $body = @file_get_contents($job['url'], false, $ctx);
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

// --- 1. Alert banner (full-width dark band, flush with the top) ---
$bannerTop = 0;
$bannerH = 150;
imagefilledrectangle($im, 0, $bannerTop, CARD_W - 1, $bannerTop + $bannerH, $navy);
// Title: "EARTHQUAKE" white + "DETECTED" red, centered on the card.
// Advances measured per part (trailing-space bbox is unreliable) so the
// halves never overlap.
$titleSize = 56;
$titleW1 = textWidth($fontOswald, $titleSize, 'EARTHQUAKE');
$titleW2 = textWidth($fontOswald, $titleSize, 'DETECTED');
$titleWS = textWidth($fontOswald, $titleSize, 'EARTHQUAKE DETECTED') - $titleW1 - $titleW2;
$titleWS = max(4, $titleWS); // degenerate bbox guard
while ($titleW1 + $titleWS + $titleW2 > 470 && $titleSize > 28) {
    $titleSize -= 2;
    $titleW1 = textWidth($fontOswald, $titleSize, 'EARTHQUAKE');
    $titleW2 = textWidth($fontOswald, $titleSize, 'DETECTED');
    $titleWS = max(4, textWidth($fontOswald, $titleSize, 'EARTHQUAKE DETECTED') - $titleW1 - $titleW2);
}
$titleY = $bannerTop + 92;
$titleX0 = (int)round(360 - ($titleW1 + $titleWS + $titleW2) / 2);
drawLeft($im, $fontOswald, $titleSize, $titleX0, $titleY, 'EARTHQUAKE', $white);
drawLeft($im, $fontOswald, $titleSize, (int)round($titleX0 + $titleW1 + $titleWS), $titleY, 'DETECTED', $red);
// "{WORD} EVENT" subline with severity color, centered under the title.
$subY = $bannerTop + 128;
[$sevWord, $sevRgb] = severityWord($mag);
$sevDot = imagecolorallocate($im, $sevRgb[0], $sevRgb[1], $sevRgb[2]);
$sevWordW = textWidth($fontInter, 19, $sevWord);
$sevEventW = textWidth($fontInter, 19, 'EVENT');
$sevGap = 10;
$sevX0 = (int)round(360 - (14 + $sevGap + $sevWordW + $sevGap + $sevEventW) / 2);
imagefilledellipse($im, $sevX0 + 7, $subY - 7, 14, 14, $sevDot);
drawLeft($im, $fontInter, 19, $sevX0 + 14 + $sevGap, $subY, $sevWord, $sevDot);
drawLeft($im, $fontInter, 19, $sevX0 + 14 + $sevGap + $sevWordW + $sevGap, $subY, 'EVENT', $muted);
// Thin divider under the banner.
imagefilledrectangle($im, 0, $bannerTop + $bannerH, CARD_W - 1, $bannerTop + $bannerH + 1, $divider);

// --- 2. Magnitude panel (right side, dark translucent, compact) ---
$panelW = 288;
$panelX1 = CARD_W - 16;
$panelX0 = $panelX1 - $panelW;
$panelTop = $bannerTop + $bannerH + 26;
$panelH = 136;
imagefilledrectangle($im, $panelX0, $panelTop, $panelX1, $panelTop + $panelH, $panelBg);
// Vertical bar on the panel's right edge, severity word-coding color.
[$sevBarWord, $sevBarRgb] = severityWord(is_finite($mag) ? $mag : 0);
$magBar = imagecolorallocate($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2]);
imagefilledrectangle($im, $panelX1 - 8, $panelTop, $panelX1, $panelTop + $panelH, $magBar);
// Magnitude panel (single centered column; depth lives in the footer now).
$magText = 'M' . ($magRaw !== '' ? $magRaw : '?');
$depthText = ($depth !== '' ? $depth : '?') . ' KM';
$magSize = autofit($fontOswald, $magText, 53, 200);
$panelCx = (int)round($panelX0 + ($panelX1 - $panelX0) / 2);
drawCentered($im, $fontInter, 15, $panelCx, $panelTop + 36, 'MAGNITUDE', $muted);
drawCentered($im, $fontOswald, $magSize, $panelCx, $panelTop + 104, $magText, $white);

// --- 3. Epicenter rings + dot, severity word-coding color ---
$sevRingFaint = imagecolorallocatealpha($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2], 100);
$sevRingMid = imagecolorallocatealpha($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2], 70);
$sevRingInner = imagecolorallocatealpha($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2], 44);
$sevSolid = imagecolorallocate($im, $sevBarRgb[0], $sevBarRgb[1], $sevBarRgb[2]);
imagesetthickness($im, 3);
imageellipse($im, $epiX, $epiY, 236, 236, $sevRingFaint);
imageellipse($im, $epiX, $epiY, 176, 176, $sevRingMid);
imageellipse($im, $epiX, $epiY, 116, 116, $sevRingInner);
imagesetthickness($im, 1);
imagefilledellipse($im, $epiX, $epiY, 56, 56, $white);
imagefilledellipse($im, $epiX, $epiY, 46, 46, $sevSolid);
imagefilledellipse($im, $epiX, $epiY, 15, 15, $white);

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
imagefilledrectangle($im, $locX0, $locY0, $locX1, $locY1, $panelBg);
// Red map-pin bullet.
$pinCx = $locX0 + 26;
$pinCy = $locY0 + 29;
imagefilledellipse($im, $pinCx, $pinCy, 22, 22, $red);
fillPoly($im, [$pinCx - 9, $pinCy + 7, $pinCx + 9, $pinCy + 7, $pinCx, $pinCy + 22], $red);
imagefilledellipse($im, $pinCx, $pinCy, 8, 8, $white);
$tx = $locX0 + 44;
$ty = $locY0 + 34;
foreach ($locLines as $line) {
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
drawLeft($im, $fontInter, 12, $tx + 24, $ty, $coordsLine, $white);

// --- 5. Bottom info bar: date | source ---
imagefilledrectangle($im, 0, $infoTop, CARD_W - 1, CARD_H - 1, $navy);
imagefilledrectangle($im, 0, $infoTop, CARD_W - 1, $infoTop + 2, $magBar);
// Date / time (left) with calendar icon aligned to the date line only.
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
drawLeft($im, $fontOswald, 22, 58, $infoTop + 45, $dateShort, $white);
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
drawLeft($im, $fontInter, 12, $srcX + 4, $infoTop + 37, 'S O U R C E', $muted);
drawLeft($im, $fontOswald, $sourceSize, $srcX, $infoTop + 69, safeUpper($source), $white);
imagefilledrectangle($im, $arrowCx - 5, $depthMidY - 20, $arrowCx + 5, $depthMidY + 2, $white);
fillPoly($im, [$arrowCx - 13, $depthMidY - 2, $arrowCx + 13, $depthMidY - 2, $arrowCx, $depthMidY + 16], $white);
drawLeft($im, $fontOswald, $depthSize, $depthTextX, $depthMidY + 9, $depthText, $white);
// Site URL, letter-tracked, low-opacity, with a 4px bottom margin so the
// descenders clear the bar edge.
$footUrl = imagecolorallocatealpha($im, 156, 163, 175, 90);
drawTracked($im, $fontInter, 12, (int)round(CARD_W / 2), $infoTop + 96, 'https://terraguard-ph.pages.dev/', $footUrl, 2);

// --- Output + cache ---
header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
imagepng($im, $cacheFile);
readfile($cacheFile);
imagedestroy($im);



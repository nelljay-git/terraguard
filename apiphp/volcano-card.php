<?php
/**
 * volcano-card.php — PHP/GD volcano visual-report card (720x900 PNG).
 * Port of functions/api/volcano-card.ts (Yandex satellite close-up, risk-colored
 * banner, observation pills, footer). Called by the volcano monitor.
 *
 * Query: ?volcano=MAYON&level=2&risk=MODERATE&issued=19+September+2026&quakes=23&so2=1258&pdz=6
 * Output: image/png (720x900), cached 24h.
 *
 * Requirements: PHP 8+ with GD + FreeType, cURL, fonts in apiphp/fonts/ or public/fonts/
 */

error_reporting(E_ALL);
function emitError(string $msg, int $status = 500): void {
    if (!headers_sent()) { header('Content-Type: text/plain'); header('Cache-Control: no-store'); http_response_code($status); }
    echo 'volcano-card error: ' . $msg;
}
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err !== null && in_array((int)$err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR])) {
        emitError($err['message'], 500);
    }
});

define('CARD_W', 720);
define('CARD_H', 900);
define('MAP_H', 720); // was 650 → map now fills the 70px black gap on top of footer
define('KNOWN_ZOOM', 11);
define('CACHE_TTL', 0); // no cache per request
define('CACHE_DIR', sys_get_temp_dir() . '/volcanocard_cache');
define('TILE_TIMEOUT', 8);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

// --- Input ---
function safeSubstr(string $s, int $len): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $len, 'UTF-8') : substr($s, 0, $len);
}
$volcano = safeSubstr(trim((string)($_GET['volcano'] ?? 'Volcano')), 60);
if ($volcano === '') $volcano = 'Volcano';
$level = safeSubstr(trim((string)($_GET['level'] ?? '?')), 8);
$risk = strtoupper(safeSubstr(trim((string)($_GET['risk'] ?? 'MODERATE')), 16));
$issued = safeSubstr(trim((string)($_GET['issued'] ?? '')), 60);
$quakes = safeSubstr(trim((string)($_GET['quakes'] ?? '')), 40);
$so2 = safeSubstr(trim((string)($_GET['so2'] ?? '')), 40);
$pdz = safeSubstr(trim((string)($_GET['pdz'] ?? '')), 20);

// --- Cache ---
if (!is_dir(CACHE_DIR)) { @mkdir(CACHE_DIR, 0777, true); }
$cacheKey = md5(implode('|', [$volcano, $level, $risk, $issued, $quakes, $so2, $pdz]));
$cacheFile = CACHE_DIR . '/' . $cacheKey . '.png';
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    header('Content-Type: image/png');
    header('Cache-Control: public, max-age=86400');
    readfile($cacheFile);
    exit;
}

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

// --- Volcano coords (same table as volcano-card.ts) ---
$VOLCANO_COORDS = [
    'TAAL' => [14.002, 120.997], 'MAYON' => [13.257, 123.685], 'BULUSAN' => [12.769, 124.056],
    'KANLAON' => [10.412, 123.132], 'PINATUBO' => [15.142, 120.35], 'HIBOK-HIBOK' => [9.203, 124.673],
    'HIBOKHIBOK' => [9.203, 124.673], 'MUSUAN' => [7.875, 124.865], 'RAGANG' => [7.905, 124.502],
    'MAKATURING' => [7.647, 124.32], 'MATUTUM' => [6.365, 125.071], 'PARKER' => [6.102, 124.892],
    'APO' => [6.987, 125.274], 'BALATUKAN' => [8.765, 124.975], 'CABALIAN' => [10.285, 125.22],
    'MAHAGNAO' => [10.879, 124.869], 'BILIRAN' => [11.52, 124.54], 'CAGUA' => [18.222, 122.123],
    'DIDICAS' => [19.077, 122.202], 'BABUYAN CLARO' => [19.524, 121.955], 'SMITH' => [19.54, 121.914],
    'AMBALATUNGAN' => [17.32, 121.1], 'PATOC' => [17.147, 120.983], 'SANTO TOMAS' => [16.33, 120.55],
    'MARIVELES' => [14.523, 120.488], 'NATIB' => [14.718, 120.424], 'JOLO' => [6.013, 121.059],
    'BUD DAJO' => [6.013, 121.059], 'LEONARD KNIASEFF' => [7.38, 126.05], 'LATUKAN' => [7.65, 124.45],
    'CALAYO' => [13.95, 120.65], 'CUICO' => [13.9, 120.6],
];
function resolveVolcano(string $name, array $table): array {
    $key = strtoupper(preg_replace('/VOLCANO|VOLC|MT\.?|MOUNT|\(.*?\)/', '', $name));
    $key = trim(preg_replace('/[^A-Z \-]/', '', $key));
    $key = preg_replace('/\s+/', ' ', $key);
    if ($key === '') return ['lat' => 12.9, 'lng' => 121.8, 'zoom' => 6, 'known' => false];
    if (isset($table[$key])) return ['lat' => $table[$key][0], 'lng' => $table[$key][1], 'zoom' => KNOWN_ZOOM, 'known' => true];
    foreach ($table as $k => $v) {
        if (strpos($key, $k) !== false || strpos($k, $key) !== false) {
            return ['lat' => $v[0], 'lng' => $v[1], 'zoom' => KNOWN_ZOOM, 'known' => true];
        }
    }
    return ['lat' => 12.9, 'lng' => 121.8, 'zoom' => 6, 'known' => false];
}
$geo = resolveVolcano($volcano, $VOLCANO_COORDS);
$lat = $geo['lat']; $lng = $geo['lng']; $zoom = $geo['zoom'];
function riskColorRgb(string $risk): array {
    switch (strtoupper($risk)) {
        case 'CRITICAL': return [127, 29, 29];
        case 'HIGH': return [239, 68, 68];
        case 'MODERATE': return [217, 119, 6];
        case 'ELEVATED': return [59, 130, 246];
        default: return [34, 197, 94];
    }
}
$riskRgb = riskColorRgb($risk);

// --- Tile geometry (same as TS: overlap-stitch to hide watermarks) ---
$span = (360 * MAP_H) / (256 * (2 ** $zoom));
$clat = max(-85, min(85, $lat + 0.07 * $span)); // a bit bottom 2% (was 0.03)
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
$CROP_PX = 40;
$rows = (int)ceil(($VH1 - 450) / $ROW_STEP) + 1;
$qx = [CARD_W / 4, (3 * CARD_W) / 4];
$tileJobs = [];
for ($r = 0; $r < $rows; $r++) {
    $rowTop = $r === $rows - 1 ? $VH1 - 450 + $CROP_PX : min($r * $ROW_STEP, $VH1 - 450);
    $rowCenter = $rowTop + 225;
    $tLat = max(-85, min(85, $topLat - $rowCenter * $P1 * $cosLat));
    for ($c = 0; $c < 2; $c++) {
        $tLng = $lng + ($c === 0 ? -1 : 1) * (($VW1 / 4) * $P1);
        $ll = number_format($tLng, 6, '.', '') . ',' . number_format($tLat, 6, '.', '');
        $tileJobs[] = [
            'url' => 'https://static-maps.yandex.ru/1.x/?lang=en_US&ll=' . $ll . '&z=' . ($zoom + 1) . '&size=650,450&l=sat,skl',
            'left' => $qx[$c] - $tw / 2,
            'top' => ($rowTop / $VH1) * MAP_H,
        ];
    }
}

// --- Fetch tiles ---
$tileImages = array_fill(0, count($tileJobs), null);
if (function_exists('curl_multi_init')) {
    $mh = curl_multi_init(); $handles = [];
    foreach ($tileJobs as $i => $job) {
        $ch = curl_init($job['url']);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => TILE_TIMEOUT, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_USERAGENT => 'TerraGuard-Card/1.0', CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3]);
        curl_multi_add_handle($mh, $ch); $handles[$i] = $ch;
    }
    $running = null; do { $mrc = curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 1.0); } while ($running && $mrc === CURLM_OK);
    foreach ($handles as $i => $ch) {
        $body = curl_multi_getcontent($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($body !== false && $body !== '' && $code >= 200 && $code < 300) {
            $img = @imagecreatefromstring($body); if ($img !== false) $tileImages[$i] = $img;
        }
        curl_multi_remove_handle($mh, $ch); curl_close($ch);
    }
    curl_multi_close($mh);
} else {
    foreach ($tileJobs as $i => $job) {
        $ctx = stream_context_create(['http' => ['timeout' => TILE_TIMEOUT, 'header' => 'User-Agent: TerraGuard-Card/1.0']]);
        $body = @file_get_contents($job['url'], false, $ctx);
        if ($body !== false) { $img = @imagecreatefromstring($body); if ($img !== false) $tileImages[$i] = $img; }
    }
}

// --- Canvas ---
$im = imagecreatetruecolor(CARD_W, CARD_H);
$colBg = imagecolorallocate($im, 10, 13, 18);
$colWhite = imagecolorallocate($im, 255, 255, 255);
$colMuted = imagecolorallocate($im, 156, 163, 175);
$colRisk = imagecolorallocate($im, $riskRgb[0], $riskRgb[1], $riskRgb[2]);
imagefill($im, 0, 0, $colBg);
foreach ($tileJobs as $i => $job) {
    $tile = $tileImages[$i]; if ($tile === null) continue;
    imagecopyresampled($im, $tile, (int)round($job['left']), (int)round($job['top']), 0, 0, (int)round($tw), (int)round($th), imagesx($tile), imagesy($tile));
    imagedestroy($tile);
}

// Helpers
function textWidth(string $font, int $size, string $text): int {
    $box = imagettfbbox($size, 0, $font, $text); return (int)round($box[2] - $box[0]);
}
function drawCentered($im, string $font, int $size, int $cx, int $y, string $text, int $color): void {
    $box = imagettfbbox($size, 0, $font, $text); $w = $box[2] - $box[0];
    imagettftext($im, $size, 0, (int)round($cx - $w/2 - $box[0]), $y, $color, $font, $text);
}
function drawLeft($im, string $font, int $size, int $x, int $y, string $text, int $color): void {
    $box = imagettfbbox($size, 0, $font, $text);
    imagettftext($im, $size, 0, (int)round($x - $box[0]), $y, $color, $font, $text);
}

// Banners — whole header +10% then +20% more
$bannerY = 48; // 40*1.2
$volcanoUpper = strtoupper($volcano) . ' VOLCANO';
$riskUpper = strtoupper($risk);
// Volcano name banner — +15% more (26*1.15≈30)
$padX = 31; $padY = 12; $fontSize = 30; // 26*1.15
$tw = textWidth($fontOswald, $fontSize, $volcanoUpper);
while ($tw + $padX*2 + 16 > CARD_W - 32 && $fontSize > 12) { $fontSize -= 1; $tw = textWidth($fontOswald, $fontSize, $volcanoUpper); }
$boxW = $tw + $padX*2 + 16; $boxH = 55; // 46*1.2
$boxX = (int)round((CARD_W - $boxW)/2); $boxY = $bannerY;
imagefilledrectangle($im, $boxX, $boxY, $boxX+$boxW, $boxY+$boxH, $colRisk);
drawCentered($im, $fontOswald, $fontSize, CARD_W/2, (int)round($boxY + $boxH/2 + $fontSize*0.35 + 5), $volcanoUpper, $colWhite);
// Alert level banner — 50% smaller start + buffer
$levelText = 'ALERT LEVEL ' . $level . ' — ' . $riskUpper;
$fontSize2 = 13; // 26 * 0.5
$padX2 = 19; $padY2 = 7;
$tw2 = textWidth($fontInter, $fontSize2, $levelText);
while ($tw2 + $padX2*2 + 16 > CARD_W - 32 && $fontSize2 > 10) { $fontSize2 -= 1; $tw2 = textWidth($fontInter, $fontSize2, $levelText); }
$boxW2 = $tw2 + $padX2*2 + 16; $boxH2 = 34; // 28*1.2
$boxX2 = (int)round((CARD_W - $boxW2)/2); $boxY2 = $boxY + $boxH + 10;
$bgSemi = imagecolorallocatealpha($im, 0, 0, 0, 70);
imagefilledrectangle($im, $boxX2, $boxY2, $boxX2+$boxW2, $boxY2+$boxH2, $bgSemi);
drawCentered($im, $fontInter, $fontSize2, CARD_W/2, (int)round($boxY2 + $boxH2/2 + $fontSize2*0.35), $levelText, $colWhite);
// Pills
$pills = [];
if ($quakes !== '') $pills[] = $quakes . ' volcanic quakes';
if ($so2 !== '') $pills[] = $so2 . ' t/day SO2';
if ($pdz !== '') $pills[] = $pdz . ' km danger zone';
if (count($pills) > 0) {
    $pillY = $boxY2 + $boxH2 + 10;
    $pillFont = 17; $pillPadX = 14; $pillPadY = 5;
    $totalW = 0; $pillWs = [];
    foreach ($pills as $p) {
        $w = textWidth($fontInter, $pillFont, $p) + $pillPadX*2 + 8; // +8 safety buffer
        $pillWs[] = $w; $totalW += $w + 10;
    }
    $totalW -= 10;
    $x = (int)round((CARD_W - $totalW)/2);
    foreach ($pills as $i => $p) {
        $w = $pillWs[$i];
        imagefilledrectangle($im, $x, $pillY, $x+$w, $pillY+50, $bgSemi); // -25% from 67 → 50
        drawCentered($im, $fontInter, $pillFont, $x+$w/2, $pillY+30, $p, $colWhite);
        $x += $w + 10;
    }
}

// Footer — from map edge (720) to bottom (900), no gap
$footerY = 720;
$footerH = 180;
imagefilledrectangle($im, 0, $footerY, CARD_W, CARD_H, $colBg);
$footerLine = imagecolorallocate($im, 55, 65, 81);
$issuedUp = $issued !== '' ? 'ISSUED: ' . strtoupper($issued) : 'PHIVOLCS VOLCANO BULLETIN';
drawCentered($im, $fontOswald, 26, CARD_W/2, $footerY+95, $issuedUp, $colWhite); // +20px margin top
drawCentered($im, $fontInter, 15, CARD_W/2, $footerY+125, 'PHIVOLCS • Terra Guard Volcano Watch', $colMuted);

// Output — no cache when CACHE_TTL is 0
header('Content-Type: image/png');
if (CACHE_TTL > 0) {
    header('Cache-Control: public, max-age=86400');
    imagepng($im, $cacheFile);
    readfile($cacheFile);
} else {
    header('Cache-Control: no-store');
    imagepng($im);
}
imagedestroy($im);
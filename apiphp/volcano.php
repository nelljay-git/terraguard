<?php
/**
 * volcano.php — PHIVOLCS volcano scraper API (sister file to phivolcs.php / pagasa.php).
 *
 * PHIVOLCS publishes no public volcano API, so this scrapes the official
 * PHIVOLCS-LAVA hub and serves it as clean JSON:
 *
 *   ?page=hub        https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin
 *                     (alert ticker Taal/Kanlaon/Bulusan/Pinatubo/Mayon + latest bulletin links)
 *   ?page=bulletin   alias for hub (back-compat)
 *   detail: GET volcano.php?detail=1&url=<full bulletin url>
 *     -> { success, count:1, data:{ title, alertLevel, issued, text, links[] } }
 *
 * Conventions mirror pagasa.php: file-backed cache per page (10 min TTL),
 * stale-fallback on scrape failure, CORS *, GET-only, JSON errors never blank pages.
 *
 * Run: php -S localhost:8080 apiphp/ then GET http://localhost:8080/volcano.php?page=hub
 */

error_reporting(E_ALL);

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

define('CACHE_TTL_MS', 0); // cache disabled per request — always fetch fresh
define('VOLCANO_HUB', 'https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin');
define('VOLCANO_UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
define('VOLCANO_FETCH_TIMEOUT', 10);
define('CACHE_DIR', sys_get_temp_dir() . '/volcano_cache');
if (!is_dir(CACHE_DIR)) { @mkdir(CACHE_DIR, 0777, true); }

function volcanoPages(): array {
    return [
        'hub'      => ['url' => VOLCANO_HUB, 'type' => 'hub'],
        'bulletin' => ['url' => VOLCANO_HUB, 'type' => 'hub'],
    ];
}

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: ' . ($_SERVER['REQUEST_METHOD'] === 'OPTIONS' ? 'GET, OPTIONS' : 'GET'));
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'Method not allowed'], 405, 'no-store'); exit; }

$page = 'hub';
if (isset($_GET['page']) && is_string($_GET['page']) && $_GET['page'] !== '') $page = strtolower(trim($_GET['page']));
$detailUrl = '';
if (isset($_GET['url']) && is_string($_GET['url'])) $detailUrl = $_GET['url'];
elseif (isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== '') {
    $parsed = []; parse_str($_SERVER['QUERY_STRING'], $parsed);
    if (isset($parsed['url']) && is_string($parsed['url'])) $detailUrl = $parsed['url'];
}
$isDetail = false;
if (isset($_GET['detail'])) {
    $detailVal = is_array($_GET['detail']) ? '' : $_GET['detail'];
    $isDetail = ($detailVal === '1' || $detailVal === 'true');
}

if ($isDetail && $detailUrl !== '') {
    $cacheKey = 'detail:' . $detailUrl;
    $cached = getCached($cacheKey);
    if ($cached !== null) { emitJson($cached, 200, 'no-store'); exit; }
    $scrape = fetchVolcanoPage($detailUrl);
    if (!$scrape['ok']) {
        $stale = getCachedAny($cacheKey);
        if ($stale !== null) { emitJson($stale, 200, 'no-store'); exit; }
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => $scrape['error']], 200, 'no-store'); exit;
    }
    try { $detail = extractVolcanoDetail($scrape['body'], $detailUrl); } catch (Throwable $e) {
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'extractDetail: ' . $e->getMessage()], 500, 'no-store'); exit;
    }
    // Fetch the alternate language (Filipino ↔ English) and attach as bilingual fields
    $altUrl = '';
    if (stripos($detailUrl, 'lang=en') !== false) {
        $altUrl = preg_replace('/[&?]lang=en/i', '', $detailUrl);
    } else {
        $altUrl = $detailUrl . (strpos($detailUrl, '?') === false ? '?lang=en' : '&lang=en');
    }
    $altDetail = null;
    if ($altUrl !== '' && $altUrl !== $detailUrl) {
        $altScrape = fetchVolcanoPage($altUrl);
        if ($altScrape['ok']) {
            try { $altDetail = extractVolcanoDetail($altScrape['body'], $altUrl); } catch (Throwable $e) { $altDetail = null; }
        }
    }
    // Attach bilingual variants: detail is the requested lang, alt is the other
    $isEn = stripos($detailUrl, 'lang=en') !== false;
    if ($altDetail !== null) {
        $detail['parametros_en'] = $isEn ? ($detail['parametros'] ?? []) : ($altDetail['parametros'] ?? []);
        $detail['parametros_fil'] = $isEn ? ($altDetail['parametros'] ?? []) : ($detail['parametros'] ?? []);
        $detail['text_en'] = $isEn ? ($detail['text'] ?? '') : ($altDetail['text'] ?? '');
        $detail['text_fil'] = $isEn ? ($altDetail['text'] ?? '') : ($detail['text'] ?? '');
        $detail['title_en'] = $isEn ? ($detail['title'] ?? '') : ($altDetail['title'] ?? '');
        $detail['title_fil'] = $isEn ? ($altDetail['title'] ?? '') : ($detail['title'] ?? '');
        // Keep primary 'parametros'/'text'/'title' as the requested language for back-compat
    }
    $payload = ['success' => true, 'count' => 1, 'data' => $detail];
    setCached($cacheKey, $payload);
    emitJson($payload, 200, 'no-store'); exit;
}

$pages = volcanoPages();
if (!isset($pages[$page])) {
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'Unknown page. Valid: ' . implode(', ', array_keys($pages))], 400, 'no-store'); exit;
}
$source = $pages[$page]['url'];
$cacheKey = 'page:' . $page;
$cached = getCached($cacheKey);
if ($cached !== null) { emitJson($cached, 200, 'no-store'); exit; }
$scrape = fetchVolcanoPage($source);
if (!$scrape['ok']) {
    $stale = getCachedAny($cacheKey);
    if ($stale !== null) { emitJson($stale, 200, 'no-store'); exit; }
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => $scrape['error']], 200, 'no-store'); exit;
}
try { $result = extractHub($scrape['body'], $source); } catch (Throwable $e) {
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'extract: ' . $e->getMessage()], 500, 'no-store'); exit;
}
$payload = [
    'success' => true,
    'page' => $page,
    'source' => $source,
    'issued' => $result['issued'],
    'count' => count($result['items']),
    'data' => $result['items'],
];
setCached($cacheKey, $payload);
emitJson($payload, 200, 'no-store');

function emitJson(array $payload, int $status, string $cacheControl): void {
    header('Content-Type: application/json');
    header('Cache-Control: ' . $cacheControl);
    http_response_code($status);
    echo json_encode($payload);
}
function getCached(string $key): ?array {
    $entry = readCacheFile($key);
    if ($entry === null) return null;
    if (msNow() - (int)$entry['timestamp'] >= CACHE_TTL_MS) return null;
    return $entry['payload'];
}
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
function msNow(): int { return (int)round(microtime(true) * 1000); }

function fetchVolcanoPage(string $targetUrl): array {
    $ch = curl_init($targetUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_USERAGENT, VOLCANO_UA);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_TIMEOUT, VOLCANO_FETCH_TIMEOUT);
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
function capText(string $s, int $max): string {
    if (function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') > $max : strlen($s) > $max) {
        return (function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max)) . '…';
    }
    return $s;
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

/**
 * Hub parser: alert ticker + latest bulletin cards.
 * Returns ['issued'=>string,'items'=>array] items = volcanos with alertLevel + bulletin link.
 */
function extractHub(string $html, string $pageUrl): array {
    $dom = loadDom($html);
    $xp = new DOMXPath($dom);
    $text = nodeText($dom);

    // Alert Level Status ticker (e.g. "Taal - 1 Kanlaon - 2 Bulusan - 1")
    $levels = [];
    if (preg_match_all('/([A-Za-z ]+?)\s*-\s*([0-5])/', $text, $m, PREG_SET_ORDER)) {
        foreach ($m as $hit) {
            $name = strtoupper(trim($hit[1]));
            if (strlen($name) >= 3 && strlen($name) <= 20 && !isset($levels[$name])) {
                // Filter to known volcanos; ignore nav noise.
                if (in_array($name, ['TAAL','KANLAON','BULUSAN','PINATUBO','MAYON'], true)) {
                    $levels[$name] = (int)$hit[2];
                }
            }
        }
    }

    $items = [];
    $codes = ['tvo'=>'TAAL','kvo'=>'KANLAON','bvo'=>'BULUSAN','mvo'=>'MAYON','pvo'=>'PINATUBO'];
    $seenVolcano = [];
    $links = $xp->query('//a[@href]');
    if ($links !== false) {
        foreach ($links as $a) {
            $href = (string)$a->getAttribute('href');
            if (!preg_match('#/bulletin/activity-([a-z]+)\?bid=(\d+)#i', $href, $bm)) continue;
            $code = strtolower($bm[1]);
            $bid = $bm[2];
            if (!isset($codes[$code])) continue;
            $volcano = $codes[$code];
            $isEnglish = stripos(nodeText($a), 'Summary of 24Hr') !== false || stripos($href, 'lang=en') !== false;
            // Prefer English bulletin over Filipino for the same volcano
            if (isset($seenVolcano[$volcano]) && !$isEnglish) continue;
            if (isset($seenVolcano[$volcano]) && $isEnglish) {
                // Replace Filipino entry with English
                foreach ($items as $idx => $it) {
                    if ($it['volcano'] === $volcano) { array_splice($items, $idx, 1); break; }
                }
            }
            $seenVolcano[$volcano] = true;
            $url = resolveLink($href . (strpos($href,'lang=')===false ? '&lang=en' : ''), $pageUrl);
            $title = nodeText($a);
            if ($title === '') $title = $volcano . ' Bulletin';
            $items[] = [
                'volcano' => $volcano,
                'title' => capText($title, 160),
                'alertLevel' => $levels[$volcano] ?? null,
                'bid' => $bid,
                'url' => $url,
            ];
            if (count($items) >= 10) break;
        }
    }

    // Ensure every known volcano appears even if it has no bulletin card (e.g. PINATUBO at Level 0)
    foreach ($levels as $volcano => $lvl) {
        $found = false;
        foreach ($items as $it) { if ($it['volcano'] === $volcano) { $found = true; break; } }
        if (!$found) {
            $items[] = ['volcano' => $volcano, 'title' => $volcano . ' Volcano Status', 'alertLevel' => $lvl, 'bid' => null, 'url' => $pageUrl];
        }
    }

    // Issued: prefer bulletin card dates (Petsa:/Date:) over footer dates like "09 June 2026" award
    $issued = '';
    if (preg_match('/(?:Petsa|Date):\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i', $text, $im)) {
        $issued = trim($im[1]);
    } elseif (preg_match('/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Enero|Pebrero|Marso|Abril|Mayo|Hunyo|Hulyo|Agosto|Setyembre|Oktubre|Nobyembre|Disyembre)\s+\d{4}\b/i', $text, $im)) {
        $issued = trim($im[0]);
    }

    return ['issued' => $issued, 'items' => $items];
}

function extractVolcanoDetail(string $html, string $pageUrl): array {
    $dom = loadDom($html);
    $xp = new DOMXPath($dom);
    // Strip style/script so CSS like .newfont{...} doesn't leak into text/parametros
    $remove = $xp->query('//style | //script | //noscript');
    if ($remove !== false) {
        foreach ($remove as $n) { if ($n->parentNode) $n->parentNode->removeChild($n); }
    }
    $scope = $dom;
    $cand = $xp->query("//*[contains(@class,'bulletin') or contains(@class,'article') or contains(@class,'content')]");
    if ($cand !== false && $cand->length > 0) {
        // Pick the largest candidate (the actual bulletin, not the nav)
        $best = $cand->item(0);
        $bestLen = strlen(nodeText($best));
        foreach ($cand as $c) {
            $len = strlen(nodeText($c));
            if ($len > $bestLen) { $best = $c; $bestLen = $len; }
        }
        $scope = $best;
    }

    // Title: prefer the orange bulletin header ("MAYON VOLCANO" / "BULKANG MAYON") over <title>
    $title = '';
    $textForTitle = nodeText($scope);
    if (preg_match('/\b(BULKANG\s+[A-Z]+|MAYON\s+VOLCANO|TAAL\s+VOLCANO|KANLAON\s+VOLCANO|BULUSAN\s+VOLCANO|PINATUBO\s+VOLCANO)\b/i', $textForTitle, $tm)) {
        $title = trim($tm[1]);
        // Normalize to Title Case for English, keep Filipino as is but cap
        if (stripos($title, 'BULKANG') === 0) $title = mb_convert_case($title, MB_CASE_TITLE, 'UTF-8');
        else $title = mb_convert_case($title, MB_CASE_TITLE, 'UTF-8');
    } else {
        $tNodes = $xp->query('//title');
        if ($tNodes !== false && $tNodes->length > 0) $title = nodeText($tNodes->item(0));
        $h1 = $xp->query('.//h1', $scope);
        if ($h1 !== false && $h1->length > 0 && nodeText($h1->item(0)) !== '') $title = nodeText($h1->item(0));
    }

    $text = capText(nodeText($scope), 12000);

    $alertLevel = null;
    if (preg_match('/ALERT LEVEL\s*([0-5])/i', $text, $m)) $alertLevel = (int)$m[1];
    if ($alertLevel === null && preg_match('/ANTAS NG ALERTO\s*([0-5])/i', $text, $m)) $alertLevel = (int)$m[1];

    $issued = '';
    if (preg_match('/Petsa:\s*([^\n]{4,60}\d{4})/i', $text, $m)) $issued = trim($m[1]);
    elseif (preg_match('/Date:\s*([^\n]{4,60}\d{4})/i', $text, $m)) $issued = trim($m[1]);
    elseif (preg_match('/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Enero|Pebrero|Marso|Abril|Mayo|Hunyo|Hulyo|Agosto|Setyembre|Oktubre|Nobyembre|Disyembre)\s+\d{4}\b/i', $text, $m)) $issued = trim($m[0]);

    // MGA PARAMETRO — extract each row so frontend can render them as a table, not just raw text
    // Isolate PARAMETERS section to avoid matching the header "Volcano Activity"
    $paramsText = $text;
    if (preg_match('/PARAMETERS/i', $text, $pm, PREG_OFFSET_CAPTURE)) {
        $paramsText = substr($text, $pm[0][1]);
    }
    $parametros = [];
    $labels = [
        'seismicity' => '/Seismicity\s*([^\n]+?)(?=\s*(?:Banaag|Crater glow|Sulfur|Plume|Ground|Earthquake Location|Total no\.|Rekomendasyon|RECOMMENDATION|Paalala|$))/is',
        'craterGlow' => '/(?:Banaag|Crater glow)\s*([^\n]+?)(?=\s*(?:Sulfur|Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is',
        'so2' => '/Sulfur Dioxide Flux\s*([^\n]+?)(?=\s*(?:Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is',
        'plume' => '/Plume\s*([^\n]+?)(?=\s*(?:Ground Deformation|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is',
        'groundDeformation' => '/Ground Deformation\s*([^\n]+?)(?=\s*(?:Earthquake Location|Total no\.|Rekomendasyon|RECOMMENDATION|Paalala|Lokasyon|Additional information|Department of Science|$))/is',
        'eruption' => '/Eruption\s*([^\n]+?)(?=\s*(?:Activity|Aktibidad|Seismicity|Banaag|Sulfur|Plume|Ground|Rekomendasyon|RECOMMENDATION|Paalala|$))/is',
        'activity' => '/Activity\s*([^\n]+?)(?=\s*(?:Seismicity|Banaag|Sulfur|Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is',
    ];
    foreach ($labels as $k => $pat) {
        $src = in_array($k, ['eruption','activity'], true) ? $text : $paramsText;
        if (preg_match($pat, $src, $mm)) {
            $val = trim(preg_replace('/\s+/', ' ', $mm[1]));
            // Strip leaked legend/footer
            $val = trim(preg_split('/Earthquake Location:/i', $val)[0]);
            $val = trim(preg_split('/Total no\. of volcanic earthquake/i', $val)[0]);
            $val = trim(preg_split('/RECOMMENDATION\/COMMENT/i', $val)[0]);
            $val = trim(preg_split('/Rekomendasyon/i', $val)[0]);
            if ($k === 'activity' && preg_match('/Volcano Activity|Summary of 24Hr/i', $val) && strlen($val) > 80) continue;
            if ($k === 'eruption' && strlen($val) > 400) continue;
            if (strlen($val) < 2) continue;
            if (strlen($val) > 240) $val = trim(substr($val, 0, 240)) . '…';
            $parametros[$k] = $val;
        }
    }
    if (!isset($parametros['activity']) && preg_match('/2 pagbuga[^\n]+/i', $paramsText, $mm)) {
        $parametros['activity'] = trim($mm[0]);
    }
    if (!isset($parametros['seismicity']) && preg_match('/23 volcanic[^\n]+/i', $paramsText, $mm)) {
        $parametros['seismicity'] = trim($mm[0]);
    }

    $links = [];
    $seen = [];
    $anchors = $xp->query('.//a[@href] | .//img[@src]', $scope);
    if ($anchors !== false) {
        foreach ($anchors as $a) {
            $raw = $a->nodeName === 'img' ? (string)$a->getAttribute('src') : (string)$a->getAttribute('href');
            $url = resolveLink($raw, $pageUrl);
            if ($url === '' || isset($seen[$url])) continue;
            if (stripos($url, 'bulletinMap/') !== false || preg_match('/\.(jpg|png)(\?|#|$)/i', $url)) {
                $seen[$url] = true; $links[] = $url;
            } elseif (stripos($url, 'phivolcs') !== false || stripos($url, 'wovodat') !== false) {
                $seen[$url] = true; $links[] = $url;
            }
            if (count($links) >= 20) break;
        }
    }

    return [
        'title' => capText($title, 200),
        'alertLevel' => $alertLevel,
        'issued' => $issued,
        'text' => $text,
        'parametros' => $parametros,
        'links' => $links,
    ];
}

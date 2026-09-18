<?php
/**
 * pagasa.php — PAGASA scraper API (sister file to phivolcs.php).
 *
 * PAGASA publishes no public API, so this scrapes the six pages the
 * TerraGuard worker watches and serves them as clean JSON:
 *
 *   ?page=weather    /weather                                 (daily forecast article)
 *   ?page=bulletin   /tropical-cyclone/severe-weather-bulletin (TC bulletins)
 *   ?page=cyclone    /tropical-cyclone-advisory-iframe         (TC advisory, iframe embed)
 *   ?page=advisory   /weather/weather-advisory                 (weather advisories)
 *   ?page=gale       /marine/gale-warning                     (gale warnings)
 *   ?page=flood      /flood                                    (flood/dam info)
 *
 * Modes:
 *   list (default): GET pagasa.php?page=bulletin
 *     -> { success, page, source, issued, notice, count, data[] }
 *        data[] = { title, text, url } (sections for articles, links for listings)
 *   detail: GET pagasa.php?detail=1&url=<full PAGASA url>
 *     -> { success, count: 1, data: { title, issued, text, links[] } }
 *
 * Conventions mirror phivolcs.php: file-backed cache per page (10 min TTL,
 * PAGASA updates a few times daily), stale-fallback on scrape failure,
 * CORS *, GET-only, JSON errors never blank pages.
 *
 * Run:  php -S localhost:8080 apiphp/   then  GET http://localhost:8080/pagasa.php?page=weather
 */

// --- Error handling: surface failures as JSON, never a blank page ---
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

// --- Configuration ---
define('CACHE_TTL_MS', 10 * 60 * 1000); // PAGASA refreshes a few times daily
define('PAGASA_BASE', 'https://www.pagasa.dost.gov.ph');
define('PAGASA_UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
define('PAGASA_FETCH_TIMEOUT', 10);
define('CACHE_DIR', sys_get_temp_dir() . '/pagasa_cache');
if (!is_dir(CACHE_DIR)) { @mkdir(CACHE_DIR, 0777, true); }

// page key -> source path + parse strategy ('article' = daily-forecast style
// content page, 'listing' = bulletin/advisory link collection page).
function pagasaPages(): array {
    return [
        'weather'  => ['path' => '/weather', 'type' => 'article'],
        'bulletin' => ['path' => '/tropical-cyclone/severe-weather-bulletin', 'type' => 'listing'],
        'cyclone'  => ['path' => '/tropical-cyclone-advisory-iframe', 'type' => 'listing'],
        'advisory' => ['path' => '/weather/weather-advisory', 'type' => 'listing'],
        'gale'     => ['path' => '/marine/gale-warning', 'type' => 'listing'],
        'flood'    => ['path' => '/flood', 'type' => 'listing'],
    ];
}

// Headers
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

// --- Query parsing (same tolerant style as phivolcs.php) ---
$page = 'weather';
if (isset($_GET['page']) && is_string($_GET['page']) && $_GET['page'] !== '') {
    $page = strtolower(trim($_GET['page']));
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

// --- Detail mode: cleaned text of any PAGASA (or pubfiles) URL ---
if ($isDetail && $detailUrl !== '') {
    $cacheKey = 'detail:' . $detailUrl;
    $cached = getCached($cacheKey);
    if ($cached !== null) {
        emitJson($cached, 200, 's-maxage=600, stale-while-revalidate');
        exit;
    }
    $scrape = fetchPagasaPage($detailUrl);
    if (!$scrape['ok']) {
        $stale = getCachedAny($cacheKey);
        if ($stale !== null) {
            emitJson($stale, 200, 's-maxage=600, stale-while-revalidate');
            exit;
        }
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => $scrape['error']], 200, 'no-store');
        exit;
    }
    try {
        $detail = extractDetail($scrape['body'], $detailUrl);
    } catch (Throwable $e) {
        emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'extractDetail: ' . $e->getMessage()], 500, 'no-store');
        exit;
    }
    $payload = ['success' => true, 'count' => 1, 'data' => $detail];
    setCached($cacheKey, $payload);
    emitJson($payload, 200, 's-maxage=600, stale-while-revalidate');
    exit;
}

// --- List mode ---
$pages = pagasaPages();
if (!isset($pages[$page])) {
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'Unknown page. Valid: ' . implode(', ', array_keys($pages))], 400, 'no-store');
    exit;
}
$source = PAGASA_BASE . $pages[$page]['path'];
$cacheKey = 'page:' . $page;
$cached = getCached($cacheKey);
if ($cached !== null) {
    emitJson($cached, 200, 's-maxage=600, stale-while-revalidate');
    exit;
}
$scrape = fetchPagasaPage($source);
if (!$scrape['ok']) {
    $stale = getCachedAny($cacheKey);
    if ($stale !== null) {
        emitJson($stale, 200, 's-maxage=600, stale-while-revalidate');
        exit;
    }
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => $scrape['error']], 200, 'no-store');
    exit;
}
try {
    $result = $pages[$page]['type'] === 'article'
        ? extractArticle($scrape['body'], $source)
        : extractListing($scrape['body'], $source);
} catch (Throwable $e) {
    emitJson(['success' => false, 'count' => 0, 'data' => [], 'error' => 'extract: ' . $e->getMessage()], 500, 'no-store');
    exit;
}
$payload = [
    'success' => true,
    'page' => $page,
    'source' => $source,
    'issued' => $result['issued'],
    'notice' => $result['notice'],
    'count' => count($result['items']),
    'data' => $result['items'],
];
setCached($cacheKey, $payload);
emitJson($payload, 200, 's-maxage=600, stale-while-revalidate');

/**
 * Emit a JSON response.
 */
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

function msNow(): int {
    return (int)round(microtime(true) * 1000);
}

/**
 * Fetch a PAGASA page. Returns ['ok'=>bool,'body'=>?string,'error'=>string].
 */
function fetchPagasaPage(string $targetUrl): array {
    $ch = curl_init($targetUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_USERAGENT, PAGASA_UA);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    curl_setopt($ch, CURLOPT_TIMEOUT, PAGASA_FETCH_TIMEOUT);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch);
    curl_close($ch);

    if ($body === false || $err) {
        return ['ok' => false, 'body' => null, 'error' => 'Unable to reach PAGASA'];
    }
    if ($code >= 400) {
        return ['ok' => false, 'body' => null, 'error' => 'PAGASA responded with ' . $code];
    }
    return ['ok' => true, 'body' => (string)$body, 'error' => ''];
}

// ---------- DOM helpers (DOMDocument handles PAGASA's nested markup
// far more reliably than regexes) ----------

function loadDom(string $html): DOMDocument {
    $dom = new DOMDocument();
    @$dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    return $dom;
}

/** First node with the class, or null. */
function findByClass(DOMXPath $xp, DOMNode $ctx, string $class): ?DOMNode {
    $nodes = $xp->query(".//*[contains(concat(' ', normalize-space(@class), ' '), ' $class ')]", $ctx);
    if ($nodes === false || $nodes->length === 0) return null;
    return $nodes->item(0);
}

/** Clean visible text of a node: collapse whitespace, decode entities. */
function nodeText(?DOMNode $node): string {
    if ($node === null) return '';
    $t = html_entity_decode($node->textContent ?? '', ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = preg_replace('/\s+/u', ' ', $t);
    return trim((string)$t);
}

function capText(string $s, int $max): string {
    if (safeLen($s) > $max) return safeSubstrLen($s, $max) . '…';
    return $s;
}

function safeLen(string $s): int {
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
}

function safeSubstrLen(string $s, int $len): string {
    return function_exists('mb_substr') ? mb_substr($s, 0, $len, 'UTF-8') : substr($s, 0, $len);
}

/** Resolve href against the page URL (absolute, root-relative, page-relative). */
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
    } elseif (isset($p['path'])) {
        $dir = $p['path'];
    }
    return $origin . $dir . $href;
}

/** "Issued at: ..." stamp finder inside a scope node. */
function findIssued(DOMXPath $xp, DOMNode $scope): string {
    $nodes = $xp->query('.//*[contains(@class, "issue")]', $scope);
    if ($nodes !== false) {
        foreach ($nodes as $n) {
            if (preg_match('/Issued at:\s*(.+)/i', nodeText($n), $m)) {
                return capText(trim($m[1]), 80);
            }
        }
    }
    return '';
}

/**
 * Article parser (daily-forecast style pages): issued stamp + synopsis
 * panels + h3 sections with their tables, flattened to items.
 * Returns ['issued'=>string,'notice'=>string,'items'=>array].
 */
function extractArticle(string $html, string $pageUrl): array {
    $dom = loadDom($html);
    $xp = new DOMXPath($dom);
    $scope = findByClass($xp, $dom, 'article-content');
    if ($scope === null) $scope = $dom;

    $issued = findIssued($xp, $scope);
    $items = [];

    // Synopsis panels: heading + body text.
    $panels = $xp->query(".//div[contains(concat(' ', normalize-space(@class), ' '), ' panel ')]", $scope);
    if ($panels !== false) {
        foreach ($panels as $panel) {
            $head = $xp->query(".//*[contains(concat(' ', normalize-space(@class), ' '), ' panel-heading ')]", $panel);
            $body = $xp->query(".//*[contains(concat(' ', normalize-space(@class), ' '), ' panel-body ')]", $panel);
            $title = ($head !== false && $head->length > 0) ? nodeText($head->item(0)) : 'Synopsis';
            $text = ($body !== false && $body->length > 0) ? nodeText($body->item(0)) : nodeText($panel);
            $text = capText($text, 4000);
            if ($text !== '') $items[] = ['title' => capText($title, 120), 'text' => $text, 'url' => $pageUrl];
        }
    }

    // h3 sections + their tables (forecast grids, tides, ...).
    $heads = $xp->query('.//h3', $scope);
    if ($heads !== false) {
        foreach ($heads as $h) {
            $title = nodeText($h);
            if ($title === '') continue;
            $lines = [];
            for ($sib = $h->nextSibling; $sib !== null; $sib = $sib->nextSibling) {
                if ($sib->nodeType !== XML_ELEMENT_NODE) continue;
                $tag = strtolower($sib->nodeName);
                if ($tag === 'h3' || $tag === 'h2') break;
                if ($tag === 'table') {
                    $rows = $xp->query('.//tr', $sib);
                    if ($rows !== false) {
                        foreach ($rows as $tr) {
                            $cells = [];
                            foreach ($tr->childNodes as $c) {
                                if ($c->nodeType !== XML_ELEMENT_NODE) continue;
                                $ct = strtolower($c->nodeName);
                                if ($ct === 'td' || $ct === 'th') {
                                    $t = nodeText($c);
                                    if ($t !== '') $cells[] = $t;
                                }
                            }
                            if (count($cells) > 0) $lines[] = implode(' | ', $cells);
                        }
                    }
                } elseif ($tag === 'p' || $tag === 'div' || $tag === 'ul') {
                    $t = nodeText($sib);
                    if ($t !== '') $lines[] = $t;
                }
                if (count($lines) >= 40) break;
            }
            if (count($lines) > 0) {
                $items[] = ['title' => capText($title, 120), 'text' => capText(implode("\n", $lines), 6000), 'url' => $pageUrl];
            }
        }
    }

    // PDF attachment (full bulletin PDF icon link).
    $links = $xp->query('.//a[@href]', $scope);
    if ($links !== false) {
        foreach ($links as $a) {
            $href = resolveLink((string)$a->getAttribute('href'), $pageUrl);
            if ($href !== '' && preg_match('/\.pdf(\?|#|$)/i', $href)) {
                $items[] = ['title' => 'Full bulletin (PDF)', 'text' => '', 'url' => $href];
                break;
            }
        }
    }

    return ['issued' => $issued, 'notice' => '', 'items' => array_slice($items, 0, 20)];
}

/** True when the node sits inside site chrome (nav/sidebar/footer), whose
 *  links would otherwise pollute listing output as fake items. */
function inChrome(?DOMNode $node, DOMNode $scope): bool {
    $n = ($node === null) ? null : $node->parentNode;
    for (; $n !== null && $n !== $scope; $n = $n->parentNode) {
        if ($n->nodeType !== XML_ELEMENT_NODE) continue;
        $cls = ($n instanceof DOMElement) ? (string)$n->getAttribute('class') : '';
        if (preg_match('/\b(nav|navbar|sidebar|footer|header|menu|dropdown|gov-ph)\b/i', $cls)) return true;
        $tag = strtolower($n->nodeName);
        if ($tag === 'nav' || $tag === 'footer' || $tag === 'header') return true;
    }
    return false;
}

/**
 * Listing parser (bulletin/advisory/gale/flood pages): the "no active"
 * notice when idle, else content links + embedded iframes as items.
 * Returns ['issued'=>string,'notice'=>string,'items'=>array].
 */
function extractListing(string $html, string $pageUrl): array {
    $dom = loadDom($html);
    $xp = new DOMXPath($dom);
    $scope = findByClass($xp, $dom, 'article-content');
    if ($scope === null) $scope = $dom;

    $issued = findIssued($xp, $scope);
    $scopeText = nodeText($scope);
    $notice = '';
    if (preg_match('/No Active[^.]{0,120}Philippine Area of Responsibility[^.]*/i', $scopeText, $m)) {
        $notice = capText(trim($m[0]), 200);
    }

    $items = [];
    $seen = [];
    // Embedded viewers (the TC advisory page is an iframe shell).
    $frames = $xp->query('.//iframe[@src]', $scope);
    if ($frames !== false) {
        foreach ($frames as $f) {
            $src = resolveLink((string)$f->getAttribute('src'), $pageUrl);
            if ($src === '' || isset($seen[$src])) continue;
            $seen[$src] = true;
            $items[] = ['title' => 'Embedded advisory viewer', 'text' => '', 'url' => $src];
        }
    }
    // Content links: same-host pages, PDFs, pubfiles assets. Nav/sidebar
    // links resolve to the same menu everywhere, so require the anchor to
    // carry real text and skip pure "#" targets.
    $links = $xp->query('.//a[@href]', $scope);
    if ($links !== false) {
        foreach ($links as $a) {
            if (inChrome($a, $scope)) continue;
            $raw = (string)$a->getAttribute('href');
            if ($raw === '' || $raw[0] === '#') continue;
            $url = resolveLink($raw, $pageUrl);
            if ($url === '' || isset($seen[$url])) continue;
            $host = parse_url($url, PHP_URL_HOST);
            if (!is_string($host) || (stripos($host, 'pagasa.dost.gov.ph') === false && stripos($host, 'pubfiles.pagasa') === false && stripos($host, 'shorturl.at') === false)) continue;
            $title = nodeText($a);
            if ($title === '' || safeLen($title) > 160) continue;
            // Skip site-chrome links (menus, logo, surveys, footers).
            if (preg_match('/survey|feedback|privacy|accessibility|contact us|home|govph|transparency/i', $title)) continue;
            $seen[$url] = true;
            $items[] = ['title' => $title, 'text' => '', 'url' => $url];
            if (count($items) >= 30) break;
        }
    }

    return ['issued' => $issued, 'notice' => $notice, 'items' => $items];
}

/**
 * Detail parser: title + issued + cleaned body text + outlinks of any page.
 * Returns { title, issued, text, links[] }.
 */
function extractDetail(string $html, string $pageUrl): array {
    $dom = loadDom($html);
    $xp = new DOMXPath($dom);
    $scope = findByClass($xp, $dom, 'article-content');
    if ($scope === null) $scope = $dom;

    $title = '';
    $titles = $xp->query('//title');
    if ($titles !== false && $titles->length > 0) $title = nodeText($titles->item(0));
    $h1 = $xp->query('.//h1', $scope);
    if ($h1 !== false && $h1->length > 0 && nodeText($h1->item(0)) !== '') {
        $title = nodeText($h1->item(0));
    }

    $text = capText(nodeText($scope), 8000);
    $links = [];
    $seen = [];
    $anchors = $xp->query('.//a[@href] | .//iframe[@src]', $scope);
    if ($anchors !== false) {
        foreach ($anchors as $a) {
            $raw = $a->nodeName === 'iframe' ? (string)$a->getAttribute('src') : (string)$a->getAttribute('href');
            $url = resolveLink($raw, $pageUrl);
            if ($url === '' || isset($seen[$url])) continue;
            $seen[$url] = true;
            $links[] = $url;
            if (count($links) >= 50) break;
        }
    }

    return [
        'title' => capText($title, 200),
        'issued' => findIssued($xp, $scope),
        'text' => $text,
        'links' => $links,
    ];
}

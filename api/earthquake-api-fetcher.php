<?php

// Enable CORS so the React app can access this from a different port
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

$isApi = basename(__FILE__) == basename($_SERVER["SCRIPT_FILENAME"]);

if ($isApi) {
    header('Content-Type: application/json');
}

// PHIVOLCS Website
$url = "https://earthquake.phivolcs.dost.gov.ph/";

// Initialize cURL
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
]);

$html = curl_exec($ch);

if (curl_errno($ch)) {
    $error = [
        "success" => false,
        "error" => curl_error($ch)
    ];
    if ($isApi) {
        die(json_encode($error));
    } else {
        return $error;
    }
}

curl_close($ch);

// Verify content exists
if (empty($html)) {
    $error = [
        "success" => false,
        "error" => "No HTML received."
    ];
    if ($isApi) {
        die(json_encode($error));
    } else {
        return $error;
    }
}

libxml_use_internal_errors(true);

$dom = new DOMDocument();
@$dom->loadHTML($html);

$xpath = new DOMXPath($dom);

// Find all table rows
$rows = $xpath->query("//table//tr");

$earthquakes = [];

foreach ($rows as $index => $row) {
    // Skip table header
    if ($index == 0) {
        continue;
    }

    $cols = $row->getElementsByTagName('td');

    if ($cols->length >= 6) {
        $link = '';
        $aTags = $cols->item(0)->getElementsByTagName('a');
        if ($aTags->length > 0) {
            $href = $aTags->item(0)->getAttribute('href');
            if ($href) {
                // Construct absolute URL if it's relative
                if (strpos($href, 'http') !== 0) {
                    $href = str_replace('\\', '/', $href);
                    $link = 'https://earthquake.phivolcs.dost.gov.ph/' . ltrim($href, '/');
                } else {
                    $link = $href;
                }
            }
        }

        $earthquakes[] = [
            'datetime'  => trim($cols->item(0)->textContent),
            'latitude'  => trim($cols->item(1)->textContent),
            'longitude' => trim($cols->item(2)->textContent),
            'depth'     => trim($cols->item(3)->textContent),
            'magnitude' => trim($cols->item(4)->textContent),
            'location'  => trim($cols->item(5)->textContent),
            'link'      => $link
        ];
    }
}

$response = [
    "success" => true,
    "count" => count($earthquakes),
    "data" => $earthquakes
];

if ($isApi) {
    echo json_encode($response, JSON_PRETTY_PRINT);
} else {
    return $response;
}

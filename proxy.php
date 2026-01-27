<?php
/**
 * Centralized CORS Proxy for GEOINT
 * Usage: proxy.php?url=<encoded_url>
 * 
 * This proxy fetches external APIs server-side to bypass browser CORS restrictions.
 * Falls back gracefully with proper error messages.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Check for cURL
if (!function_exists('curl_init')) {
    echo json_encode(['error' => 'cURL extension not available']);
    exit;
}

// Get the target URL
$targetUrl = isset($_GET['url']) ? trim($_GET['url']) : '';

if (!$targetUrl) {
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

// Validate URL
if (!filter_var($targetUrl, FILTER_VALIDATE_URL)) {
    echo json_encode(['error' => 'Invalid URL']);
    exit;
}

// Optional: Whitelist allowed domains for security
$allowedDomains = [
    'opensky-network.org',
    'nominatim.openstreetmap.org',
    'celestrak.org',
    'globalfishingwatch.org',
    'telegeography.com',
    'submarinecablemap.com',
    'api.radiobrowser.info',
    'meshmap.net',
    'api.meshtastic.org',
    'map.meshcore.dev',
    'repeaterbook.com',
    'gdeltproject.org',
    'open-meteo.com',
    'geocoding-api.open-meteo.com',
    'gamma-api.polymarket.com',
    'ipapi.co',
    // Solana RPC and related APIs
    'solana.drpc.org',
    'api.mainnet-beta.solana.com',
    'rpc.ankr.com',
    'api.coingecko.com',
    'pumpportal.fun'
];

$parsedUrl = parse_url($targetUrl);
$host = $parsedUrl['host'] ?? '';

// Check domain whitelist (comment out for unrestricted access)
$isAllowed = false;
foreach ($allowedDomains as $domain) {
    if (stripos($host, $domain) !== false) {
        $isAllowed = true;
        break;
    }
}

if (!$isAllowed) {
    echo json_encode(['error' => 'Domain not whitelisted: ' . $host]);
    exit;
}

// Perform the request
$ch = curl_init();

// Build headers array
$headers = [
    'Accept: application/json, text/plain, */*',
    'Accept-Language: en-US,en;q=0.9'
];

// Forward Authorization header if present
if (isset($_GET['auth'])) {
    $headers[] = 'Authorization: Bearer ' . $_GET['auth'];
}

curl_setopt_array($ch, [
    CURLOPT_URL => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_USERAGENT => 'GEOINT/1.0 (https://geoint.world)',
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_HTTPHEADER => $headers
]);

// Forward POST data if present
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $postData = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
    $headers[] = 'Content-Type: application/json';
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
}

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

// Handle errors
if ($response === false) {
    http_response_code(502);
    echo json_encode([
        'error' => 'Proxy request failed: ' . $error,
        'url' => $targetUrl,
        'info' => curl_getinfo($ch)
    ]);
    exit;
}

if ($httpCode >= 400) {
    http_response_code($httpCode);
    echo json_encode(['error' => 'Upstream returned HTTP ' . $httpCode, 'response' => substr($response, 0, 500)]);
    exit;
}

// Set appropriate content type
if ($contentType) {
    header('Content-Type: ' . $contentType);
}

// Return the response
echo $response;
?>
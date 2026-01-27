// --- Core System Variables & Configuration ---

// DOM Elements
const consoleOutput = document.getElementById('console-output');
const consoleWrapper = document.getElementById('console-wrapper');
const consoleTitle = document.getElementById('console-title');
const flightToggle = document.getElementById('flight-toggle');
const spaceToggle = document.getElementById('space-toggle');
const trailsToggle = document.getElementById('trails-toggle');
const shipToggle = document.getElementById('ship-toggle');
const radioToggle = document.getElementById('radio-toggle');
const cablesToggle = document.getElementById('cables-toggle');
const meshToggle = document.getElementById('mesh-toggle');
const satellitesToggle = document.getElementById('satellites-toggle');
const stationsToggle = document.getElementById('stations-toggle');
const debrisToggle = document.getElementById('debris-toggle');
const flightSubOptions = document.getElementById('flight-sub-options');
const spaceSubOptions = document.getElementById('space-sub-options');
const shipSubOptions = document.getElementById('ship-sub-options');
const radioSubOptions = document.getElementById('radio-sub-options');
const meshSubOptions = document.getElementById('mesh-sub-options');
const gdeltToggle = document.getElementById('gdelt-toggle');
const polymarketToggle = document.getElementById('polymarket-toggle');
const earthquakeToggle = document.getElementById('earthquake-toggle');

// Sub-Toggles
const shipGapToggle = document.getElementById('ship-gap-toggle');
const shipEncounterToggle = document.getElementById('ship-encounter-toggle');
const shipLoiteringToggle = document.getElementById('ship-loitering-toggle');
const shipFishingToggle = document.getElementById('ship-fishing-toggle');
const shipPortToggle = document.getElementById('ship-port-toggle');
const radioStationsToggle = document.getElementById('radio-stations-toggle');
const repeatersToggle = document.getElementById('repeaters-toggle');
const meshtasticToggle = document.getElementById('meshtastic-toggle');
const meshcoreToggle = document.getElementById('meshcore-toggle');

// Satellite filter toggles
const filterWeather = document.getElementById('filter-weather');
const filterNoaa = document.getElementById('filter-noaa');
const filterGps = document.getElementById('filter-gps');
const filterGlonass = document.getElementById('filter-glonass');
const filterGalileo = document.getElementById('filter-galileo');
const filterBeidou = document.getElementById('filter-beidou');
const filterCubesat = document.getElementById('filter-cubesat');
const filterOneweb = document.getElementById('filter-oneweb');
const filterPlanet = document.getElementById('filter-planet');
const filterStarlink = document.getElementById('filter-starlink');
const filterOther = document.getElementById('filter-other');

// Poll Controls
const pollValueDisplay = document.getElementById('poll-value');
const stepBtn = document.getElementById('step-btn');
const spacePollValueDisplay = document.getElementById('space-poll-value');
const spaceStepBtn = document.getElementById('space-step-btn');
const shipPollValueDisplay = document.getElementById('ship-poll-value');
const shipStepBtn = document.getElementById('ship-step-btn');

// --- Config State ---
let currentPollMs = 60000; // Default 1 minute
let currentStepMs = 10000; // Default 10 seconds
let currentSpacePollMs = 30000; // Default 30 seconds
let currentSpaceStepMs = 10000; // Default 10 seconds
let currentShipPollMs = 300000; // Default 5 minutes
let currentShipStepMs = 60000; // Default 1 minute
let currentRadioPollMs = 300000; // Default 5 minutes
let currentRadioStepMs = 60000; // Default 1 minute
let currentQuakePollMs = 300000; // Default 5 minutes
let currentQuakeStepMs = 60000; // Default 1 minute
let useMetric = true; // Default: Metric system
const stepOptions = [1000, 5000, 10000, 30000, 60000];
const spacePollOptions = [1000, 2000, 5000, 10000, 30000]; // Kept for reference if needed

let flightInterval = null;
let spaceInterval = null;
let shipInterval = null;
let radioInterval = null;
let earthquakeFeedInterval = null;
let cablesLoaded = false;
let flightPaths = {}; // Memory bank for trails
let entityLimit = 300000; // Max entities to load
let unlimitedMode = false; // Safety override

// --- Shared Network Configuration ---
// PHP Proxy (primary - self-hosted, reliable)
const PHP_PROXY = 'proxy.php?url=';

// Third-party CORS proxies (fallback)
const PROXY_SERVICES = [
    { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' },
    { url: 'https://api.allorigins.win/raw?url=', name: 'allorigins' },
    { url: 'https://corsproxy.io/?', name: 'corsproxyio' }
];

// Legacy aliases for backward compatibility
const CORS_PROXY = 'https://corsproxy.io/?';
const MESH_PROXIES = PROXY_SERVICES;
const SOLANA_RPCS = ['https://solana.drpc.org', 'https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'];
const PROXY_TIMEOUT_MS = 15000;

/**
 * Fetch with proxy chain: Third-party CORS proxies first, PHP proxy as final fallback
 * @param {string} targetUrl - The URL to fetch
 * @param {object} options - Fetch options (optional)
 * @param {boolean} phpOnly - Skip third-party and go straight to PHP (optional)
 * @param {boolean} thirdPartyOnly - Skip PHP proxy entirely, only use third-party CORS proxies (optional)
 * @returns {Promise<Response>} - Fetch response with proxySource property
 */
async function fetchWithProxyChain(targetUrl, options = {}, phpOnly = false, thirdPartyOnly = false) {
    const timeout = options.timeout || PROXY_TIMEOUT_MS;

    // Helper to fetch with timeout
    const fetchWithTimeout = (url, opts) => Promise.race([
        fetch(url, opts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
    ]);

    // 1. Try third-party proxies first (unless phpOnly is true)
    if (!phpOnly) {
        for (const proxy of PROXY_SERVICES) {
            try {
                const proxyUrl = proxy.url + encodeURIComponent(targetUrl);
                const response = await fetchWithTimeout(proxyUrl, options);
                if (response.ok) {
                    const text = await response.text();

                    // Validate: Skip if HTML returned instead of data
                    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                        console.warn(`FETCH: ${proxy.name} returned HTML instead of data, skipping...`);
                        continue;
                    }

                    // Smoke test for JSON if the URL looks like an API
                    try {
                        if (targetUrl.includes('json') || targetUrl.includes('states/all') || targetUrl.includes('api')) {
                            JSON.parse(text);
                        }
                    } catch (jsonErr) {
                        console.warn(`FETCH: ${proxy.name} returned invalid JSON, skipping...`);
                        continue;
                    }

                    console.log(`FETCH: ${proxy.name} proxy success`);
                    const res = new Response(text, { status: 200, headers: response.headers });
                    res.proxySource = proxy.name;
                    return res;
                } else {
                    console.warn(`FETCH: ${proxy.name} proxy response not OK: ${response.status}`);
                }
            } catch (e) {
                console.warn(`FETCH: Proxy ${proxy.name} failed:`, e.message);
            }
        }
    }

    // 2. Try PHP proxy as final fallback (unless thirdPartyOnly is true)
    if (!thirdPartyOnly) {
        try {
            const phpUrl = PHP_PROXY + encodeURIComponent(targetUrl);
            const response = await fetchWithTimeout(phpUrl, options);
            if (response.ok) {
                const text = await response.text();
                // Check if PHP proxy returned an error object
                if (text.startsWith('{') && text.includes('"error"')) {
                    const err = JSON.parse(text);
                    if (err.error) {
                        console.warn(`FETCH: PHP proxy returned JSON error: ${err.error}`);
                        throw new Error(err.error);
                    }
                }
                console.log('FETCH: PHP proxy success (fallback)');
                const res = new Response(text, { status: 200, headers: response.headers });
                res.proxySource = 'php';
                return res;
            } else {
                const errText = await response.text();
                console.warn(`FETCH: PHP proxy response not OK: ${response.status}. Body: ${errText.substring(0, 200)}`);
                if (typeof logSystem === 'function') {
                    logSystem(`ERR: PHP Proxy ${response.status} - ${errText.substring(0, 50)}`);
                }
            }
        } catch (e) {
            console.warn('FETCH: PHP proxy failed:', e.message);
        }
    }

    // 3. All proxies failed
    throw new Error('All proxy methods failed for: ' + targetUrl);
}

// Tokens
const gfwToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtpZEtleSJ9.eyJkYXRhIjp7Im5hbWUiOiJHRU9PU0lOVCIsInVzZXJJZCI6NTM5NzUsImFwcGxpY2F0aW9uTmFtZSI6IkdFT09TSU5UIiwiaWQiOjM4NTksInR5cGUiOiJ1c2VyLWFwcGxpY2F0aW9uIn0sImlhdCI6MTc2NTE4NzI2MiwiZXhwIjoyMDgwNTQ3MjYyLCJhdWQiOiJnZnciLCJpc3MiOiJnZncifQ.YT2lu3U1xwPOc1Vn5MIOsMIAPxBbM8_qsexKJQnFDUrHg5qJNuuiHRwnvoujmJMJIragZaELdQcg9Dl20kLc1BTHkzD_q6wui75Ko7SCxhImKlSCo1dOG5bsyPZ36FpKQY_EYztlWrymxMIFz1p_qDVWUfxhg7_fVFtTdIiAQaT91jlOPRJxNiiK2z94RahnpyIQXJOyfWdsPlUj3mzZWy1VT-iXdcNVldw4GdgNybASR6yTu_ikgKoDwWH9Nfe0NkKd5PDdytUgjyYS6kQnBnZCEz6yr07yRFvhk8dBNbJvgKbzX5P1PmjylldlgsUdFyNg8MKE2o0kqNBdMTNCzmoCIK8K8ZNwCSQ-_oDoU5kpOdHxRY5qldnzPl8NgqIPjngCPMBYIu49YSPF3qvNDIVMMmfU-IdT9JSSkTV4fTbHOdsNq4ZwJi_v8AdX3FNfMQ3KnsUxF__QcpE4JxxtB-XW_Bbv3sZzyBtSyz50K_KV2OLTzTmNNSIKmWOe7GEQ";

// Map Instance Placeholder (Initialized in map.js)
let map;
let searchMarker = null;
let searchDebounce;

// Current popup tracking for unit conversion
let currentPopup = null;
let currentPopupFeature = null;
let currentPopupLayer = null;

// Globe toggle state
let isGlobeMode = false;

// Flag to prevent camera movements during data updates
let isUpdatingData = false;

// --- Global Data Worker Initialization (Shared) ---
try {
    window.dataWorker = new Worker('js/data-worker.js?v=115');
    console.log('SYS: Global Data Worker initialized.');
} catch (e) {
    console.error('SYS: Failed to initialize data worker:', e);
}

// --- Earthquake Data Module (USGS) ---

// Globals
let earthquakeData = [];
let earthquakeInterval = null;
let earthquakeTimeframe = 'hour';
let earthquakeMinMagnitude = 2.5;

// Initialize earthquake source and layer
function initEarthquakeLayer() {
    if (!map || !map.isStyleLoaded()) {
        setTimeout(initEarthquakeLayer, 500);
        return;
    }

    // Add source if not exists
    if (!map.getSource('earthquake-data')) {
        map.addSource('earthquake-data', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: earthquakeData || [] }
        });
    }

    // Add circle layer for earthquakes
    if (!map.getLayer('earthquake-circles')) {
        map.addLayer({
            id: 'earthquake-circles',
            type: 'circle',
            source: 'earthquake-data',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['get', 'mag'],
                    2.5, 4,
                    4.0, 8,
                    5.0, 12,
                    6.0, 18,
                    7.0, 25,
                    8.0, 35
                ],
                'circle-color': [
                    'interpolate', ['linear'], ['get', 'mag'],
                    2.5, '#fbbf24',
                    4.0, '#fb923c',
                    5.0, '#ef4444',
                    6.0, '#dc2626',
                    7.0, '#991b1b'
                ],
                'circle-opacity': 0.7,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': 0.5
            }
        });
    }

    // Add pulsing effect layer for recent earthquakes
    if (!map.getLayer('earthquake-pulse')) {
        map.addLayer({
            id: 'earthquake-pulse',
            type: 'circle',
            source: 'earthquake-data',
            filter: ['>', ['get', 'mag'], 5.0],
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['get', 'mag'],
                    5.0, 20,
                    6.0, 30,
                    7.0, 40,
                    8.0, 55
                ],
                'circle-color': 'transparent',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ef4444',
                'circle-stroke-opacity': [
                    'interpolate', ['linear'], ['%', ['/', ['to-number', ['get', 'time']], 1000], 2],
                    0, 0.8,
                    1, 0.2,
                    2, 0.8
                ]
            }
        }, 'earthquake-circles');
    }

    // Click handler for earthquake popups
    map.on('click', 'earthquake-circles', (e) => {
        if (e.features.length === 0) return;
        const feature = e.features[0];
        const props = feature.properties;
        const coords = feature.geometry.coordinates;

        showEarthquakePopup(props, [coords[0], coords[1]]);
    });

    // Cursor change on hover
    map.on('mouseenter', 'earthquake-circles', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'earthquake-circles', () => {
        map.getCanvas().style.cursor = '';
    });

    logSystem('QUAKE: Earthquake layer initialized.');
}

// Build USGS API URL
function buildEarthquakeUrl() {
    const base = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
    let magPart = 'all';

    if (earthquakeMinMagnitude >= 4.5) magPart = '4.5';
    else if (earthquakeMinMagnitude >= 2.5) magPart = '2.5';
    else if (earthquakeMinMagnitude >= 1.0) magPart = '1.0';

    return `${base}${magPart}_${earthquakeTimeframe}.geojson`;
}

// Fetch earthquake data from USGS
async function fetchEarthquakes() {
    const url = buildEarthquakeUrl();

    try {
        logSystem(`QUAKE: Fetching from USGS [${earthquakeTimeframe}, M${earthquakeMinMagnitude}+]...`);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        if (!data.features) {
            logSystem('QUAKE: No earthquake data in response.');
            return;
        }

        // Filter by minimum magnitude (API may return more than requested)
        const filtered = data.features.filter(f => f.properties.mag >= earthquakeMinMagnitude);

        // Fallback: If 1H yielded no results, auto-switch to 24H (Day)
        if (filtered.length === 0 && earthquakeTimeframe === 'hour') {
            logSystem('QUAKE: No earthquakes found in last hour. Extending search to 24h...');
            earthquakeTimeframe = 'day';

            // Update UI buttons to reflect change
            const btns = document.querySelectorAll('.quake-time-btn');
            btns.forEach(b => {
                if (b.dataset.value === 'day') b.classList.add('active');
                else b.classList.remove('active');
            });

            // Re-fetch with new timeframe
            return fetchEarthquakes();
        }

        // Convert to our format
        earthquakeData = filtered.map(f => ({
            ...f,
            properties: {
                ...f.properties,
                // Flatten depth for easier access
                depth: f.geometry.coordinates[2]
            }
        }));

        // Update map source
        if (map.getSource('earthquake-data')) {
            map.getSource('earthquake-data').setData({
                type: 'FeatureCollection',
                features: earthquakeData
            });
        }

        // Find stats
        const mags = earthquakeData.map(f => f.properties.mag);
        const strongest = mags.length ? Math.max(...mags).toFixed(1) : 'N/A';

        logSystem(`QUAKE: Loaded ${earthquakeData.length} earthquakes. Strongest: M${strongest}`);

    } catch (error) {
        logSystem(`QUAKE ERR: ${error.message}`);
        console.error('Earthquake fetch error:', error);
    }
}

// Format time ago
function formatTimeAgo(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// Show earthquake popup
function showEarthquakePopup(props, coords) {
    const mag = props.mag?.toFixed(1) || 'N/A';
    const place = props.place || 'Unknown location';
    const depth = props.depth?.toFixed(1) || 'N/A';
    const time = formatTimeAgo(props.time);
    const usgsUrl = props.url || '#';

    const html = `
        <div class="popup-row"><span class="popup-label">MAGNITUDE:</span> <span style="color: ${getMagColor(props.mag)}; font-weight: bold;">M${mag}</span></div>
        <div class="popup-row"><span class="popup-label">LOCATION:</span> ${place}</div>
        <div class="popup-row"><span class="popup-label">DEPTH:</span> ${depth} km</div>
        <div class="popup-row"><span class="popup-label">TIME:</span> ${time}</div>
        <div class="popup-row"><span class="popup-label">COORDS:</span> ${coords[1].toFixed(3)}, ${coords[0].toFixed(3)}</div>
        <a href="${usgsUrl}" target="_blank" class="intel-btn" style="display: block; text-align: center; margin-top: 10px;">[ USGS DETAILS ]</a>
    `;

    createTrackedPopup(html, coords, 'earthquake-circles', props);
}

// Get magnitude color
function getMagColor(mag) {
    if (mag >= 7.0) return '#991b1b';
    if (mag >= 6.0) return '#dc2626';
    if (mag >= 5.0) return '#ef4444';
    if (mag >= 4.0) return '#fb923c';
    return '#fbbf24';
}

// Update earthquake layer visibility
function updateEarthquakeVisibility(visible) {
    ['earthquake-circles', 'earthquake-pulse'].forEach(layer => {
        if (map.getLayer(layer)) {
            map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

// Cleanup
function cleanupEarthquakes() {
    if (earthquakeInterval) {
        clearInterval(earthquakeInterval);
        earthquakeInterval = null;
    }
    earthquakeData = [];
    if (map.getSource('earthquake-data')) {
        map.getSource('earthquake-data').setData({ type: 'FeatureCollection', features: [] });
    }
    updateEarthquakeVisibility(false);
}

// Expose to global
window.initEarthquakeLayer = initEarthquakeLayer;
window.fetchEarthquakes = fetchEarthquakes;
window.cleanupEarthquakes = cleanupEarthquakes;
window.updateEarthquakeVisibility = updateEarthquakeVisibility;
window.earthquakeTimeframe = earthquakeTimeframe;
window.earthquakeMinMagnitude = earthquakeMinMagnitude;
window.showEarthquakePopup = showEarthquakePopup;
window.earthquakeData = earthquakeData;

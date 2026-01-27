// --- Space Data Logic ---
let tleCache = null;
let lastTleFetch = 0;
let stationsCache = null;
let debrisCache = null;
let lastCategoryFetch = 0;
let satelliteData = new Map(); // Store satellite data for counting

// Expose caches to window for cache size calculation
exposeCache('tleCache', () => tleCache);
exposeCache('stationsCache', () => stationsCache);
exposeCache('debrisCache', () => debrisCache);


async function fetchTLEGroup(group, label) {
    try {
        const resp = await fetchData(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { useProxy: true });
        const proxySource = resp.proxySource;
        const sourceLabel = proxySource === 'php' ? 'BACKEND' : (proxySource ? `THIRD-PARTY (${proxySource})` : 'UNKNOWN');
        logSystem(`NET: ${label} (CelesTrak) via ${sourceLabel}`);
        if (!resp.ok) return [];

        const text = await resp.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);

        const tleData = [];
        for (let i = 0; i < lines.length; i += 3) {
            if (i + 2 < lines.length) {
                tleData.push({
                    name: lines[i].trim(),
                    line1: lines[i + 1].trim(),
                    line2: lines[i + 2].trim(),
                    category: label
                });
            }
        }
        return tleData;
    } catch (e) {
        console.error(`Error fetching ${label}:`, e);
        return [];
    }
}

function categorizeSatellite(name) {
    const nameUpper = name.toUpperCase();

    if (nameUpper.includes('NOAA')) return 'NOAA';
    if (nameUpper.includes('GOES') || nameUpper.includes('METEOSAT') || nameUpper.includes('HIMAWARI')) return 'WEATHER';
    if (nameUpper.includes('GPS') || nameUpper.includes('NAVSTAR')) return 'GPS';
    if (nameUpper.includes('GLONASS')) return 'GLONASS';
    if (nameUpper.includes('GALILEO')) return 'GALILEO';
    if (nameUpper.includes('BEIDOU') || nameUpper.includes('COMPASS')) return 'BEIDOU';
    if (nameUpper.includes('CUBESAT') || nameUpper.includes('CUBESAT')) return 'CUBESAT';
    if (nameUpper.includes('STARLINK')) return 'STARLINK';
    if (nameUpper.includes('ONEWEB')) return 'ONEWEB';
    if (nameUpper.includes('PLANET') || nameUpper.includes('DOVE')) return 'PLANET';

    return 'OTHER';
}

async function fetchSpace() {
    // Validate toggle and clear if off
    if (!validateToggle('space-toggle', () => MapLayerManager.clearLayerData('space-data'))) {
        return;
    }

    updateLoadingStatus('LOADING SPACE DATA...', 'text-dim');

    try {
        const now = Date.now();
        const time = new Date();
        const gmst = satellite.gstime(time);

        // Fetch Active Satellites - only if satellites toggle is enabled
        if (satellitesToggle && satellitesToggle.checked && (!tleCache || (now - lastTleFetch > 3600000))) {
            const resp = await fetchData('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle', { useProxy: true });

            // Log which proxy was used
            const proxySource = resp.proxySource;
            const sourceLabel = proxySource === 'php' ? 'BACKEND' : (proxySource ? `THIRD-PARTY (${proxySource})` : 'UNKNOWN');
            logSystem(`NET: Satellites (CelesTrak) via ${sourceLabel}`);

            // Check if toggle was turned off during fetch
            if (!spaceToggle || !spaceToggle.checked) {
                MapLayerManager.clearLayerData('space-data');
                hideStatus();
                return;
            }

            if (!resp.ok) {
                const errorText = await resp.text();
                console.error('CelesTrak API Error:', {
                    status: resp.status,
                    statusText: resp.statusText,
                    url: resp.url,
                    response: errorText
                });
                throw new Error(`CelesTrak API ${resp.status}: ${resp.statusText}`);
            }

            const text = await resp.text();
            const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);

            const tleData = [];
            for (let i = 0; i < lines.length; i += 3) {
                if (i + 2 < lines.length) {
                    tleData.push({
                        name: lines[i].trim(),
                        line1: lines[i + 1].trim(),
                        line2: lines[i + 2].trim(),
                        category: 'SATELLITE'
                    });
                }
            }

            tleCache = tleData;
            lastTleFetch = now;
            logSystem(`NET: Active satellites catalog updated (${tleCache.length} objects).`);
        }

        // Fetch other categories if toggles are enabled
        if (stationsToggle && stationsToggle.checked && (!stationsCache || (now - lastCategoryFetch > 3600000))) {
            stationsCache = await fetchTLEGroup('stations', 'STATION');
            // Check if toggle was turned off during fetch
            if (!spaceToggle || !spaceToggle.checked) {
                MapLayerManager.clearLayerData('space-data');
                hideStatus();
                return;
            }
            logSystem(`NET: Space stations loaded (${stationsCache.length} objects).`);
        }

        if (debrisToggle && debrisToggle.checked && (!debrisCache || (now - lastCategoryFetch > 3600000))) {
            debrisCache = await fetchTLEGroup('last-30-days', 'DEBRIS');
            // Check if toggle was turned off during fetch
            if (!spaceToggle || !spaceToggle.checked) {
                MapLayerManager.clearLayerData('space-data');
                hideStatus();
                return;
            }
            logSystem(`NET: Other objects catalog loaded (${debrisCache.length} objects).`);
        }

        if ((stationsToggle && stationsToggle.checked) || (debrisToggle && debrisToggle.checked)) {
            lastCategoryFetch = now;
        }

        // Combine all enabled categories
        const allTLEs = [];

        if (satellitesToggle && satellitesToggle.checked && tleCache) {
            allTLEs.push(...tleCache);
        }
        if (stationsToggle && stationsToggle.checked && stationsCache) {
            allTLEs.push(...stationsCache);
        }
        if (debrisToggle && debrisToggle.checked && debrisCache) {
            allTLEs.push(...debrisCache);
        }

        if (allTLEs.length === 0) {
            MapLayerManager.clearLayerData('space-data');
            return;
        }

        // Process all objects
        const features = [];
        let count = 0;

        for (const item of allTLEs) {
            if (count >= entityLimit) break;

            // Filter satellites by category if filter is active
            if (item.category === 'SATELLITE') {
                const satCategory = categorizeSatellite(item.name);
                const satFilterMap = {
                    WEATHER: filterWeather,
                    NOAA: filterNoaa,
                    GPS: filterGps,
                    GLONASS: filterGlonass,
                    GALILEO: filterGalileo,
                    BEIDOU: filterBeidou,
                    CUBESAT: filterCubesat,
                    ONEWEB: filterOneweb,
                    PLANET: filterPlanet,
                    STARLINK: filterStarlink,
                    OTHER: filterOther
                };
                if (satFilterMap[satCategory] && !satFilterMap[satCategory].checked) continue;
            }

            // Parse TLE
            const satrec = satellite.twoline2satrec(item.line1, item.line2);

            // Propagate
            const posVel = satellite.propagate(satrec, time);
            const posEci = posVel.position;
            const velEci = posVel.velocity;

            // Check for propagation errors
            if (!posEci || !velEci) continue;

            // ECI to Geodetic
            const posGd = satellite.eciToGeodetic(posEci, gmst);

            // Convert Radians to Degrees / Km
            const lon = satellite.degreesLong(posGd.longitude);
            const lat = satellite.degreesLat(posGd.latitude);
            const altKm = posGd.height;

            // Simple velocity magnitude
            const velKmS = Math.sqrt(velEci.x * velEci.x + velEci.y * velEci.y + velEci.z * velEci.z);

            // Format Display Values
            let altDisplay, velDisplay;
            const isMetric = (typeof useMetric !== 'undefined') ? useMetric : true;
            if (isMetric) {
                altDisplay = Math.round(altKm) + " km";
                velDisplay = velKmS.toFixed(2) + " km/s";
            } else {
                altDisplay = Math.round(altKm * 0.621371) + " mi";
                velDisplay = (velKmS * 2236.94).toFixed(0) + " mph";
            }

            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [lon, lat] },
                properties: {
                    name: item.name,
                    id: item.line2.split(' ')[1],
                    type: item.category || "SATELLITE",
                    category: item.category === 'SATELLITE' ? categorizeSatellite(item.name) : item.category,
                    altitude: altDisplay,
                    velocity: velDisplay,
                    altitudeRaw: altKm,
                    velocityRaw: velKmS,
                    iconType: "space-icon"
                }
            });
            count++;
        }

        // Final check before setting data - ensure toggle is still on
        if (!spaceToggle || !spaceToggle.checked) {
            MapLayerManager.clearLayerData('space-data');
            hideStatus();
            return;
        }

        const geoJsonData = {
            type: "FeatureCollection",
            features: features
        };
        if (MapLayerManager.updateLayerData('space-data', geoJsonData)) {
            logSystem(`GUI: Space radar updated (${features.length} objects).`);
        }

        // Store satellite data for counting (only actual satellites, not stations/debris)
        satelliteData.clear();
        for (const feature of features) {
            // Only count items that are categorized satellites (not STATION or DEBRIS)
            if (feature.properties.category &&
                feature.properties.category !== 'STATION' &&
                feature.properties.category !== 'DEBRIS') {
                const satId = feature.properties.id || feature.properties.name;
                satelliteData.set(satId, {
                    category: feature.properties.category,
                    name: feature.properties.name
                });
            }
        }

        // Update filter modal counts
        updateSatelliteFilterCounts();
        hideStatus();
    } catch (err) {
        logSystem(`ERR: Space Feed Error - ${err.message}`);
        console.error('Space Data Fetch Error:', {
            error: err.message,
            stack: err.stack,
            name: err.name
        });
        hideStatus();
    }
}

function updateSatelliteFilterCounts() {
    // Count satellites by category
    const categoryCounts = {
        'WEATHER': 0,
        'NOAA': 0,
        'GPS': 0,
        'GLONASS': 0,
        'GALILEO': 0,
        'BEIDOU': 0,
        'CUBESAT': 0,
        'ONEWEB': 0,
        'PLANET': 0,
        'STARLINK': 0,
        'OTHER': 0
    };

    // Count satellites from stored data
    for (const sat of satelliteData.values()) {
        const category = sat.category || 'OTHER';
        if (categoryCounts.hasOwnProperty(category)) {
            categoryCounts[category]++;
        } else {
            categoryCounts['OTHER']++;
        }
    }

    // Update filter modal counts
    const categoryIdMap = {
        'WEATHER': 'count-weather',
        'NOAA': 'count-noaa',
        'GPS': 'count-gps',
        'GLONASS': 'count-glonass',
        'GALILEO': 'count-galileo',
        'BEIDOU': 'count-beidou',
        'CUBESAT': 'count-cubesat',
        'ONEWEB': 'count-oneweb',
        'PLANET': 'count-planet',
        'STARLINK': 'count-starlink',
        'OTHER': 'count-other'
    };

    Object.keys(categoryCounts).forEach(category => {
        const countElement = document.getElementById(categoryIdMap[category]);
        if (countElement) {
            countElement.textContent = `(${categoryCounts[category]})`;
        }
    });
}

// Expose function globally
window.updateSatelliteFilterCounts = updateSatelliteFilterCounts;

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
    let text = '';

    try {
        const resp = await fetchData(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { useProxy: true, thirdPartyOnly: true });
        if (resp.ok) {
            text = await resp.text();
            const proxySource = resp.proxySource || 'DIRECT';
            logSystem(`NET: ${label} (CelesTrak) via ${proxySource}`);
        } else {
            throw new Error(`Status ${resp.status}`);
        }
    } catch (e1) {
        // Fallback: CodeTabs
        try {
            logSystem(`NET: ${label} (Fallback to CodeTabs)...`);
            const fallbackUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`)}`;
            const resp = await fetch(fallbackUrl);
            if (!resp.ok) throw new Error(`CodeTabs ${resp.status}`);
            text = await resp.text();
            logSystem(`NET: ${label} restored via CodeTabs.`);
        } catch (e2) {
            console.error(`Error fetching ${label}:`, e1, e2);
            return [];
        }
    }

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
            let text = '';
            try {
                const resp = await fetchData('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle', { useProxy: true, thirdPartyOnly: true });
                if (resp.ok) {
                    text = await resp.text();
                    const proxySource = resp.proxySource || 'DIRECT';
                    logSystem(`NET: Satellites (CelesTrak) via ${proxySource}`);
                } else {
                    throw new Error(`Status ${resp.status}`);
                }
            } catch (e1) {
                console.warn('Primary satellite fetch failed, trying CodeTabs...', e1);
                try {
                    const fallbackUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle')}`;
                    const resp = await fetch(fallbackUrl);
                    if (!resp.ok) throw new Error(`CodeTabs ${resp.status}`);
                    text = await resp.text();
                    logSystem(`NET: Satellites restored via CodeTabs.`);
                } catch (e2) {
                    throw new Error(`Both primary and CodeTabs failed: ${e2.message}`);
                }
            }

            // Check if toggle was turned off during fetch
            if (!spaceToggle || !spaceToggle.checked) {
                MapLayerManager.clearLayerData('space-data');
                hideStatus();
                return;
            }

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

// Register with InscriptionRegistry
if (window.InscriptionRegistry) {
    window.InscriptionRegistry.register('space-objects', {
        hydrate: (data) => {
            if (typeof map === 'undefined' || !map) return null;
            const features = map.querySourceFeatures('space-data');
            // Try matching ID
            if (data.id) {
                return features.find(f => f.properties.id == data.id)?.properties;
            }
            if (data.name) {
                return features.find(f => f.properties.name == data.name)?.properties;
            }
            return null;
        },
        getMarker: (data) => {
            const svgs = {
                space: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect x="9" y="8" width="6" height="8" fill="#fff"/><rect x="1" y="9" width="6" height="6" fill="#fff"/><rect x="7" y="11" width="2" height="2" fill="#fff"/><rect x="17" y="9" width="6" height="6" fill="#fff"/><rect x="15" y="11" width="2" height="2" fill="#fff"/><rect x="11.5" y="4" width="1" height="4" fill="#fff"/><circle cx="12" cy="4" r="2" fill="#fff"/></svg>`
            };
            return {
                html: svgs.space,
                style: {
                    width: '24px',
                    height: '24px'
                }
            };
        },
        showPopup: (data, coords) => {
            const html = `
                <div class="popup-row"><span class="popup-label">NAME:</span> ${data.name || 'Unknown'}</div>
                <div class="popup-row"><span class="popup-label">ID:</span> ${data.id || 'N/A'}</div>
                <div class="popup-row"><span class="popup-label">TYPE:</span> ${data.category || 'SATELLITE'}</div>
                <div class="popup-row"><span class="popup-label">ALT:</span> ${data.altitude || (data.altitudeRaw ? Math.round(data.altitudeRaw) + ' km' : 'N/A')}</div>
                <div class="popup-row"><span class="popup-label">SPEED:</span> ${data.velocity || (data.velocityRaw ? data.velocityRaw.toFixed(2) + ' km/s' : 'N/A')}</div>
                <div style="margin-top:10px; text-align:center;">
                    <a href="https://www.n2yo.com/satellite/?s=${data.id}" target="_blank" class="intel-btn">[ TRACK ORBIT ]</a>
                </div>
            `;
            if (window.createPopup) {
                window.createPopup(coords, html, data, 'space-popup', { className: 'cyber-popup' });
            }
        }
    });
}

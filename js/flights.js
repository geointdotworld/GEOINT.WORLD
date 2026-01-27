// --- Flight Data Logic (OpenSky Network) ---

let flightFilters = {
    standard: true,
    military: true,
    pia: true,
    ladd: true,
    alert: true,
    ghost: true,
    nosquawk: true
};
let minFlightAltitude = 0;
let collectedSquawks = new Set();
let isSquawkExpanded = false;
flightFilters.selectedSquawks = [];

// Data Worker Listener
const throttledTrailUpdate = throttle(updateFlightTrailsLayer, 2000);
const throttledSquawkRender = throttle(renderSquawkTags, 5000);

if (window.dataWorker) {
    window.dataWorker.addEventListener('message', function (e) {
        const { type, result } = e.data;
        if (type === 'FLIGHTS_PROCESSED') {
            const { features, counts, batchSquawks } = result;

            // Update squawks set
            batchSquawks.forEach(sq => collectedSquawks.add(sq));

            // Update UI counts
            updateFlightFilterCounts(counts, window.lastTotalFetched || 0, features.length);
            throttledSquawkRender();

            // Update Map
            const geoJson = { type: "FeatureCollection", features: features };
            if (MapLayerManager.updateLayerData('opensky-data', geoJson)) {
                // Detailed logging
                let logMsg = `SCAN: ${features.length} targets.`;
                if (counts.helo > 0) logMsg += ` [HELOS: ${counts.helo}]`;
                if (counts.alert > 0) logMsg += ` [ALERTS: ${counts.alert}]`;
                logSystem(logMsg);

                if (counts.helo > 0) {
                    const firstHelo = features.find(f => f.properties.type === 'helo');
                    if (firstHelo) logSystem(`>> HELO CONTACT: ${firstHelo.properties.callsign}`);
                }

                logSystem("GUI: Aerial radar updated.");
                hideStatus();
            }

            if (trailsToggle.checked) throttledTrailUpdate();
        }
    });
}

window.flightFilters = flightFilters;
window.minFlightAltitude = minFlightAltitude;

// --- Initial Setup for Squawk Filter ---
document.addEventListener('DOMContentLoaded', () => {
    const squawkInput = document.getElementById('flight-squawk-input');
    if (squawkInput) {
        squawkInput.addEventListener('input', () => {
            // Force expand when searching
            if (squawkInput.value.trim() !== '') isSquawkExpanded = true;
            renderSquawkTags();
        });
    }
    const clearSquawkBtn = document.getElementById('squawk-clear-btn');
    if (clearSquawkBtn) {
        clearSquawkBtn.addEventListener('click', () => {
            flightFilters.selectedSquawks = [];
            isSquawkExpanded = false;
            renderSquawkTags();
            fetchFlights();
        });
    }
});

function toggleSquawk(sq) {
    const idx = flightFilters.selectedSquawks.indexOf(sq);
    if (idx > -1) {
        flightFilters.selectedSquawks.splice(idx, 1);
    } else {
        flightFilters.selectedSquawks.push(sq);
    }
    renderSquawkTags();
    fetchFlights();
}

function renderSquawkTags() {
    const list = document.getElementById('flight-squawk-list');
    const input = document.getElementById('flight-squawk-input');
    const btnContainer = document.getElementById('squawk-expand-btn-container');
    const clearBtn = document.getElementById('squawk-clear-btn');
    if (!list) return;

    if (clearBtn) {
        clearBtn.style.display = flightFilters.selectedSquawks.length > 0 ? 'inline' : 'none';
    }

    const searchTerm = input ? input.value.toLowerCase() : '';
    let squawks = Array.from(collectedSquawks).sort();

    // Filter by search
    if (searchTerm) {
        squawks = squawks.filter(sq => sq.toLowerCase().includes(searchTerm));
    }

    let html = '';
    const totalCount = squawks.length;

    // Handle Expansion Button in Header
    if (btnContainer) {
        if (totalCount > 5 && !searchTerm) {
            const label = isSquawkExpanded ? 'COLLAPSE' : `EXPAND<span class="mobile-hidden"> [${totalCount}]</span>`;
            btnContainer.innerHTML = `<button class="filter-toggle-btn" style="padding: 4px 8px; font-size: 11px; min-width: auto; flex: none;" onclick="isSquawkExpanded=${!isSquawkExpanded}; renderSquawkTags()">${label}</button>`;
        } else {
            btnContainer.innerHTML = '';
        }
    }

    // Optimization: Skip rendering if nothing has changed
    const expandedChanged = window._lastSquawkExpanded !== isSquawkExpanded;
    window._lastSquawkExpanded = isSquawkExpanded;

    // Check if selection changed
    const currentSelectionStr = JSON.stringify(flightFilters.selectedSquawks.sort());
    const selectionChanged = window._lastSquawkSelection !== currentSelectionStr;
    window._lastSquawkSelection = currentSelectionStr;

    if (!searchTerm && window._lastSquawkCount === totalCount && !expandedChanged && !selectionChanged) {
        return;
    }
    window._lastSquawkCount = totalCount;

    if (!isSquawkExpanded && !searchTerm && totalCount > 5) {
        // ... (Truncated View)
        const firstThree = squawks.slice(0, 3);
        const lastTwo = squawks.slice(-2);

        html += firstThree.map(sq => {
            const activeTag = flightFilters.selectedSquawks.includes(sq) ? 'active' : '';
            return `<div class="poly-tag ${activeTag}" onclick="toggleSquawk('${sq}')">${sq}</div>`;
        }).join('');

        html += `<div class="poly-tag" style="background: transparent; border: 1px dashed #331a00; color: #444; pointer-events: none;">...</div>`;

        html += lastTwo.map(sq => {
            const activeTag = flightFilters.selectedSquawks.includes(sq) ? 'active' : '';
            return `<div class="poly-tag ${activeTag}" onclick="toggleSquawk('${sq}')">${sq}</div>`;
        }).join('');
    } else {
        // Full View
        html = squawks.map(sq => {
            const activeTag = flightFilters.selectedSquawks.includes(sq) ? 'active' : '';
            return `<div class="poly-tag ${activeTag}" onclick="toggleSquawk('${sq}')">${sq}</div>`;
        }).join('');
    }

    list.innerHTML = html;
}

async function fetchFlights() {
    // Validate toggle and clear if off
    if (!validateToggle('flight-toggle', () => MapLayerManager.clearLayerData('opensky-data'))) {
        return;
    }

    try {
        updateLoadingStatus('LOADING FLIGHT DATA...', 'text-dim');
        logSystem("NET: Fetching flight data (OpenSky + ADS-B.lol)...");

        // Fetch 4 APIs in parallel
        const results = await Promise.allSettled([
            fetchData('https://opensky-network.org/api/states/all', { useProxy: true }),
            fetchData('https://api.adsb.lol/v2/mil', { useProxy: true }),
            fetchData('https://api.adsb.lol/v2/pia', { useProxy: true }),
            fetchData('https://api.adsb.lol/v2/ladd', { useProxy: true })
        ]);

        const [openSkyResult, milResult, piaResult, laddResult] = results;
        let mergedStates = new Map();
        let openSkyCount = 0;
        let adsbCount = 0;

        // --- Process OpenSky Data ---
        if (openSkyResult.status === 'fulfilled' && openSkyResult.value.ok) {
            try {
                const data = await openSkyResult.value.json();
                const proxySource = openSkyResult.value.proxySource || 'DIRECT';

                if (data.states) {
                    data.states.forEach(s => {
                        const icao = s[0];
                        // Tag as standard/OpenSky by default (cat=0/implicit)
                        mergedStates.set(icao, s);
                    });
                    openSkyCount = data.states.length;
                    logSystem(`NET: OpenSky data received (${openSkyCount} aircraft) via ${proxySource}`);
                }
            } catch (err) {
                console.error("OpenSky Parse Error:", err);
            }
        } else {
            const err = openSkyResult.reason || (openSkyResult.value ? `Status ${openSkyResult.value.status}` : 'Unknown Error');
            logSystem(`ERR: OpenSky fetch failed: ${err}`);
        }

        // Helper to normalize ADSB.lol to OpenSky format
        // specialCat overrides: 8=Military, 11=PIA, 12=LADD
        const processAdsbLol = async (result, sourceName, defaultCat, reportCount = true) => {
            if (result.status === 'fulfilled' && result.value.ok) {
                try {
                    const data = await result.value.json();
                    if (data.ac) {
                        data.ac.forEach(ac => {
                            const icao = ac.hex;

                            // Determine Category Priority
                            // Existing state?
                            let existing = mergedStates.get(icao);
                            let finalCat = defaultCat;

                            // Priority Logic: Military (8/9) > LADD (12) > PIA (11) > Standard (0)
                            // If we already have a Military record, keep it Military.
                            // If we have LADD record, keep it LADD unless this new feed is Military.
                            // If source is Military (defaultCat 8), force it.

                            if (existing) {
                                const existCat = existing[17] || 0;
                                // If existing is Military (8 or 9), don't downgrade to PIA/LADD
                                if (existCat === 8 || existCat === 9) {
                                    finalCat = existCat;
                                }
                                // If existing is LADD (12) and new is PIA (11), keep LADD
                                else if (existCat === 12 && defaultCat === 11) {
                                    finalCat = 12;
                                }
                                // If existing is PIA (11) and new is LADD (12), upgrade to LADD
                                else if (existCat === 11 && defaultCat === 12) {
                                    finalCat = 12;
                                }
                            }

                            // If this feed is Military, check for Rotorcraft
                            if (sourceName === 'MIL') {
                                if (ac.category === "A7") finalCat = 9; // Rotorcraft
                                else finalCat = 8; // Generic Mil
                            }

                            const callsign = ac.flight ? ac.flight.trim() : "";
                            const lat = ac.lat;
                            const lon = ac.lon;

                            // Unit Conversions
                            const altBaro = ac.alt_baro === "ground" ? 0 : (typeof ac.alt_baro === 'number' ? ac.alt_baro * 0.3048 : null);
                            const altGeom = typeof ac.alt_geom === 'number' ? ac.alt_geom * 0.3048 : null;
                            const velocity = typeof ac.gs === 'number' ? ac.gs * 0.514444 : 0;
                            const vRate = typeof ac.baro_rate === 'number' ? ac.baro_rate * 0.00508 : 0;

                            // Check for valid coordinates
                            const hasValidLoc = (typeof lat === 'number' && typeof lon === 'number');

                            if (hasValidLoc) {
                                // We have a location, so we can overwrite or create the record
                                const stateVector = [
                                    icao,                   // 0: ICAO24
                                    callsign,               // 1: Callsign
                                    "ADSB.lol",             // 2: Origin Country (Placeholder)
                                    Date.now() / 1000,      // 3: Time Position
                                    Date.now() / 1000,      // 4: Last Contact
                                    lon,                    // 5: Longitude
                                    lat,                    // 6: Latitude
                                    altBaro,                // 7: Baro Altitude (m)
                                    ac.on_ground ? true : false, // 8: On Ground
                                    velocity,               // 9: Velocity (m/s)
                                    ac.track || 0,          // 10: True Track
                                    vRate,                  // 11: Vertical Rate (m/s)
                                    null,                   // 12: Sensors
                                    altGeom,                // 13: Geo Altitude (m)
                                    ac.squawk || null,      // 14: Squawk
                                    false,                  // 15: SPI
                                    0,                      // 16: Position Source
                                    finalCat                // 17: Category (Custom)
                                ];
                                mergedStates.set(icao, stateVector);
                            } else if (existing) {
                                // No location in this feed, but we have an existing record (e.g. from OpenSky)
                                // We can UPDATE the category (e.g. mark it as PIA/LADD) without losing the position.
                                existing[17] = finalCat;
                                // Optionally update other metadata if present and fresher?
                                // For now, just Category is the critical piece requested.
                                mergedStates.set(icao, existing);
                            }
                            // If no location and no existing record, we can't map it. Skip.
                        });
                        if (reportCount) {
                            adsbCount = data.ac.length;
                            logSystem(`NET: ${sourceName} data received (${adsbCount} aircraft)`);
                        }
                    }
                } catch (e) {
                    console.error(`${sourceName} Parse Error:`, e);
                }
            }
        };

        // Process in priority order
        await processAdsbLol(piaResult, 'PIA', 11, false);
        await processAdsbLol(laddResult, 'LADD', 12, false);
        await processAdsbLol(milResult, 'MIL', 8, true);

        // Check if toggle was turned off during fetch
        if (!flightToggle || !flightToggle.checked) {
            MapLayerManager.clearLayerData('opensky-data');
            hideStatus();
            return;
        }

        const finalStates = Array.from(mergedStates.values());

        if (finalStates.length === 0) {
            logSystem("NET: No flight data available from any source.");
            hideStatus();
            return;
        }

        // Sort to ensure Military/Special aircraft (high value targets) are first
        finalStates.sort((a, b) => {
            const catA = a[17] || 0;
            const catB = b[17] || 0;
            const isMilA = catA === 8 || catA === 9;
            const isMilB = catB === 8 || catB === 9;

            if (isMilA && !isMilB) return -1;
            if (!isMilA && isMilB) return 1;
            return 0;
        });

        // Send data to worker for processing
        window.lastTotalFetched = finalStates.length;
        dataWorker.postMessage({
            type: 'PROCESS_FLIGHTS',
            data: finalStates,
            config: {
                entityLimit: entityLimit,
                minFlightAltitude: window.minFlightAltitude || 0,
                selectedSquawks: flightFilters.selectedSquawks,
                flightFilters: {
                    standard: flightFilters.standard,
                    military: flightFilters.military,
                    pia: flightFilters.pia,
                    ladd: flightFilters.ladd,
                    alert: flightFilters.alert,
                    ghost: flightFilters.ghost,
                    nosquawk: flightFilters.nosquawk
                },
                useMetric: useMetric
            }
        });

        // Trail data still managed on main thread
        finalStates.forEach(s => {
            if (!s[5] || !s[6]) return;
            const icao24 = s[0];
            const lon = s[5];
            const lat = s[6];

            if (!flightPaths[icao24]) flightPaths[icao24] = [];
            const path = flightPaths[icao24];
            const lastPoint = path.length > 0 ? path[path.length - 1] : null;
            if (!lastPoint || (lastPoint[0] !== lon || lastPoint[1] !== lat)) {
                path.push([lon, lat]);
                if (path.length > 50) path.shift();
            }
        });

    } catch (err) {
        logSystem(`ERR: Feed interrupted - ${err.message}`);
        console.error('Flight Data Error:', {
            error: err.message,
            stack: err.stack,
            name: err.name
        });
        hideStatus();
    }
}

function updateFlightFilterCounts(counts, totalFetched, totalShown) {
    if (!counts) return;
    Object.entries(counts).forEach(([type, count]) => {
        const span = document.getElementById(`count-flight-${type}`);
        if (span) span.textContent = `(${count})`;
    });

    const totalFetchedSpan = document.getElementById('flight-total-fetched');
    const totalShownSpan = document.getElementById('flight-total-shown');

    if (totalFetchedSpan) totalFetchedSpan.textContent = totalFetched.toLocaleString();
    if (totalShownSpan) totalShownSpan.textContent = totalShown.toLocaleString();
}

function updateFlightTrailsLayer() {
    const source = map.getSource('flight-path-data');
    if (!source) return;

    if (!trailsToggle.checked) {
        source.setData({ type: 'FeatureCollection', features: [] });
        return;
    }

    // Convert memory bank to GeoJSON MultiLineString
    const pathFeatures = Object.keys(flightPaths).map(icao => {
        // We need at least 2 points to draw a line
        if (flightPaths[icao].length < 2) return null;

        return {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: flightPaths[icao]
            }
        };
    }).filter(f => f); // Remove nulls

    source.setData({ type: "FeatureCollection", features: pathFeatures });
}


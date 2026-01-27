// --- Map Initialization ---
const colors = { void: '#000000', water: '#080808', land: '#111', roads: '#331a00', text: '#ffcc00' };
let userHasInteracted = false;

// Check for prefetched location from landing page
const storedLoc = sessionStorage.getItem('userLocation');
const initialLocation = storedLoc ? JSON.parse(storedLoc) : null;
const initialCenter = initialLocation ? [initialLocation.lng, initialLocation.lat] : [-74.006, 40.7128];

map = new maplibregl.Map({
    container: 'map',
    center: initialCenter, zoom: 3, pitch: 0,
    projection: 'mercator',
    maxPitch: 85,
    style: {
        version: 8,
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sources: { "openfreemap": { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
        layers: [
            { id: "background", type: "background", paint: { "background-color": colors.void } },
            { id: "water", source: "openfreemap", "source-layer": "water", type: "fill", paint: { "fill-color": colors.water } },
            { id: "boundary", source: "openfreemap", "source-layer": "boundary", type: "line", paint: { "line-color": "#ff4500", "line-width": 1, "line-opacity": 0.5 } },
            { id: "roads", source: "openfreemap", "source-layer": "transportation", type: "line", filter: ["!=", "class", "path"], paint: { "line-color": colors.roads, "line-width": 0.5, "line-opacity": 0.5 } },
            { id: "buildings-3d", source: "openfreemap", "source-layer": "building", type: "fill-extrusion", minzoom: 13, paint: { "fill-extrusion-color": "#ff6800", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.6 } },
            { id: "place-labels", source: "openfreemap", "source-layer": "place", type: "symbol", layout: { "text-field": ["get", "name:en"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-transform": "uppercase" }, paint: { "text-color": colors.text, "text-halo-color": "#000000", "text-halo-width": 2 } }
        ]
    }
});

// --- Popup Utilities ---
const clearPopupTracking = () => { currentPopup = currentPopupFeature = currentPopupLayer = null; window.currentRadioPopupElement = null; };

const createTrackedPopup = (html, coords, layer, props, opts = {}) => {
    if (currentPopup) currentPopup.remove();

    // Wrap content for toggling
    let mainHtml = `<div class="popup-main-view">${html}`;

    // Auto-append Solscan button if signature exists
    if (props.signature) {
        mainHtml += btn('VIEW ON SOLSCAN', `https://solscan.io/tx/${props.signature}`);
    }
    mainHtml += `</div>`;

    const jsonHtml = `<div class="popup-json-view" style="display:none">${JSON.stringify(props, null, 2)}</div>`;

    currentPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: 'cyber-popup', ...opts }).setLngLat(coords).setHTML(mainHtml + jsonHtml).addTo(map);
    currentPopupFeature = props; currentPopupLayer = layer;
    currentPopup.on('close', () => { clearPopupTracking(); opts.onClose?.(); });

    // Smoothly pan camera to center the datapoint with vertical offset
    map.easeTo({
        center: coords,
        // Move point UP by ~15% of screen height, then down 20px per user request
        offset: [0, (-window.innerHeight * 0.15) + 20],
        duration: 500
    });

    // Add buttons
    setTimeout(() => {
        const popupEl = currentPopup?.getElement();
        if (!popupEl) return;
        const content = popupEl.querySelector('.maplibregl-popup-content');
        if (!content) return;

        // Cloud Button - Only show for map clicks, not live feed locates
        if (!props._fromLiveFeed) {
            const sendBtn = document.createElement('button');
            sendBtn.className = 'popup-cloud-btn';
            sendBtn.title = 'Send to Live Feed';
            sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M12 12v9" /><path d="m16 16-4-4-4 4" /></svg>';
            sendBtn.onclick = async (e) => {
                e.stopPropagation();
                sendBtn.style.opacity = '0.5';
                sendBtn.style.pointerEvents = 'none';
                try {
                    const { MemoSender } = await import('./livefeed.js');
                    const result = await MemoSender?.send(props, layer, coords);
                    setTimeout(() => {
                        sendBtn.style.opacity = '';
                        sendBtn.style.pointerEvents = '';
                        if (result) {
                            sendBtn.style.color = '#00ff00';
                            setTimeout(() => sendBtn.style.color = '', 2000);
                        }
                    }, 500);
                } catch (err) {
                    console.error("MemoSender load failed:", err);
                    sendBtn.style.opacity = '';
                    sendBtn.style.pointerEvents = '';
                }
            };
            content.appendChild(sendBtn);
        }

        // JSON Toggle Button
        const jsonBtn = document.createElement('button');
        jsonBtn.className = 'popup-json-btn';
        jsonBtn.title = 'Toggle JSON View';
        // Shift position if cloud button is hidden
        if (props._fromLiveFeed) jsonBtn.style.right = '28px';
        jsonBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V6a2 2 0 0 0-2-2h-1"/></svg>';
        jsonBtn.onclick = (e) => {
            e.stopPropagation();
            jsonBtn.style.opacity = '0.5';
            setTimeout(() => jsonBtn.style.opacity = '', 200);

            const main = content.querySelector('.popup-main-view');
            const json = content.querySelector('.popup-json-view');
            if (json.style.display === 'none') {
                main.style.display = 'none';
                json.style.display = 'block';
                jsonBtn.style.color = '#00ff00'; // Active state
            } else {
                main.style.display = 'block';
                json.style.display = 'none';
                jsonBtn.style.color = '';
            }
        };
        content.appendChild(jsonBtn);

        // Copy Summary Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'popup-copy-btn';
        copyBtn.title = 'Copy Summary';
        // Shift position if cloud button is hidden
        if (props._fromLiveFeed) copyBtn.style.right = '52px';
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.onclick = async (e) => {
            e.stopPropagation();

            copyBtn.style.opacity = '0.5';
            copyBtn.style.pointerEvents = 'none';

            // Copy whatever is currently visible
            const json = content.querySelector('.popup-json-view');
            let text = '';
            if (json.style.display !== 'none') {
                // Copy raw JSON if view is active
                text = JSON.stringify(props, null, 2);
            } else {
                // Copy Summary
                text = Object.entries(props).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n');
            }

            try {
                await navigator.clipboard.writeText(text);
                setTimeout(() => {
                    copyBtn.style.opacity = '';
                    copyBtn.style.pointerEvents = '';
                    copyBtn.style.color = '#00ff00';
                    setTimeout(() => copyBtn.style.color = '', 2000);
                }, 300);
            } catch (err) {
                console.error('Failed to copy', err);
                copyBtn.style.opacity = '';
                copyBtn.style.pointerEvents = '';
            }
        };
        content.appendChild(copyBtn);

        // Time Header Label
        if (props._forceTimeLabel || props.time || props.start) {
            let timeStr = 'JUST NOW';
            let showLabel = false;

            if (props._forceTimeLabel) {
                timeStr = props._forceTimeLabel;
                showLabel = true;
            } else {
                const tVal = props.time || props.start; // Fallback for various data types
                let ms = 0;
                // Parse time
                if (typeof tVal === 'number') ms = tVal;
                else if (typeof tVal === 'string') ms = new Date(tVal).getTime();

                if (ms > 0 && !isNaN(ms)) {
                    const diff = Math.floor((Date.now() - ms) / 1000);
                    if (diff >= 60 && diff < 3600) timeStr = `${Math.floor(diff / 60)}M AGO`;
                    else if (diff >= 3600 && diff < 86400) timeStr = `${Math.floor(diff / 3600)}H AGO`;
                    else if (diff >= 86400) timeStr = `${Math.floor(diff / 86400)}D AGO`;
                    showLabel = true;
                }
            }

            if (showLabel) {
                const timeLabel = document.createElement('div');
                timeLabel.className = 'popup-time-label';
                timeLabel.textContent = timeStr;
                content.appendChild(timeLabel);
            }
        }
    }, 10);

    return currentPopup;
};

const row = (label, val) => val !== undefined && val !== null && val !== '' ? `<div class="popup-row"><span class="popup-label">${label}:</span> ${val}</div>` : '';
const btn = (text, href, cls = 'intel-btn') => `<a href="${href}" target="_blank" class="${cls}">[ ${text} ]</a>`;

// --- Ship Links Builder ---
const buildShipLinks = p => {
    if (!p.ssvid) return '<div class="popup-row no-mmsi-msg">NO MMSI DATA AVAILABLE</div>';
    const cleanName = p.vesselName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();
    const imo = p.imo || '0';
    return btn('MARINE TRAFFIC', `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${p.ssvid}`) +
        btn(p.imo ? 'VESSEL FINDER (IMO)' : 'VESSEL FINDER (SEARCH)', p.imo ? `https://www.vesselfinder.com/vessels/details/${p.imo}` : `https://www.vesselfinder.com/vessels?name=${p.ssvid}`, 'intel-btn vessel-link') +
        btn('MY SHIP TRACKING', `https://www.myshiptracking.com/vessels/${cleanName}-mmsi-${p.ssvid}-imo-${imo}`, 'intel-btn vessel-link');
};

// --- Icon Loader ---
const loadIcon = (name, svg, opts = {}) => { const img = new Image(24, 24); img.onload = () => map.addImage(name, img, opts); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); };

// --- Click Handlers ---
const clickHandlers = {
    flights: (p, coords) => {
        let status = "ACTIVE";
        if (p.type === 'alert') status = `<span class="dark-warning">ALERT (${p.squawk})</span>`;
        if (p.type === 'ghost') status = `<span class="status-cloaked">NO CALLSIGN</span>`;
        if (p.type === 'helo') status = `<span class="status-helo">ROTORCRAFT</span>`;

        const alt = p.altitudeRaw !== undefined ? formatAltitude(p.altitudeRaw, true) : (p.altitude || 'N/A');
        const vel = p.velocityRaw !== undefined ? formatVelocity(p.velocityRaw, true) : (p.velocity || 'N/A');

        let html = row('CALLSIGN', p.callsign) +
            row('SQUAWK', p.squawk) +
            row('ICAO24', p.icao) +
            row('ORIGIN', p.origin) +
            row('STATUS', status) +
            row('CAT', p.category || 'N/A') +
            row('SOURCE', p.source) +
            row('V-RATE', p.verticalRate) +
            row('ALT (GEO)', alt) +
            row('ALT (BARO)', p.baroAltitude) +
            row('SPD', vel) +
            row('GROUND', p.onGround) +
            row('SENSORS', p.sensors) +
            row('SPI', p.spi) +
            row('LAST SEEN', p.lastSeen) +
            btn('ADS-B EXCHANGE', `https://globe.adsbexchange.com/?icao=${p.icao}`);

        createTrackedPopup(html, coords, 'flights', p);
    },
    'space-objects': (p, coords) => {
        const alt = p.altitudeRaw !== undefined ? formatAltitude(p.altitudeRaw, false) : (p.altitude || 'N/A');
        const vel = p.velocityRaw !== undefined ? formatVelocity(p.velocityRaw, false) : (p.velocity || 'N/A');
        createTrackedPopup(row('SAT', p.name) + row('TYPE', p.type) + row('ALT', alt) + row('SPD', vel), coords, 'space-objects', p);
    },
    ships: (p, coords) => createTrackedPopup(row('VESSEL', p.vesselName) + row('FLAG', p.flag) + row('EVENT', p.type) + row('TIME', p.start.split('T')[0]) + buildShipLinks(p), coords, 'ships', p),
    'ships-dots': (p, coords) => clickHandlers.ships(p, coords),
    cables: (p, coords) => {
        const color = (p.status === 'DAMAGED' || p.status === 'OUTAGE') ? '#ff3333' : '#00ff00';
        const html = row('CABLE', p.name) +
            `<div class="popup-row"><span class="popup-label">STATUS:</span> <span style="color:${color}">${p.status}</span></div>` +
            row('RFS', p.rfs) +
            row('LENGTH', p.length) +
            row('OWNERS', p.owners) +
            btn('VIEW ON SUBMARINECABLEMAP.COM', p.url);
        createTrackedPopup(html, coords, 'cables', p, { offset: [0, -10] });
    },
    'landing-points': (p, coords) => new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: 'cyber-popup' }).setLngLat(coords).setHTML(row('LANDING POINT', p.name) + row('COUNTRY', p.country)).addTo(map),
    'radio-stations': (p, coords) => {
        const safe = s => (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const cur = (window.getCurrentStation || (() => null))(), playing = cur?.id === p.id && (window.isRadioPlaying || (() => false))();
        const html = row('STATION', safe(p.name) || 'UNKNOWN') + row('LOCATION', `${p.country || 'UNKNOWN'}${p.state ? ', ' + p.state : ''}${p.language ? ' (' + p.language + ')' : ''}`) + row('CODEC', p.codec || 'UNKNOWN') + row('BITRATE', p.bitrate ? p.bitrate + ' kbps' : 'UNKNOWN') + (p.tags ? row('TAGS', p.tags) : '') +
            `<div class="radio-popup-player"><button onclick="window.toggleRadioFromPopup('${p.id}','${safe(p.name)}','${safe(p.url_resolved || p.url)}','${safe(p.codec || '')}',${p.bitrate || 0})" class="radio-play-btn ${playing ? 'playing' : ''}">${playing ? 'PAUSE' : 'PLAY'}</button></div>` + (p.homepage ? btn('HOMEPAGE', p.homepage) : '');
        createTrackedPopup(html, coords, 'radio-stations', p, { onClose: () => { const s = window.getCurrentStation?.(); if (!s || s.id !== p.id) window.currentRadioPopupElement = null; } });
        setTimeout(() => { try { window.currentRadioPopupElement = currentPopup.getElement(); } catch { } }, 50);
    },
    repeaters: (p, coords) => {
        if (typeof showRepeaterPopup === 'function') { showRepeaterPopup(p, coords); return; }
        createTrackedPopup(row('REPEATER', p.callsign) + row('FREQ', p.frequency) + row('OFFSET', p.offset) + row('TONE', p.pl) + row('LOC', `${p.location}, ${p.state}`) + row('USAGE', p.usage), coords, 'repeaters', p);
    },
    'mesh-nodes': (p, coords) => {
        if (typeof showMeshPopup === 'function') { showMeshPopup(p, coords); return; }
        const type = p.meshType || 'meshtastic', label = type === 'meshcore' ? 'MESHCORE' : 'MESHTASTIC';
        let html = row('TYPE', label) + row('NODE', p.nodeName || 'UNKNOWN') + row('ID', p.nodeId || 'UNKNOWN');
        html += type === 'meshcore' ? row('NODE TYPE', p.nodeType || 'Unknown') + row('LAST SEEN', p.lastSeen || 'N/A') : row('ALT', p.altitude || 'N/A') + row('BATTERY', p.battery || 'N/A') + row('SIGNAL', `${p.signalStrength || 'N/A'} (${p.signalPercentage || 'N/A'})`);
        createTrackedPopup(html, coords, 'mesh-nodes', p);
    }
};

map.on('load', () => {
    try {
        logSystem("SYS: Global view online.");

        // Start spin animation function
        const startSpinAnimation = () => {
            let bearing = 0, spin = null;
            const doSpin = () => { if (!map.isMoving()) { bearing += 0.025; map.setBearing(bearing); spin = requestAnimationFrame(doSpin); } };
            doSpin();
            const stopSpin = () => { if (spin) { cancelAnimationFrame(spin); spin = null; } map.getCanvas().focus(); };
            ['mousedown', 'touchstart', 'wheel', 'keydown', 'dragstart'].forEach(e => map.on(e, stopSpin));
        };

        // If location was prefetched, fly to it (starts centered but zoomed out)
        if (initialLocation) {
            logSystem(`LOC: Signal origin loaded [${initialLocation.city}, ${initialLocation.country}]`);
            map.flyTo({ center: [initialLocation.lng, initialLocation.lat], zoom: 15, pitch: 60, bearing: 0, speed: 0.6, curve: 1.8 });
            map.once('moveend', startSpinAnimation);
            map.getCanvas().focus();
        } else {
            // Fallback: IP Geolocation if not prefetched
            fetch('https://ipapi.co/json/').then(r => r.json()).then(data => {
                if (userHasInteracted) { logSystem(`LOC: Signal origin acquired [${data.city}, ${data.country_code}] (camera preserved)`); return; }
                if (data.latitude && data.longitude) {
                    logSystem(`LOC: Acquired signal origin [${data.city}, ${data.country_code}]`);
                    map.flyTo({ center: [data.longitude, data.latitude], zoom: 15, pitch: 60, bearing: 0, speed: 0.6, curve: 1.8 });
                    map.once('moveend', startSpinAnimation);
                    map.getCanvas().focus();
                }
            }).catch(e => { if (!e.message?.includes('CORS')) logSystem("LOC: Signal origin triangulation failed."); });
        }

        // Consolidated user interaction tracking
        ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(e => map.on(e, () => { userHasInteracted = true; }));

        // Safe data update helper: Throttled to prevent rapid updates from locking UI
        const _throttledSetData = throttle((source, data) => source.setData(data), 500);

        window.safeSetData = function (source, data) {
            if (!source) return;
            if (!userHasInteracted) {
                source.setData(data);
                return;
            }

            // If user has interacted, we want to be more careful.
            // But frequent setData calls can still be expensive.
            _throttledSetData(source, data);
        };

        // Add all data sources
        ['flight-path-data', 'opensky-data', 'gfw-data', 'space-data', 'cable-data', 'landing-points-data', 'radio-data', 'repeater-data', 'mesh-data'].forEach(id => map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }));

        // Load icons
        const icons = {
            'plane-icon': { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#fff" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`, sdf: true },
            'space-icon': { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect x="9" y="8" width="6" height="8" fill="#fff"/><rect x="1" y="9" width="6" height="6" fill="#fff"/><rect x="7" y="11" width="2" height="2" fill="#fff"/><rect x="17" y="9" width="6" height="6" fill="#fff"/><rect x="15" y="11" width="2" height="2" fill="#fff"/><rect x="11.5" y="4" width="1" height="4" fill="#fff"/><circle cx="12" cy="4" r="2" fill="#fff"/></svg>`, sdf: true },
            'helo-icon': { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#00ccff" d="M12,2L14.5,6H18V8H14.5L14,10H17V12H14V17H10V12H7V10H10L9.5,8H6V6H9.5L12,2M12,13C13.1,13 14,13.9 14,15C14,16.1 13.1,17 12,17C10.9,17 10,16.1 10,15C10,13.9 10.9,13 12,13M2,9V11H5V9H2M19,9V11H22V9H19Z"/></svg>`, sdf: false },
            'ship-icon': { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#ff6800" d="M12,2L8,6H16L12,2M12,6L8,10H16L12,6M3,12L5,14H19L21,12H3M3,15L5,17H19L21,15H3M3,18L5,20H19L21,18H3Z"/></svg>`, sdf: true },
            'radio-icon': { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="2" fill="#ff6800"/><path d="M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8Z" fill="#ff6800"/></svg>`, sdf: true }
        };
        Object.entries(icons).forEach(([name, { svg, sdf }]) => loadIcon(name, svg, { sdf }));

        // Add layers
        map.addLayer({ id: 'flight-paths', type: 'line', source: 'flight-path-data', paint: { 'line-color': '#00ccff', 'line-width': 2, 'line-opacity': 0.6 } });
        map.addLayer({ id: 'flights', type: 'symbol', source: 'opensky-data', layout: { 'icon-image': ['get', 'iconType'], 'icon-size': 1.0, 'icon-rotate': ['get', 'heading'], 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': ['match', ['to-string', ['get', 'type']], 'alert', '#ff0000', 'military', '#8e44ad', 'pia', '#00ced1', 'ladd', '#7f8c8d', 'ghost', '#00ff00', 'nosquawk', '#00ccff', 'standard', '#ff6800', '#ff00ff'], 'icon-opacity': 1.0 } });
        map.addLayer({ id: 'space-objects', type: 'symbol', source: 'space-data', layout: { 'icon-image': 'space-icon', 'icon-size': 1.0, 'icon-allow-overlap': true }, paint: { 'icon-color': '#ff00ff', 'icon-opacity': 0.9, 'icon-halo-color': '#000', 'icon-halo-width': 1 } });
        map.addLayer({ id: 'ships-dots', type: 'circle', source: 'gfw-data', maxzoom: 10, paint: { 'circle-radius': 5, 'circle-color': ['get', 'iconColor'], 'circle-opacity': 0.8 } });
        map.addLayer({ id: 'ships', type: 'symbol', source: 'gfw-data', minzoom: 10, layout: { 'icon-image': 'ship-icon', 'icon-size': 1.0, 'icon-allow-overlap': false, 'icon-ignore-placement': false }, paint: { 'icon-color': ['get', 'iconColor'], 'icon-opacity': 0.9, 'icon-halo-color': '#000', 'icon-halo-width': 1 } });
        map.addLayer({ id: 'cables', type: 'line', source: 'cable-data', layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' }, paint: { 'line-color': ['match', ['get', 'status'], 'OPERATIONAL', '#00ffcc', '#ff3333'], 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2, 5, 3, 10, 5, 15, 8], 'line-opacity': 0.7 } });
        map.addLayer({ id: 'landing-points', type: 'circle', source: 'landing-points-data', layout: { visibility: 'none' }, paint: { 'circle-radius': 6, 'circle-color': '#ff6800', 'circle-opacity': 0.8, 'circle-stroke-width': 1, 'circle-stroke-color': '#000' } });
        map.addLayer({ id: 'radio-stations', type: 'symbol', source: 'radio-data', layout: { 'icon-image': 'radio-icon', 'icon-size': 0.8, 'icon-allow-overlap': true, 'icon-ignore-placement': true, visibility: 'none' }, paint: { 'icon-color': '#ff6800' } });
        map.addLayer({ id: 'repeaters', type: 'symbol', source: 'repeater-data', layout: { 'icon-image': 'radio-icon', 'icon-size': 0.7, 'icon-allow-overlap': true, 'icon-ignore-placement': true, visibility: 'none' }, paint: { 'icon-color': '#00ff00' } });
        map.addLayer({ id: 'mesh-nodes', type: 'circle', source: 'mesh-data', layout: { visibility: 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 6, 10, 8, 15, 10], 'circle-color': ['get', 'signalColor'], 'circle-opacity': 0.8, 'circle-stroke-width': 1, 'circle-stroke-color': '#000' } });

        // Unified click handlers
        Object.keys(clickHandlers).forEach(layer => {
            map.on('click', layer, e => {
                const p = e.features[0].properties;
                const coords = layer === 'cables' ? [e.lngLat.lng, e.lngLat.lat] : e.features[0].geometry.coordinates.slice();
                clickHandlers[layer](p, coords);
            });
        });

        // Consolidated cursor handlers
        ['flights', 'ships', 'ships-dots', 'space-objects', 'radio-stations', 'repeaters', 'mesh-nodes', 'cables', 'landing-points'].forEach(layer => {
            map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer');
            map.on('mouseleave', layer, () => map.getCanvas().style.cursor = '');
        });

    } catch (err) {
        logSystem(`ERR: Map load failed - ${err.message}`);
        console.error(err);
    }
});

// Refresh current popup with updated units
function refreshCurrentPopup() {
    if (!currentPopup || !currentPopupFeature || !currentPopupLayer) return;
    const handler = clickHandlers[currentPopupLayer];
    if (handler) handler(currentPopupFeature, currentPopup.getLngLat());
}

// Expose click handlers for external use (e.g. Live Feed)
window.mapClickHandlers = clickHandlers;
window.createTrackedPopup = createTrackedPopup;
window.refreshCurrentPopup = refreshCurrentPopup;

// LIVE FEED SCANNING... - lazily loaded
// Depends on globals: solanaWeb3, Toast (window.Toast), logSystem (optional)
// Uses: PHP_PROXY, PROXY_SERVICES, SOLANA_RPCS from globals.js

const el = id => document.getElementById(id);
const log = msg => (window.logSystem ? window.logSystem(msg) : console.log(msg));
const Toast = window.Toast;

// ========= Shared RPC Helper with Proxy Chain =========
// Priority: 1) Third-party CORS proxies, 2) Direct RPC
const RPC_TIMEOUT = 12000;
let activeRpcRoute = null; // Cache the working route { type: 'proxy'|'direct', url: string, endpoint: string, proxyName: string }

async function rpcWithProxyChain(method, params) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const fetchOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };

    // Config
    const rpcs = ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'];

    // Third-party CORS proxies
    const thirdPartyProxies = (typeof PROXY_SERVICES !== 'undefined') ? PROXY_SERVICES : [
        { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' }
    ];

    const fetchWithTimeout = (url, opts) => Promise.race([
        fetch(url, opts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), RPC_TIMEOUT))
    ]);

    // --- STRATEGY 0: Try Sticky Route (if exists) ---
    if (activeRpcRoute) {
        try {
            const r = await fetchWithTimeout(activeRpcRoute.url, fetchOpts);
            if (r.ok) {
                const d = await r.json();
                if (d.result !== undefined) return d.result;
            }
            console.warn(`RPC: Sticky route failed, invalidating...`);
            activeRpcRoute = null;
        } catch (e) {
            activeRpcRoute = null;
        }
    }

    // --- STRATEGY 1: Third-party Proxies ---
    for (const proxy of thirdPartyProxies) {
        for (const ep of rpcs) {
            try {
                const proxiedUrl = proxy.url + encodeURIComponent(ep);
                const r = await fetchWithTimeout(proxiedUrl, fetchOpts);
                if (r.ok) {
                    const d = await r.json();
                    if (d.result !== undefined) {
                        log(`SOL: RPC via ${proxy.name.toUpperCase()}`);
                        activeRpcRoute = { type: 'proxy', url: proxiedUrl, endpoint: ep, proxyName: proxy.name };
                        return d.result;
                    }
                }
            } catch (e) { }
        }
    }

    // --- STRATEGY 2: Direct ---
    for (const ep of rpcs) {
        try {
            const r = await fetchWithTimeout(ep, fetchOpts);
            if (r.ok) {
                const d = await r.json();
                if (d.result !== undefined) {
                    log(`SOL: RPC via DIRECT`);
                    activeRpcRoute = { type: 'direct', url: ep, endpoint: ep };
                    return d.result;
                }
            }
        } catch (e) { }
    }

    throw new Error('All RPC methods failed');
}

// ========= Memo Feed =========
const MemoFeed = {
    isLoading: false,
    isInitialized: false,
    MEMO_PROGRAM: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
    PDA_ADDRESS: 'JB2bfszU6Xfxy8YiUTbr5sNjmBSGnHcaiUUZDjZ8dsxn',
    TARGET_SIGNATURES: 2000, // Max signatures to fetch
    CHUNK_SIZE: 1000, // Max per RPC call

    async rpc(method, params) {
        return rpcWithProxyChain(method, params);
    },

    short(s) { return s ? s.slice(0, 4) + '...' + s.slice(-4) : ''; },
    esc(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); },

    timeAgo(ts) {
        if (!ts) return 'just now';
        const sec = Math.floor((Date.now() - ts) / 1000);
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} hr${hr > 1 ? 's' : ''} ago`;
        const dy = Math.floor(hr / 24);
        return `${dy} day${dy > 1 ? 's' : ''} ago`;
    },

    // Check if entity type has data loaded (via toggle state)
    isEntityOnMap(data) {
        if (typeof map === 'undefined' || !map) return false;

        // Simple approach: if the toggle is ON, assume data is loaded
        // This is more reliable than trying to query map sources
        if (data.type === 'flights') {
            const toggle = document.getElementById('flight-toggle');
            const isOn = toggle && toggle.checked;
            console.log(`LOCATE: Flights toggle is ${isOn ? 'ON' : 'OFF'}`);
            return isOn;
        }
        if (data.type === 'ships' || data.type === 'ships-dots') {
            const toggle = document.getElementById('ship-toggle');
            const isOn = toggle && toggle.checked;
            console.log(`LOCATE: Ships toggle is ${isOn ? 'ON' : 'OFF'}`);
            return isOn;
        }
        if (data.type === 'earthquake-circles') {
            const toggle = document.getElementById('earthquake-toggle');
            const isOn = toggle && toggle.checked;
            console.log(`LOCATE: Earthquake toggle is ${isOn ? 'ON' : 'OFF'}`);
            return isOn;
        }
        if (data.type === 'space-objects') {
            const toggle = document.getElementById('space-toggle');
            const isOn = toggle && toggle.checked;
            console.log(`LOCATE: Space toggle is ${isOn ? 'ON' : 'OFF'}`);
            return isOn;
        }
        return false;
    },

    // Temporary marker reference
    currentMarker: null,

    // Add a visual marker for located items
    addTemporaryMarker(data, coords) {
        if (this.currentMarker) {
            this.currentMarker.remove();
            this.currentMarker = null;
        }

        const el = document.createElement('div');
        el.className = 'temp-marker';

        // SVGs matching map.js
        const svgs = {
            plane: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#fff" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`,
            helo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#00ccff" d="M12,2L14.5,6H18V8H14.5L14,10H17V12H14V17H10V12H7V10H10L9.5,8H6V6H9.5L12,2M12,13C13.1,13 14,13.9 14,15C14,16.1 13.1,17 12,17C10.9,17 10,16.1 10,15C10,13.9 10.9,13 12,13M2,9V11H5V9H2M19,9V11H22V9H19Z"/></svg>`,
            ship: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12,2L8,6H16L12,2M12,6L8,10H16L12,6M3,12L5,14H19L21,12H3M3,15L5,17H19L21,15H3M3,18L5,20H19L21,18H3Z"/></svg>`,
            space: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect x="9" y="8" width="6" height="8" fill="#fff"/><rect x="1" y="9" width="6" height="6" fill="#fff"/><rect x="7" y="11" width="2" height="2" fill="#fff"/><rect x="17" y="9" width="6" height="6" fill="#fff"/><rect x="15" y="11" width="2" height="2" fill="#fff"/><rect x="11.5" y="4" width="1" height="4" fill="#fff"/><circle cx="12" cy="4" r="2" fill="#fff"/></svg>`,
            radio: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="2" fill="#ff6800"/><path d="M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8Z" fill="#ff6800"/></svg>`
        };

        // Default marker style
        el.style.width = '24px';
        el.style.height = '24px';

        let html = '';

        if (data.type === 'flights') {
            const isHelo = (data.cat === 8 || (data.callsign && (data.callsign.includes("HELO") || data.callsign.includes("POLICE"))));
            const heading = data.heading || 0;
            html = isHelo ? svgs.helo : svgs.plane;
            // Apply rotation
            el.style.transform = `rotate(${heading}deg)`;
            el.innerHTML = html;
        }
        else if (data.type === 'ships' || data.type === 'ships-dots') {
            // Determine color
            let color = '#0088ff';
            if (data.event === 'gap') color = '#ff3333';
            else if (data.event === 'encounter') color = '#ff00ff';
            else if (data.event === 'loitering') color = '#ff6800';
            else if (data.event === 'fishing') color = '#00ffcc';

            el.style.color = color;
            el.innerHTML = svgs.ship;
        }
        else if (data.type === 'space-objects') {
            el.innerHTML = svgs.space;
        }
        else if (data.type === 'radio-stations' || data.type === 'repeaters') {
            el.innerHTML = svgs.radio;
        }
        else if (data.type === 'earthquake-circles') {
            // Earthquakes are usually circles
            const mag = data.mag || 0;
            let color = '#fbbf24';
            if (mag >= 7.0) color = '#991b1b';
            else if (mag >= 6.0) color = '#dc2626';
            else if (mag >= 5.0) color = '#ef4444';
            else if (mag >= 4.0) color = '#fb923c';

            el.style.width = '14px';
            el.style.height = '14px';
            el.style.backgroundColor = color;
            el.style.borderRadius = '50%';
            el.style.border = '2px solid white';
            el.style.boxShadow = '0 0 5px ' + color;
        } else {
            // Generic fallback
            el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="2"><circle cx="12" cy="12" r="6"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`;
        }

        this.currentMarker = new maplibregl.Marker({ element: el })
            .setLngLat(coords)
            .addTo(map);

        // Remove marker when popup closes
        const checkPopup = setInterval(() => {
            if (!document.querySelector('.maplibregl-popup')) {
                if (this.currentMarker) {
                    this.currentMarker.remove();
                    this.currentMarker = null;
                }
                clearInterval(checkPopup);
            }
        }, 1000);
    },

    // Find if this entity exists in loaded map sources and return full properties
    findMatchingFeature(data) {
        if (!map) return null;
        try {
            let features = [];

            if (data.type === 'earthquake-circles') {
                // Earthquakes: fuzzy match on loc/mag
                // 1. Try global data array if available
                features = (typeof window.earthquakeData !== 'undefined') ? window.earthquakeData : [];
                // 2. Fallback to map source
                if ((!features || !features.length) && map.getSource('earthquake-data')) {
                    const source = map.getSource('earthquake-data');
                    if (source._data && source._data.features) features = source._data.features;
                }
                // 3. Fallback to viewport
                if (!features || !features.length) features = map.querySourceFeatures('earthquake-data');
                return features.find(f => {
                    const p = f.properties;
                    const coords = f.geometry.coordinates;

                    // Match logic: Relax mag check if data.mag is missing (parse error fallback)
                    const magVal = Number(data.mag);
                    const magMatch = isNaN(magVal) ? true : Math.abs(Number(p.mag) - magVal) < 0.5;

                    return magMatch &&
                        Math.abs(coords[0] - parseFloat(data.lng)) < 0.05 &&
                        Math.abs(coords[1] - parseFloat(data.lat)) < 0.05;
                })?.properties;
            }

            if (data.type === 'flights') {
                features = map.querySourceFeatures('opensky-data');
                return features.find(f => f.properties.icao == data.icao)?.properties;
            }

            if (data.type === 'ships' || data.type === 'ships-dots') {
                features = map.querySourceFeatures('gfw-data');
                return features.find(f => f.properties.ssvid == data.mmsi)?.properties;
            }

        } catch (e) { console.warn('Feature lookup failed', e); }
        return null;
    },

    // Unified Locate Handler
    locate(encodedJson, signature, timestamp, timeLabel) {
        try {
            let data = JSON.parse(decodeURIComponent(encodedJson));
            console.log('LOCATE: Raw parsed data:', data);

            // 1. Flatten raw data (critical for popup display)
            if (data.raw) {
                try {
                    const rawParsed = typeof data.raw === 'string' ? JSON.parse(data.raw) : data.raw;
                    data = { ...data, ...rawParsed };

                    // Explicitly cast numeric types for popup handlers
                    if (data.mag) data.mag = parseFloat(data.mag);
                    if (data.depth) data.depth = parseFloat(data.depth);
                    if (data.time) data.time = Number(data.time);

                    console.log('LOCATE: Flattened & Sanitized:', data);
                } catch (e) {
                    console.warn('LOCATE: Failed to parse raw data', e);
                }
            }

            // Fallback to transaction time if data.time is missing
            if (!data.time && timestamp) {
                data.time = Number(timestamp);
            }

            // Inject signature and mark as from live feed (to hide send button)
            data.signature = signature;
            data._fromLiveFeed = true;
            if (timeLabel) data._forceTimeLabel = timeLabel;

            if (data.lat && data.lng) {
                const coords = [parseFloat(data.lng), parseFloat(data.lat)];
                ModalManager.close('live-feed-modal');

                // 2. Try to hydrate with rich data from map
                const existingProps = this.findMatchingFeature(data);

                if (existingProps) {
                    console.log('LOCATE: Found existing feature, hydrating...');
                    // Use rich properties but keep signature/type AND live feed markers
                    data = {
                        ...existingProps,
                        signature: signature,
                        type: data.type,
                        _fromLiveFeed: true,
                        _forceTimeLabel: data._forceTimeLabel,
                        time: data.time // Prefer feed time for consistency with label
                    };
                } else {
                    console.log('LOCATE: No existing feature, using memo data');
                    // Add visual marker only if NOT on map
                    // FIX: Always add temporary marker if feature not found, even if layer is on (it might be old data)
                    this.addTemporaryMarker(data, coords);
                }

                // FINAL SANITIZATION: Cast types strictly before usage
                if (data.mag !== undefined) data.mag = parseFloat(data.mag);
                if (data.depth !== undefined) data.depth = parseFloat(data.depth);
                if (data.time !== undefined) data.time = Number(data.time);

                console.log('LOCATE: Final Payload:', data);

                // 3. Trigger Handlers
                if (data.type === 'earthquake-circles' && typeof showEarthquakePopup === 'function') {
                    showEarthquakePopup(data, coords);
                }
                else if (window.mapClickHandlers && window.mapClickHandlers[data.type]) {
                    window.mapClickHandlers[data.type](data, coords);
                }
                else {
                    // Fallback using createPopup (supports time-ago)
                    const html = `<div class='popup-row'>LOCATED SIGNAL</div>` +
                        (window.createTrackedPopup ? '' : `<div class="popup-row"><a href="https://solscan.io/tx/${signature}" target="_blank" class="intel-btn" style="margin-top:10px">[ VIEW ON SOLSCAN ]</a></div>`);

                    window.createPopup(coords, html, data, 'generic', { className: 'cyber-popup' });
                }
            } else {
                alert('No coordinates found in this inscription');
            }
        } catch (e) {
            console.error('Locate error:', e);
            alert('Could not parse location data');
        }
    },

    /**
     * Bulk fetch signatures using cursor-based pagination
     * Fetches up to TARGET_SIGNATURES in CHUNK_SIZE batches
     */
    renderMemos(memos) {
        const list = el('memo-feed-list');
        list.innerHTML = memos.map(m => `
            <div class="memo-wrapper">
                <div class="memo-author" style="display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <a href="https://solscan.io/account/${m.author}" target="_blank" rel="noopener">${this.short(m.author)}</a>
                        <span style="color:#888; margin-left:8px; font-size:11px;">${this.timeAgo(m.time)}</span>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="memo-scope-btn" title="Locate" onclick="MemoFeed.locate('${encodeURIComponent(m.txt)}', '${m.sig}', ${m.time}, '${this.timeAgo(m.time)}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        </button>
                        <button class="memo-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(m.txt)}')).then(function(){this.style.color='#ff6800';setTimeout(()=>{this.style.color=''},1000)}.bind(this))" title="Copy Text">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                    </div>
                </div>
                <div class="memo-item">
                    <div class="memo-content">${this.esc(m.txt)}</div>
                    <div class="memo-footer">
                        <span>${new Date(m.time).toLocaleString()}</span>
                        <a href="https://solscan.io/tx/${m.sig}" target="_blank" rel="noopener" class="memo-sig">${this.short(m.sig)}</a>
                    </div>
                </div>
            </div>
        `).join('');
    },

    // NEW: Render a single memo immediately (prepend to feed) with fade-in animation
    renderSingleMemo(memo) {
        const list = el('memo-feed-list');

        // Remove loader if still showing
        const loader = list.querySelector('.poly-loader-container');
        if (loader) loader.remove();

        // Remove placeholder if showing
        const placeholder = list.querySelector('.feed-placeholder');
        if (placeholder) placeholder.remove();

        const memoHtml = `
            <div class="memo-wrapper">
                <div class="memo-author" style="display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <a href="https://solscan.io/account/${memo.author}" target="_blank" rel="noopener">${this.short(memo.author)}</a>
                        <span style="color:#888; margin-left:8px; font-size:11px;">${this.timeAgo(memo.time)}</span>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="memo-scope-btn" title="Locate" onclick="MemoFeed.locate('${encodeURIComponent(memo.txt)}', '${memo.sig}', ${memo.time}, '${this.timeAgo(memo.time)}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                            </svg>
                        </button>
                        <button class="memo-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(memo.txt)}')).then(function(){this.style.color='#ff6800';setTimeout(()=>this.style.color='',1000)}.bind(this))" title="Copy Text">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="memo-item">
                    <div class="memo-content">${this.esc(memo.txt)}</div>
                    <div class="memo-footer">
                        <span>${new Date(memo.time).toLocaleString()}</span>
                        <a href="https://solscan.io/tx/${memo.sig}" target="_blank" rel="noopener" class="memo-sig">${this.short(memo.sig)}</a>
                    </div>
                </div>
            </div>
        `;

        // PREPEND (newest first) with fade-in animation
        const wrapper = document.createElement('div');
        wrapper.innerHTML = memoHtml;
        const memoElement = wrapper.firstElementChild;

        // Start invisible
        memoElement.style.opacity = '0';
        memoElement.style.transform = 'translateY(-10px)';
        memoElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        list.insertBefore(memoElement, list.firstChild);

        // Trigger fade-in animation
        setTimeout(() => {
            memoElement.style.opacity = '1';
            memoElement.style.transform = 'translateY(0)';
        }, 10);
    },

    /**
     * Helper: Extract memo text and author from a parsed transaction object
     * @param {object} tx - The JSON parsed transaction result
     * @param {string} signature - The transaction signature
     */
    extractMemoFromTx(tx, signature) {
        if (!tx) return null;

        try {
            const instructions = tx?.transaction?.message?.instructions || [];
            const innerInstructions = tx?.meta?.innerInstructions?.flatMap(i => i.instructions) || [];
            const allInstructions = [...instructions, ...innerInstructions];

            // Look for memo in all instructions
            const ix = allInstructions.find(i =>
                i.programId === this.MEMO_PROGRAM ||
                i.program === 'spl-memo' ||
                i.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
            );

            if (!ix) return null;

            let c = null;
            // Handle parsed format (program: 'spl-memo')
            if (ix.program === 'spl-memo' && typeof ix.parsed === 'string') {
                c = ix.parsed;
            }
            // Handle raw format with programId
            else if (ix.data) {
                try {
                    c = new TextDecoder().decode(Uint8Array.from(atob(ix.data), x => x.charCodeAt(0)));
                } catch (e) { }
            }

            if (typeof c === 'string') c = c.replace(/\0/g, '').trim();

            if (c && c.length > 0) {
                const accountKeys = tx?.transaction?.message?.accountKeys || [];
                const author = accountKeys.find(k => k.signer)?.pubkey || accountKeys[0]?.pubkey || accountKeys[0] || 'Unknown';
                return { sig: signature, txt: c, time: (tx.blockTime || Date.now() / 1000) * 1000, author };
            }
        } catch (e) {
            console.warn(`Error parsing tx ${signature}:`, e);
        }
        return null;
    },

    async load(retryCount = 0) {
        if (this.isLoading && retryCount === 0) {
            console.log('SOL: Live Feed skipping redundant fetch (already loading).');
            return;
        }
        this.isLoading = true;
        const list = el('memo-feed-list'), scanning = el('feed-scanning');
        const MAX_MEMOS = 500;
        const MAX_RETRIES = 3;

        // 1. Load Cache & Build Index
        let cachedMemos = [];
        const cachedRaw = localStorage.getItem('cachedMemos');
        const knownSigs = new Set();

        if (cachedRaw) {
            try {
                cachedMemos = JSON.parse(cachedRaw);
                if (Array.isArray(cachedMemos)) {
                    cachedMemos.forEach(m => knownSigs.add(m.sig));
                    this.renderMemos(cachedMemos); // Show stale data immediately
                } else {
                    cachedMemos = [];
                }
            } catch (e) {
                console.warn('Cache parse error', e);
                cachedMemos = [];
            }
        }

        const SPINNER_HTML = '<span class="live-feed-spinner"></span>';

        // UI State
        if (cachedMemos.length === 0) {
            scanning.textContent = '';
            if (retryCount === 0) {
                list.innerHTML = `
                    <div class="poly-loader-container" style="height: 100px;">
                        <div class="poly-loader"></div>
                    </div>
                `;
            }
        } else {
            scanning.innerHTML = `| ${cachedMemos.length} MEMOS (SYNCING...${SPINNER_HTML})`;
        }

        try {
            let before = null;
            let newMemos = [];
            let pageCount = 0;
            let hitKnownHistory = false;
            let totalProcessed = 0;

            log(`SOL: Smart Sync started. Retry: ${retryCount}. Known signatures: ${knownSigs.size}`);

            // PAGINATION LOOP
            while (newMemos.length < MAX_MEMOS && !hitKnownHistory) {
                pageCount++;
                scanning.innerHTML = `SYNCING [${newMemos.length}]${SPINNER_HTML}`;

                // 1. Fetch Signatures
                const sigParams = { limit: this.CHUNK_SIZE, commitment: 'confirmed' };
                if (before) sigParams.before = before;

                const batchSigs = await this.rpc('getSignaturesForAddress', [this.PDA_ADDRESS, sigParams]);

                if (!batchSigs || batchSigs.length === 0) {
                    console.log('SOL: End of history reached');
                    break;
                }

                // 2. Filter & Check Overlap
                let signaturesToProcess = [];
                for (const s of batchSigs) {
                    if (s.err) continue; // Skip failed txs

                    if (knownSigs.has(s.signature)) {
                        console.log(`SOL: Found known signature ${this.short(s.signature)} - OPTIMIZATION TRIGGERED. Stopping fetch.`);
                        hitKnownHistory = true;
                        break; // Stop collecting signatures from this batch
                    }
                    signaturesToProcess.push(s);
                }

                if (signaturesToProcess.length === 0 && hitKnownHistory) {
                    break; // Exact overlap start
                }

                // 3. Process New Transactions (REAL-TIME)
                console.log(`SOL: Processing ${signaturesToProcess.length} new sigs (Page ${pageCount})...`);

                // Reverse to process oldest-first, so prepending puts newest at top
                signaturesToProcess.reverse();

                // Process sequentially to show results in real-time
                for (const s of signaturesToProcess) {
                    try {
                        // Fetch transaction
                        const tx = await this.rpc('getTransaction', [s.signature, {
                            encoding: 'jsonParsed',
                            maxSupportedTransactionVersion: 0,
                            commitment: 'confirmed'
                        }]);

                        // Extract memo
                        const memo = this.extractMemoFromTx(tx, s.signature);

                        if (memo) {
                            // ✨ RENDER IMMEDIATELY
                            this.renderSingleMemo(memo);
                            newMemos.push(memo);

                            // Update counter in real-time
                            scanning.innerHTML = `SYNCING [${newMemos.length}]${SPINNER_HTML}`;

                            if (newMemos.length >= MAX_MEMOS) break;
                        }

                    } catch (err) {
                        console.warn(`Failed to process ${this.short(s.signature)}:`, err.message);
                    }
                }

                // Prepare next cursor (if we didn't hit history)
                if (!hitKnownHistory) {
                    before = batchSigs[batchSigs.length - 1].signature;
                }

                // Safety: break if no progress to avoid inf loops
                if (batchSigs.length < this.CHUNK_SIZE) break;
            }

            // 4. Merge & Save
            const finalMemos = [...newMemos, ...cachedMemos];

            // Deduplicate logic (integrity check)
            const uniqueMap = new Map();
            finalMemos.forEach(m => uniqueMap.set(m.sig, m));
            const uniqueMemos = Array.from(uniqueMap.values());

            // Sort & Trim
            uniqueMemos.sort((a, b) => b.time - a.time);
            const trimmedMemos = uniqueMemos.slice(0, MAX_MEMOS);

            log(`SOL: Sync complete. +${newMemos.length} new, ${trimmedMemos.length} total.`);

            this.renderMemos(trimmedMemos);
            localStorage.setItem('cachedMemos', JSON.stringify(trimmedMemos));
            scanning.textContent = `| ${trimmedMemos.length} MEMOS`;

            if (trimmedMemos.length === 0) {
                list.innerHTML = '<div class="feed-placeholder">No memos found.</div>';
                scanning.textContent = '| 0 MEMOS';
            }
            this.isLoading = false;

        } catch (e) {
            console.error(`Memo feed error (Attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, e);

            if (retryCount < MAX_RETRIES) {
                const backoff = (retryCount + 1) * 2000;
                scanning.textContent = `Retrying in ${backoff / 1000}s...`;

                if (cachedMemos.length === 0) {
                    list.innerHTML = `
                        <div class="poly-loader-container" style="height: 100px;">
                            <div class="poly-loader"></div>
                            <div class="poly-loader-text">CONNECTION FAILED. RETRYING (${retryCount + 1})...</div>
                        </div>
                    `;
                }

                setTimeout(() => this.load(retryCount + 1), backoff);
                return;
            }

            scanning.textContent = 'Connection Error';
            if (cachedMemos.length === 0) {
                list.innerHTML = `
                    <div class="feed-error">
                        <div style="margin-bottom:10px; color:#ff3333;">CONNECTION FAILED</div>
                        <div style="font-size:10px; color:#888;">${e.message}</div>
                        <button onclick="MemoFeed.load()" class="intel-btn" style="margin-top:15px; width:100%;">RETRY CONNECTION</button>
                    </div>`;
            }
            this.isLoading = false;
        }
    },

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Inject Spinner CSS
        const styleId = 'live-feed-spinner-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes liveFeedSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .live-feed-spinner {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border: 2px solid #ff6800;
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: liveFeedSpin 1s linear infinite;
                    margin-left: 8px;
                    vertical-align: middle;
                }
                /* Popup Time Styling */
                .popup-time-label, .popup-time-display {
                    position: absolute;
                    top: 5px;
                    left: 10px;
                    color: #ff6800;
                    font-size: 9px;
                    font-weight: bold;
                    font-family: 'Courier New', monospace;
                    text-transform: uppercase;
                    background: rgba(0, 0, 0, 0.8);
                    padding: 2px 6px;
                    border: 1px solid #331a00;
                    border-radius: 4px;
                    z-index: 10;
                    pointer-events: none;
                    box-shadow: 0 0 5px rgba(0,0,0,0.5);
                }
                /* Ensure close button is on top */
                .maplibregl-popup-close-button { z-index: 20; }
            `;
            document.head.appendChild(style);
        }

        const refreshBtn = el('feed-refresh-btn');
        this.load();
        if (refreshBtn) {
            const newBtn = refreshBtn.cloneNode(true);
            refreshBtn.parentNode.replaceChild(newBtn, refreshBtn);
            newBtn.addEventListener('click', () => this.load());
        }
    }
};

// ========= Wallet Manager =========
const WalletManager = {
    wallet: null,
    pubkey: null,

    async rpc(method, params) {
        return rpcWithProxyChain(method, params);
    },

    showStatus(type, msg) {
        const el = document.getElementById('wallet-status-msg');
        if (!el) return;
        el.style.display = 'block';
        el.className = 'status-msg';
        el.style.background = type === 'error' ? 'rgba(51, 0, 0, 0.8)' : 'rgba(0, 51, 0, 0.8)';
        el.style.color = type === 'error' ? '#ff3333' : '#00ff00';
        el.style.border = type === 'error' ? '1px solid #ff3333' : '1px solid #00ff00';
        el.innerHTML = msg;
        setTimeout(() => el.style.display = 'none', 5000);
    },

    getProvider() {
        if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
        if (window.solana?.isPhantom) return window.solana;
        if (window.solflare?.isSolflare) return window.solflare;
        if (window.solana) return window.solana;
        return null;
    },

    async getSolPrice() {
        const priceUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
        const phpProxy = (typeof PHP_PROXY !== 'undefined') ? PHP_PROXY : 'proxy.php?url=';
        const thirdPartyProxies = (typeof PROXY_SERVICES !== 'undefined') ? PROXY_SERVICES : [
            { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' },
            { url: 'https://api.allorigins.win/raw?url=', name: 'allorigins' },
            { url: 'https://corsproxy.io/?', name: 'corsproxyio' }
        ];

        // 1) PHP proxy
        try {
            const r = await fetch(phpProxy + encodeURIComponent(priceUrl));
            if (r.ok) {
                const data = await r.json();
                if (data?.solana?.usd) return data.solana.usd;
            }
        } catch (e) {
            console.warn('WalletManager: Price fetch via PHP proxy failed:', e.message);
        }

        // 2) Third-party proxies
        for (const proxy of thirdPartyProxies) {
            try {
                const r = await fetch(proxy.url + encodeURIComponent(priceUrl));
                if (r.ok) {
                    const data = await r.json();
                    if (data?.solana?.usd) return data.solana.usd;
                }
            } catch (e) {
                console.warn(`WalletManager: Price fetch via ${proxy.name} failed: `, e.message);
            }
        }

        // 3) Direct
        try {
            const r = await fetch(priceUrl);
            if (r.ok) {
                const data = await r.json();
                if (data?.solana?.usd) return data.solana.usd;
            }
        } catch (e) {
            console.warn('WalletManager: Direct price fetch failed:', e.message);
        }

        return null;
    },

    async toggle() {
        const btn = document.getElementById('w-btn');
        const statusEl = document.getElementById('w-status');
        const detailsEl = document.getElementById('w-details');
        const addrEl = document.getElementById('w-addr');
        const balEl = document.getElementById('w-balance');

        if (this.wallet) {
            try { await this.wallet.disconnect(); } catch { }
            this.wallet = this.pubkey = null;
            if (statusEl) { statusEl.textContent = 'NOT CONNECTED'; statusEl.style.color = '#ff6800'; }
            detailsEl?.classList.add('hidden');
            if (btn) btn.textContent = 'CONNECT WALLET';
            log('WALLET: Disconnected.');
            return;
        }

        const provider = this.getProvider();
        if (!provider) {
            this.showStatus('error', 'No Solana wallet found. Please install Phantom or Solflare.');
            return;
        }

        try {
            if (btn) btn.textContent = 'CONNECTING...';
            const { publicKey } = await provider.connect();
            this.wallet = provider;
            this.pubkey = publicKey;

            if (statusEl) { statusEl.textContent = 'CONNECTED'; statusEl.style.color = '#00ff00'; }
            if (addrEl) addrEl.textContent = publicKey.toString();
            if (balEl) balEl.textContent = 'Fetching...';
            detailsEl?.classList.remove('hidden');
            if (btn) btn.textContent = 'DISCONNECT';

            try {
                const balance = await this.rpc('getBalance', [publicKey.toString()]);
                const sol = (balance?.value || balance || 0) / 1e9;

                // Fetch price
                const price = await this.getSolPrice();
                let valText = `${sol.toFixed(4)} SOL`;
                if (price) {
                    const usd = sol * price;
                    valText += ` ($${usd.toFixed(2)})`;
                }

                if (balEl) balEl.textContent = valText;
            } catch (e) {
                console.error(e);
                if (balEl) balEl.textContent = 'Balance Error';
            }
            log(`WALLET: Connected ${publicKey.toString().slice(0, 6)}...`);
        } catch (e) {
            console.error(e);
            this.showStatus('error', 'Connection failed: ' + e.message);
            if (btn) btn.textContent = 'CONNECT WALLET';
        }
    },



    init() {
        const btn = document.getElementById('w-btn');
        if (btn) {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => this.toggle());
        }
    }
};

// ========= Memo Sender =========
const MemoSender = {
    CFG: {
        POT: 'EQ3W43KtTw6mMW8ojYQSEPCdYUw8GUqRdBRui8mi4H7A',
        MEMO: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
        MAX: 560,
        BURN_TOKEN: 'F71QTievhZiRQn2qCX9XznhnoZDPovbnY7eW84bNpump',
        TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        TOKEN_2022_PROGRAM: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        ATA_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
        PUMP_PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        SITE_PDA: 'JB2bfszU6Xfxy8YiUTbr5sNjmBSGnHcaiUUZDjZ8dsxn'
    },
    FEE_LAMPORTS: 5000000,
    FEE_USD: 3,
    cachedSolPrice: null,
    lastPriceFetch: 0,

    init() {
        // Fire-and-forget price fetch on load
        this.getSolPrice().catch(e => console.warn('Background price fetch failed', e));
    },

    async getSolPrice() {
        const now = Date.now();
        // Use cache if fresh (< 5 mins)
        if (this.cachedSolPrice && (now - this.lastPriceFetch < 300000)) {
            return this.cachedSolPrice;
        }

        const priceUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
        const phpProxy = (typeof PHP_PROXY !== 'undefined') ? PHP_PROXY : 'proxy.php?url=';
        const thirdPartyProxies = (typeof PROXY_SERVICES !== 'undefined') ? PROXY_SERVICES : [
            { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' },
            { url: 'https://api.allorigins.win/raw?url=', name: 'allorigins' },
            { url: 'https://corsproxy.io/?', name: 'corsproxyio' }
        ];

        // 1) PHP proxy
        try {
            const r = await fetch(phpProxy + encodeURIComponent(priceUrl));
            if (r.ok) {
                const data = await r.json();
                if (data?.solana?.usd) {
                    log('SOL: Price via BACKEND');
                    this.cachedSolPrice = data.solana.usd;
                    this.lastPriceFetch = Date.now();
                    return data.solana.usd;
                }
            }
        } catch (e) {
            console.warn('Price fetch via PHP proxy failed:', e.message);
        }

        // 2) Third-party proxies
        for (const proxy of thirdPartyProxies) {
            try {
                const r = await fetch(proxy.url + encodeURIComponent(priceUrl));
                if (r.ok) {
                    const data = await r.json();
                    if (data?.solana?.usd) {
                        log(`SOL: Price via ${proxy.name.toUpperCase()} `);
                        this.cachedSolPrice = data.solana.usd;
                        this.lastPriceFetch = Date.now();
                        return data.solana.usd;
                    }
                }
            } catch (e) {
                console.warn(`Price fetch via ${proxy.name} failed: `, e.message);
            }
        }

        // 3) Direct
        try {
            const r = await fetch(priceUrl);
            if (r.ok) {
                const data = await r.json();
                if (data?.solana?.usd) {
                    log('SOL: Price via DIRECT');
                    this.cachedSolPrice = data.solana.usd;
                    this.lastPriceFetch = Date.now();
                    return data.solana.usd;
                }
            }
        } catch (e) {
            console.warn('Direct price fetch failed:', e.message);
        }

        return null;
    },

    getSitePDA() {
        const [pda] = solanaWeb3.PublicKey.findProgramAddressSync(
            [new TextEncoder().encode('geoint')],
            new solanaWeb3.PublicKey(this.CFG.MEMO)
        );
        return pda;
    },

    async rpc(method, params) {
        return rpcWithProxyChain(method, params);
    },

    base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    },

    getATAAddress(owner, mint, useToken2022 = false) {
        const tokenProgram = useToken2022 ? this.CFG.TOKEN_2022_PROGRAM : this.CFG.TOKEN_PROGRAM;
        const [ata] = solanaWeb3.PublicKey.findProgramAddressSync(
            [owner.toBuffer(), new solanaWeb3.PublicKey(tokenProgram).toBuffer(), mint.toBuffer()],
            new solanaWeb3.PublicKey(this.CFG.ATA_PROGRAM)
        );
        return ata;
    },

    getBondingCurvePDA(mint) {
        const [pda] = solanaWeb3.PublicKey.findProgramAddressSync(
            [new TextEncoder().encode('bonding-curve'), mint.toBuffer()],
            new solanaWeb3.PublicKey(this.CFG.PUMP_PROGRAM)
        );
        return pda;
    },

    async getBondingCurveData(bondingCurve) {
        try {
            const info = await this.rpc('getAccountInfo', [bondingCurve.toString(), { encoding: 'base64' }]);
            if (!info?.value?.data) return null;
            const data = this.base64ToUint8Array(info.value.data[0]);
            const view = new DataView(data.buffer);
            return {
                virtualTokenReserves: view.getBigUint64(8, true),
                virtualSolReserves: view.getBigUint64(16, true),
                complete: data[48] === 1
            };
        } catch (e) {
            console.error('getBondingCurveData error:', e);
            throw e;
        }
    },

    calculateTokensOut(solAmount, curveData) {
        const solIn = BigInt(solAmount);
        const virtualSol = curveData.virtualSolReserves;
        const virtualToken = curveData.virtualTokenReserves;
        const tokensOut = (solIn * virtualToken) / (virtualSol + solIn);
        return tokensOut * BigInt(90) / BigInt(100);
    },

    async getPumpPortalTransaction(userPubkey, mintAddress, solAmount) {
        const pumpUrl = 'https://pumpportal.fun/api/trade-local';
        const phpProxy = (typeof PHP_PROXY !== 'undefined') ? PHP_PROXY : 'proxy.php?url=';
        const thirdPartyProxies = (typeof PROXY_SERVICES !== 'undefined') ? PROXY_SERVICES : [
            { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' },
            { url: 'https://api.allorigins.win/raw?url=', name: 'allorigins' },
            { url: 'https://corsproxy.io/?', name: 'corsproxyio' }
        ];
        const postBody = JSON.stringify({
            publicKey: userPubkey.toString(),
            action: 'buy',
            mint: mintAddress,
            denominatedInSol: 'true',
            amount: solAmount,
            slippage: 10,
            priorityFee: 0.0005,
            pool: 'pump'
        });
        const fetchOpts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: postBody
        };

        // 1) PHP proxy
        try {
            const proxiedUrl = phpProxy + encodeURIComponent(pumpUrl);
            console.log('PumpPortal: Trying PHP proxy');
            const response = await fetch(proxiedUrl, fetchOpts);
            if (response.ok) {
                const data = await response.arrayBuffer();
                if (data.byteLength > 0) {
                    log('SOL: PumpPortal via BACKEND');
                    return solanaWeb3.VersionedTransaction.deserialize(new Uint8Array(data));
                }
            }
        } catch (e) {
            console.warn('PumpPortal: PHP proxy failed:', e.message);
        }

        // 2) Third-party proxies
        for (const proxy of thirdPartyProxies) {
            try {
                const proxiedUrl = proxy.url + encodeURIComponent(pumpUrl);
                console.log(`PumpPortal: Trying ${proxy.name} `);
                const response = await fetch(proxiedUrl, fetchOpts);
                if (response.ok) {
                    const data = await response.arrayBuffer();
                    if (data.byteLength > 0) {
                        log(`SOL: PumpPortal via ${proxy.name.toUpperCase()} `);
                        return solanaWeb3.VersionedTransaction.deserialize(new Uint8Array(data));
                    }
                }
            } catch (e) {
                console.warn(`PumpPortal: ${proxy.name} failed: `, e.message);
            }
        }

        // 3) Direct
        try {
            console.log('PumpPortal: Trying direct');
            const response = await fetch(pumpUrl, fetchOpts);
            if (response.ok) {
                const data = await response.arrayBuffer();
                log('SOL: PumpPortal via DIRECT');
                return solanaWeb3.VersionedTransaction.deserialize(new Uint8Array(data));
            } else {
                const errorText = await response.text();
                throw new Error(`PumpPortal API error: ${response.status} - ${errorText} `);
            }
        } catch (e) {
            console.warn('PumpPortal: Direct failed:', e.message);
            throw new Error(`All PumpPortal methods failed: ${e.message} `);
        }
    },

    async getTokenBalance(tokenAccount) {
        const addr = tokenAccount.toString();
        try {
            const info = await this.rpc('getTokenAccountBalance', [addr]);
            if (info?.value?.amount) return BigInt(info.value.amount);
        } catch { }
        try {
            const acctInfo = await this.rpc('getAccountInfo', [addr, { encoding: 'base64' }]);
            if (acctInfo?.value?.data) {
                const data = Uint8Array.from(atob(acctInfo.value.data[0]), c => c.charCodeAt(0));
                if (data.length >= 72) {
                    let amount = BigInt(0);
                    for (let i = 0; i < 8; i++) amount += BigInt(data[64 + i]) << BigInt(i * 8);
                    return amount;
                }
            }
        } catch { }
        return BigInt(0);
    },

    createBurnInstruction(tokenAccount, mint, owner, amount, decimals, useToken2022 = false) {
        const data = new Uint8Array(10);
        data[0] = 15;
        const amountBigInt = BigInt(amount);
        for (let i = 0; i < 8; i++) data[1 + i] = Number((amountBigInt >> BigInt(i * 8)) & BigInt(0xff));
        data[9] = decimals;
        const tokenProgram = useToken2022 ? this.CFG.TOKEN_2022_PROGRAM : this.CFG.TOKEN_PROGRAM;
        return new solanaWeb3.TransactionInstruction({
            programId: new solanaWeb3.PublicKey(tokenProgram),
            keys: [
                { pubkey: tokenAccount, isSigner: false, isWritable: true },
                { pubkey: mint, isSigner: false, isWritable: true },
                { pubkey: owner, isSigner: true, isWritable: false }
            ],
            data: data
        });
    },

    async waitForConfirmation(sig, maxAttempts = 120) { // Increased attempts, decreased interval
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 500)); // Sleep 0.5s instead of 3s
            try {
                const result = await this.rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]);
                const s = result?.value?.[0];
                if (s?.err) throw new Error('Transaction failed');
                if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return 'confirmed';
            } catch (e) {
                if (e.message === 'Transaction failed') throw e;
            }
        }
        return 'timeout';
    },

    formatEntityData(props, layer, coords) {
        const ts = new Date().toISOString();
        let data = { type: layer, time: ts };
        if (layer === 'flights') data = { ...data, callsign: props.callsign, icao: props.icao, alt: props.altitude || props.altitudeRaw, spd: props.velocity || props.velocityRaw, cat: props.category };
        else if (layer === 'ships' || layer === 'ships-dots') data = { ...data, vessel: props.vesselName, flag: props.flag, mmsi: props.ssvid, event: props.type };
        else if (layer === 'space-objects') data = { ...data, name: props.name, satType: props.type, alt: props.altitude || props.altitudeRaw };
        else if (layer === 'radio-stations') data = { ...data, station: props.name, country: props.country, codec: props.codec };
        else if (layer === 'mesh-nodes') data = { ...data, node: props.nodeName, nodeId: props.nodeId, meshType: props.meshType };
        else if (layer === 'repeaters') data = { ...data, callsign: props.callsign, freq: props.frequency, loc: props.location };
        else if (layer === 'cables') data = { ...data, cable: props.name, status: props.status };
        else if (layer === 'earthquake-circles') data = { ...data, mag: props.mag, place: props.place, depth: props.depth };
        else data = { ...data, raw: JSON.stringify(props).substring(0, 200) };
        if (coords) { data.lat = coords[1]?.toFixed(4); data.lng = coords[0]?.toFixed(4); }
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        return JSON.stringify(data).substring(0, 500);
    },

    async send(props, layer, coords) {
        let toast = null;
        // Auto-Repair: Check if we are actually connected via global scope
        if (!WalletManager.wallet || !WalletManager.pubkey) {
            const provider = window.phantom?.solana || window.solana;
            if (provider && (provider.isConnected || provider.publicKey)) {
                console.log('MEMO: Auto-repairing wallet connection...');
                WalletManager.wallet = provider;
                WalletManager.pubkey = provider.publicKey;
                // Update UI to match
                if (document.getElementById('w-status')) {
                    document.getElementById('w-status').textContent = 'CONNECTED';
                    document.getElementById('w-status').style.color = '#00ff00';
                }
            }
        }

        const wallet = WalletManager.wallet;
        const pubkey = WalletManager.pubkey;

        console.log('MEMO: Checking wallet state for upload...', { wallet, pubkey });

        if (!wallet || !pubkey) {
            Toast.show('warn', 'WALLET NOT CONNECTED - Opening wallet modal...', 3000);
            log('MEMO: Wallet not connected. Opening wallet...');

            // Try to open the modal programmatically
            const wBtn = document.getElementById('wallet-btn'); // Map icon
            if (wBtn) wBtn.click();

            return false;
        }
        const memo = this.formatEntityData(props, layer, coords);
        const layerName = layer.replace(/-/g, ' ').toUpperCase();
        const pot = this.CFG.POT;

        // Fetch SOL price and calculate $3 USD worth of SOL
        let solPrice = this.cachedSolPrice;

        if (!solPrice) {
            toast = Toast.show('info', 'FETCHING CURRENT SOL PRICE...');
            solPrice = await this.getSolPrice();
        } else {
            console.log('MEMO: Using cached price:', solPrice);
        }

        let feeLam;
        let feeDisplay;
        if (solPrice) {
            feeLam = Math.floor((this.FEE_USD / solPrice) * 1e9);
            const feeSol = feeLam / 1e9;
            feeDisplay = `${feeSol.toFixed(4)} SOL(~$${this.FEE_USD})`;
        } else {
            // Fallback to hardcoded value if price fetch fails
            feeLam = this.FEE_LAMPORTS;
            feeDisplay = `${(feeLam / 1e9).toFixed(4)} SOL`;
        }

        if (!toast) {
            toast = Toast.show('info', `INITIATING UPLOAD (Fee: ~$${this.FEE_USD})...`);
        } else {
            Toast.update(toast, 'info', `INITIATING UPLOAD (Fee: ~$${this.FEE_USD})...`);
        }
        log(`MEMO: Preparing to send ${layer} data with ${feeDisplay} fee...`);
        try {
            const bh = await this.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
            if (!bh?.value?.blockhash) throw new Error('Failed to get blockhash');
            const directLam = Math.floor(feeLam * 0.1);
            const swapLam = feeLam - directLam;
            const swapSol = swapLam / 1e9;

            const burnTokenMint = new solanaWeb3.PublicKey(this.CFG.BURN_TOKEN);
            const bondingCurve = this.getBondingCurvePDA(burnTokenMint);
            const userATA = this.getATAAddress(pubkey, burnTokenMint, true);

            Toast.update(toast, 'info', 'CHECKING TOKEN STATUS...');
            log('MEMO: Checking token bonding curve status...');
            const curveData = await this.getBondingCurveData(bondingCurve);
            if (!curveData) throw new Error('Could not fetch bonding curve data. Token may not exist on pump.fun.');

            const estimatedTokens = this.calculateTokensOut(swapLam, curveData);
            const estTokensDisplay = Number(estimatedTokens) / 1e6;
            const balanceBefore = await this.getTokenBalance(userATA);

            Toast.update(toast, 'info', `TX 1 / 2: BUYING ~${estTokensDisplay.toFixed(0)} TOKENS...`);
            log(`MEMO: TX1 - Buying tokens with ${swapSol} SOL...`);
            const buyTx = await this.getPumpPortalTransaction(pubkey, this.CFG.BURN_TOKEN, swapSol);
            Toast.update(toast, 'info', 'TX 1/2: APPROVE BUY IN WALLET...');
            const sig1 = (await wallet.signAndSendTransaction(buyTx))?.signature || (await wallet.signAndSendTransaction(buyTx));
            Toast.update(toast, 'info', `TX1 SENT! WAITING FOR CONFIRMATION...`);
            log(`MEMO: TX1 sent: ${sig1.slice(0, 8)}... waiting...`);
            await this.waitForConfirmation(sig1, 15);

            Toast.update(toast, 'info', 'TX 2/2: PREPARING MEMO + BURN...');
            log('MEMO: TX2 - Preparing transfer + memo + burn...');
            let balanceAfter = BigInt(0);
            for (let retry = 0; retry < 40; retry++) { // More retries, smaller interval
                balanceAfter = await this.getTokenBalance(userATA);
                if (balanceAfter > balanceBefore) break;
                await new Promise(r => setTimeout(r, 500)); // 0.5s sleep
            }
            const tokensToBurn = balanceAfter - balanceBefore;
            if (tokensToBurn <= BigInt(0)) {
                Toast.update(toast, 'error', 'NO TOKENS RECEIVED - CHECK TX1', 5000);
                log(`MEMO ERR: No tokens received from TX1`);
                return false;
            }
            const burnDisplay = Number(tokensToBurn) / 1e6;
            Toast.update(toast, 'info', `FOUND ${burnDisplay.toFixed(0)} TOKENS! BUILDING TX2...`);
            const bh2 = await this.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
            const tx2 = new solanaWeb3.Transaction({ recentBlockhash: bh2.value.blockhash, feePayer: pubkey });
            tx2.add(solanaWeb3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
            tx2.add(solanaWeb3.ComputeBudgetProgram.setComputeUnitLimit({ units: 150000 }));
            tx2.add(solanaWeb3.SystemProgram.transfer({ fromPubkey: pubkey, toPubkey: new solanaWeb3.PublicKey(pot), lamports: directLam }));
            tx2.add(new solanaWeb3.TransactionInstruction({
                keys: [{ pubkey, isSigner: true, isWritable: false }, { pubkey: this.getSitePDA(), isSigner: false, isWritable: true }],
                programId: new solanaWeb3.PublicKey(this.CFG.MEMO),
                data: new TextEncoder().encode(memo)
            }));
            tx2.add(this.createBurnInstruction(userATA, burnTokenMint, pubkey, tokensToBurn, 6, true));
            Toast.update(toast, 'info', 'TX 2/2: APPROVE MEMO+BURN IN WALLET...');
            const sig2 = (await wallet.signAndSendTransaction(tx2))?.signature || (await wallet.signAndSendTransaction(tx2));
            Toast.update(toast, 'info', 'TX2 SENT! CONFIRMING...');
            log(`MEMO: TX2 sent: ${sig2.slice(0, 8)}... confirming...`);
            await this.waitForConfirmation(sig2, 10);
            const burnedAmount = Number(tokensToBurn) / 1e6;
            const shortSig2 = sig2.slice(0, 6) + '...' + sig2.slice(-4);
            Toast.update(toast, 'success', `DONE! ${burnedAmount.toFixed(0)} TOKENS BURNED! TX: ${shortSig2} `, 6000);
            log(`MEMO: Success! ${burnedAmount.toFixed(0)} tokens burned.TX1: ${sig1.slice(0, 8)}...TX2: ${sig2.slice(0, 8)}...`);
            return sig2;
        } catch (e) {
            console.error('MEMO: Send error:', e);
            const errMsg = e.message || 'Unknown error';
            if (errMsg.includes('User rejected') || errMsg.includes('rejected') || errMsg.includes('cancelled')) {
                Toast.update(toast, 'error', 'TRANSACTION CANCELLED BY USER', 4000);
                log('MEMO: Transaction cancelled by user.');
            } else if (errMsg.includes('insufficient')) {
                Toast.update(toast, 'error', 'INSUFFICIENT SOL BALANCE (NEED ~0.006 SOL)', 4000);
                log('MEMO: Insufficient SOL balance.');
            } else {
                Toast.update(toast, 'error', `ERROR: ${errMsg.substring(0, 50)} `, 5000);
                log(`MEMO ERR: ${errMsg} `);
            }
            return false;
        }
    }
};

// Expose to window for inline HTML handlers
window.MemoFeed = MemoFeed;
window.WalletManager = WalletManager;
window.MemoSender = MemoSender;

export { MemoFeed, WalletManager, MemoSender };

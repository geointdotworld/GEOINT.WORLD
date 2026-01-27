/**
 * InscriptionRegistry
 * Centralized handler for "locating" items from the live feed (inscriptions).
 * 
 * Usage:
 * 1. Modules register themselves: InscriptionRegistry.register('my-type', { ...handler... })
 * 2. LiveFeed calls: InscriptionRegistry.handle(data, coords)
 */

window.InscriptionRegistry = {
    handlers: new Map(),

    // Temporary marker reference (to remove it later)
    currentMarker: null,

    /**
     * Register a handler for a specific type
     * @param {string|string[]} types - 'flights', 'ships', etc. (can be array)
     * @param {object} handler - { hydrate(data), getMarker(data), showPopup(data, coords) }
     */
    register(types, handler) {
        const typeArray = Array.isArray(types) ? types : [types];
        typeArray.forEach(t => {
            this.handlers.set(t, handler);
            // console.log(`REGISTRY: Registered handler for '${t}'`);
        });
    },

    /**
     * Main Entry Point: Handle a "Locate" request
     * @param {object} data - The parsed inscription data object
     * @param {Array} coords - [lng, lat]
     */
    handle(data, coords) {
        if (!data || !coords) return;

        // 1. Remove any existing temporary marker
        this.clearMarker();

        // 2. hydrate data (try to find it on the map first)
        const hydratedData = this.hydrate(data);
        const finalData = hydratedData || data;

        // 3. Logic: If hydrated (found on map), we usually just open the popup.
        // If NOT found (layer off, or old data), we show a temporary marker.
        // EXCEPTION: Some handlers might want to show a marker even if found (logic depends on handler)

        // Detailed Logic:
        // If we found the real feature on the map, use its rich properties.
        // If not, we MUST show a visual marker so the user knows where it is.

        if (!hydratedData) {
            console.log(`LOCATE: Target not visible on map. Adding temporary marker for '${finalData.type}'`);
            this.addTemporaryMarker(finalData, coords);
        } else {
            console.log(`LOCATE: Target found on map. Hydrating...`);
        }

        // 4. Show Popup
        // If the handler has a specific showPopup method, use it.
        // Otherwise, fall back to a generic one.
        const handler = this.handlers.get(finalData.type);
        if (handler && typeof handler.showPopup === 'function') {
            handler.showPopup(finalData, coords);
        } else {
            this.fallbackPopup(finalData, coords);
        }
    },

    /**
     * Try to find the entity in loaded map sources
     */
    hydrate(data) {
        const handler = this.handlers.get(data.type);
        if (handler && typeof handler.hydrate === 'function') {
            const found = handler.hydrate(data);
            if (found) {
                // Merge found props with original data 
                // (Important: Keep signature, _fromLiveFeed, etc. from original)
                return {
                    ...found,
                    ...data, // overlay original data (like sig) on top? Or vice versa? 
                    // Usually we want rich map props, but keep the 'inscription' context.
                    // Let's do: found props + original context props
                    signature: data.signature,
                    _fromLiveFeed: true,
                    _forceTimeLabel: data._forceTimeLabel,
                    time: data.time // Prefer feed time for consistency with label? Or map time? Map time is usually 'now'.
                };
            }
        }
        return null;
    },

    /**
     * Add a temporary visual marker to the map
     */
    addTemporaryMarker(data, coords) {
        if (typeof map === 'undefined' || !map) return;

        const el = document.createElement('div');
        el.className = 'temp-marker';

        // Styling defaults
        el.style.width = '24px';
        el.style.height = '24px';

        // Get content from handler
        const handler = this.handlers.get(data.type);
        if (handler && typeof handler.getMarker === 'function') {
            const result = handler.getMarker(data);
            // Result can be an HTML string or an Element, or an object { html, style }
            if (typeof result === 'string') {
                el.innerHTML = result;
            } else if (result.html) {
                el.innerHTML = result.html;
                if (result.transform) el.style.transform = result.transform;
                if (result.color) el.style.color = result.color;
                if (result.style) {
                    Object.assign(el.style, result.style);
                }
            }
        } else {
            // Generic Fallback
            el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="2"><circle cx="12" cy="12" r="6"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`;
        }

        this.currentMarker = new maplibregl.Marker({ element: el })
            .setLngLat(coords)
            .addTo(map);

        // Auto-remove logic matching existing behavior
        const checkPopup = setInterval(() => {
            if (!document.querySelector('.maplibregl-popup')) {
                this.clearMarker();
                clearInterval(checkPopup);
            }
        }, 1000);
    },

    clearMarker() {
        if (this.currentMarker) {
            this.currentMarker.remove();
            this.currentMarker = null;
        }
    },

    fallbackPopup(data, coords) {
        // Generic popup if no handler defined
        const html = `<div class='popup-row'>LOCATED SIGNAL</div>` +
            (data.signature ? `<div class="popup-row"><a href="https://solscan.io/tx/${data.signature}" target="_blank" class="intel-btn" style="margin-top:10px">[ VIEW ON SOLSCAN ]</a></div>` : '');

        if (window.createPopup) {
            window.createPopup(coords, html, data, 'generic', { className: 'cyber-popup' });
        }
    }
};

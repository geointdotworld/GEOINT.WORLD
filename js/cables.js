// --- Deep Sea Cable Data Logic (TeleGeography) ---

let cableMetadata = {}; // Cache for cable metadata
let cableGeoData = null; // Cache for cable geometries
let landingPointsData = null; // Cache for landing points

// Expose caches to window for cache size calculation
exposeCache('cableMetadata', () => cableMetadata);
exposeCache('cableGeoData', () => cableGeoData);
exposeCache('landingPointsData', () => landingPointsData);


async function fetchCables() {
    try {
        logSystem("NET: Connecting to TeleGeography Submarine Cable Database...");

        // UI: Loading Start
        const loadingBar = document.getElementById('status-box');
        const loadingText = document.getElementById('loading-text');
        if (loadingBar) {
            loadingBar.style.display = 'block';
            loadingText.innerText = `LOADING CABLE DATA...`;
            loadingText.className = 'text-dim';
        }

        // TeleGeography API URLs
        const baseUrl = 'https://www.submarinecablemap.com/api/v3';
        const targetUrls = {
            geo: `${baseUrl}/cable/cable-geo.json`,
            metadata: `${baseUrl}/cable/all.json`,
            landing: `${baseUrl}/landing-point/landing-point-geo.json`
        };

        logSystem("NET: Fetching cable data via proxy chain...");

        let geoResponse, metadataResponse, landingPointsResponse;
        let cableProxySource = null;

        try {
            // Use fetchWithProxyChain for all three requests (PHP proxy first, third-party fallback)
            [geoResponse, metadataResponse, landingPointsResponse] = await Promise.all([
                fetchWithProxyChain(targetUrls.geo),
                fetchWithProxyChain(targetUrls.metadata),
                fetchWithProxyChain(targetUrls.landing)
            ]);

            // Capture proxy source from first successful response
            cableProxySource = geoResponse.proxySource || metadataResponse.proxySource || 'unknown';
            const sourceLabel = cableProxySource === 'php' ? 'BACKEND' : `THIRD-PARTY (${cableProxySource})`;
            logSystem(`NET: Cable data (TeleGeography) via ${sourceLabel}`);

            // Check for failed responses
            if (!geoResponse.ok) {
                const errorText = await geoResponse.text();
                console.error('Cable Geo API Error:', {
                    status: geoResponse.status,
                    statusText: geoResponse.statusText,
                    url: geoResponse.url,
                    response: errorText
                });
                throw new Error(`Geo fetch failed: HTTP ${geoResponse.status}`);
            }
            if (!metadataResponse.ok) {
                const errorText = await metadataResponse.text();
                console.error('Cable Metadata API Error:', {
                    status: metadataResponse.status,
                    statusText: metadataResponse.statusText,
                    url: metadataResponse.url,
                    response: errorText
                });
                throw new Error(`Metadata fetch failed: HTTP ${metadataResponse.status}`);
            }
            if (!landingPointsResponse.ok) {
                const errorText = await landingPointsResponse.text();
                console.error('Landing Points API Error:', {
                    status: landingPointsResponse.status,
                    statusText: landingPointsResponse.statusText,
                    url: landingPointsResponse.url,
                    response: errorText
                });
                throw new Error(`Landing points fetch failed: HTTP ${landingPointsResponse.status}`);
            }
        } catch (e) {
            console.error('Cable API fetch error:', e);
            throw e;
        }

        let cableGeoData, metadataArray, landingPointsGeo;

        try {
            cableGeoData = await geoResponse.json();
            metadataArray = await metadataResponse.json();
            landingPointsGeo = await landingPointsResponse.json();
        } catch (parseError) {
            throw new Error(`Failed to parse JSON: ${parseError.message}`);
        }

        // Validate data structure
        if (!cableGeoData || !cableGeoData.features || !Array.isArray(cableGeoData.features)) {
            throw new Error('Invalid cable geometry data structure');
        }
        if (!Array.isArray(metadataArray)) {
            throw new Error('Invalid metadata data structure');
        }
        if (!landingPointsGeo || !landingPointsGeo.features || !Array.isArray(landingPointsGeo.features)) {
            throw new Error('Invalid landing points data structure');
        }

        // Convert metadata array to object keyed by cable ID for quick lookup
        cableMetadata = {};
        metadataArray.forEach(cable => {
            if (cable && cable.id) {
                cableMetadata[cable.id] = cable;
            }
        });

        landingPointsData = landingPointsGeo;

        logSystem(`NET: Processing ${cableGeoData.features.length} cable geometries...`);

        // Process cable geometries and enrich with metadata
        const cableFeatures = cableGeoData.features
            .filter(feature => feature && feature.geometry) // Filter out invalid features
            .map(feature => {
                const cableId = feature.properties?.id || feature.properties?.cable_id || feature.id;
                const metadata = cableMetadata[cableId] || {};

                // Format RFS date
                let rfsDate = 'N/A';
                if (metadata.rfs) {
                    const date = new Date(metadata.rfs);
                    rfsDate = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                }

                // Get owners/consortium
                const owners = metadata.owners || [];
                const ownerNames = owners.length > 0
                    ? owners.map(o => o.name || 'Unknown').join(', ')
                    : 'N/A';

                // Determine status (we'll mark as operational by default since we don't have real-time status)
                // In a production system, you'd cross-reference with IODA or other outage data
                const status = 'OPERATIONAL'; // Default assumption

                // Generate submarinecablemap.com URL from cable name
                // Format: https://www.submarinecablemap.com/submarine-cable/{slug}
                const cableName = metadata.name || 'UNNAMED CABLE';
                const slug = cableName.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
                    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
                const cableUrl = `https://www.submarinecablemap.com/submarine-cable/${slug}`;

                // Use metadata URL if available and valid, otherwise use generated URL
                const finalUrl = (metadata.url && metadata.url.trim()) ? metadata.url : cableUrl;

                return {
                    type: 'Feature',
                    geometry: feature.geometry,
                    properties: {
                        id: cableId,
                        name: cableName,
                        rfs: rfsDate,
                        owners: ownerNames,
                        length: metadata.length ? `${metadata.length} km` : 'N/A',
                        status: status,
                        url: finalUrl
                    }
                };
            });

        // Process landing points
        const landingPointFeatures = landingPointsGeo.features
            .filter(feature => feature && feature.geometry) // Filter out invalid features
            .map(feature => {
                return {
                    type: 'Feature',
                    geometry: feature.geometry,
                    properties: {
                        id: feature.id || feature.properties?.id || 'unknown',
                        name: feature.properties?.name || feature.properties?.landing_point_name || 'UNKNOWN LANDING POINT',
                        country: feature.properties?.country || feature.properties?.country_name || 'N/A'
                    }
                };
            });

        logSystem(`NET: Loaded ${cableFeatures.length} submarine cables and ${landingPointFeatures.length} landing points.`);

        // Update map sources
        const cableSource = map.getSource('cable-data');
        if (cableSource) {
            const cableGeoJson = {
                type: 'FeatureCollection',
                features: cableFeatures
            };
            if (typeof window.safeSetData === 'function') {
                window.safeSetData(cableSource, cableGeoJson);
            } else {
                cableSource.setData(cableGeoJson);
            }
        }

        const landingSource = map.getSource('landing-points-data');
        if (landingSource) {
            const landingGeoJson = {
                type: 'FeatureCollection',
                features: landingPointFeatures
            };
            if (typeof window.safeSetData === 'function') {
                window.safeSetData(landingSource, landingGeoJson);
            } else {
                landingSource.setData(landingGeoJson);
            }
        }

        // UI: Done
        if (loadingBar) {
            loadingBar.style.display = 'none';
        }

        logSystem("GUI: Submarine cable network updated.");

    } catch (err) {
        const loadingBar = document.getElementById('status-box');
        if (loadingBar) loadingBar.style.display = 'none';
        logSystem(`ERR: Cable Feed Error - ${err.message}`);
        console.error('Cable fetch error:', err);
    }
}


/**
 * Data Worker for GEOINT.WORLD
 * Handles heavy GeoJSON processing and filtering to offload the main thread.
 */

self.onmessage = function (e) {
    const { type, data, config } = e.data;

    switch (type) {
        case 'PROCESS_FLIGHTS':
            processFlights(data, config);
            break;
        case 'PROCESS_SHIPS':
            processShips(data, config);
            break;
    }
};

function processFlights(states, config) {
    const { entityLimit, minFlightAltitude, selectedSquawks, flightFilters, useMetric } = config;
    const features = [];
    const counts = { total: 0, standard: 0, military: 0, pia: 0, ladd: 0, helo: 0, alert: 0, ghost: 0, nosquawk: 0 };
    const currentBatchSquawks = new Set();
    let anomalyCount = 0;
    let heloCount = 0;
    let militaryCount = 0;

    if (!states) return;

    for (let i = 0; i < states.length; i++) {
        if (features.length >= entityLimit) break;

        const s = states[i];
        if (!s[5] || !s[6]) continue;

        const icao24 = s[0];
        const callsign = s[1] ? s[1].trim() : "NO_ID";
        const lon = s[5];
        const lat = s[6];
        const squawk = (s[14] !== null && s[14] !== undefined && s[14] !== "") ? String(s[14]) : "null";
        const geoAltitude = s[13];
        const category = s[17];
        const origin = s[2];
        const baroAltitude = s[7];
        const onGround = s[8];
        const verticalRate = s[11];
        const lastUpdate = s[4];
        const spi = s[15];
        const positionSource = s[16];

        if (squawk !== "null" && squawk !== "") {
            currentBatchSquawks.add(squawk);
        }

        let type = "standard";
        let iconType = "plane-icon";

        counts.total++;

        const isNoSq = (squawk === "null");
        const isGhost = (callsign === "" || callsign === "NO_ID");

        // Military Heuristics
        const milPrefixes = ["MIL", "NAVY", "RCH", "CFC", "ASCOT", "RRR", "SPAR", "REACH", "JAMBO", "DUKE", "HAWK", "DRAGON", "BART", "VADER", "VIPER", "BOLD", "TITAN", "AF1", "AIRFOR", "SAM", "GUARD"];
        const isMil = category === 8 || category === 9 || milPrefixes.some(p => callsign.startsWith(p));
        const isPia = category === 11;
        const isLdd = category === 12;

        if (squawk === "7700" || squawk === "7500" || squawk === "7600" || spi === true) {
            type = "alert";
            anomalyCount++;
        } else if (isMil) {
            type = "military";
            militaryCount++;
            // Preserve Helo Icon for visual distinction
            if (category === 9 || callsign.includes("HELO") || callsign.includes("MEDEVAC") || callsign.includes("POLICE")) {
                iconType = "helo-icon";
            }
        } else if (isLdd) {
            type = "ladd";
            // LDD counts handled by generic counts[type]++
        } else if (isPia) {
            type = "pia";
            // PIA counts handled by generic counts[type]++
        } else if (isGhost) {
            type = "ghost";
            anomalyCount++;
        } else if (isNoSq) {
            type = "nosquawk";
        } else {
            type = "standard";
            counts.standard++;
        }

        if (counts[type] !== undefined && type !== "standard") {
            counts[type]++;
        }

        // Filtering
        if (type === "nosquawk") {
            if (!flightFilters.nosquawk) continue;
        } else if (type === "ghost") {
            if (!flightFilters.ghost) continue;
        } else if (type === "alert") {
            if (!flightFilters.alert) continue;
        } else if (type === "military") {
            if (!flightFilters.military) continue;
        } else if (type === "pia") {
            if (!flightFilters.pia) continue;
        } else if (type === "ladd") {
            if (!flightFilters.ladd) continue;
        } else {
            if (!flightFilters.standard) continue;
        }

        if (geoAltitude < minFlightAltitude) continue;
        if (selectedSquawks.length > 0 && !selectedSquawks.includes(squawk)) continue;

        // Heading fix
        let heading = s[10];
        if (heading === null || heading === undefined) heading = 0;

        // Format Display Values
        let velDisplay, altDisplay, vRateDisplay, baroDisplay;
        if (useMetric) {
            velDisplay = Math.round(s[9] * 3.6) + ' km/h';
            altDisplay = Math.round(geoAltitude) + ' m';
            baroDisplay = baroAltitude ? Math.round(baroAltitude) + ' m' : 'N/A';
            vRateDisplay = verticalRate ? (verticalRate > 0 ? '+' : '') + (verticalRate * 60).toFixed(0) + ' m/min' : 'LEVEL';
        } else {
            velDisplay = Math.round(s[9] * 2.23694) + ' mph';
            altDisplay = Math.round(geoAltitude * 3.28084) + ' ft';
            baroDisplay = baroAltitude ? Math.round(baroAltitude * 3.28084) + ' ft' : 'N/A';
            vRateDisplay = verticalRate ? (verticalRate > 0 ? '+' : '') + Math.round(verticalRate * 196.85) + ' fpm' : 'LEVEL';
        }

        const sourceMap = ["ADS-B", "Mode-S", "Radar", "Multilateration", "Other"];
        const sourceLabel = sourceMap[positionSource] || "Unknown";

        features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties: {
                icao: icao24,
                callsign: callsign,
                origin: origin,
                velocity: velDisplay,
                altitude: altDisplay,
                velocityRaw: s[9],
                altitudeRaw: geoAltitude,
                baroAltitude: baroDisplay,
                onGround: onGround ? "YES" : "NO",
                verticalRate: vRateDisplay,
                verticalRateRaw: verticalRate,
                squawk: squawk,
                heading: heading,
                category: category,
                type: type,
                iconType: iconType,
                source: sourceLabel,
                spi: spi ? "ALERT" : "NORMAL",
                lastSeen: lastUpdate ? new Date(lastUpdate * 1000).toISOString() : "N/A"
            }
        });
    }

    self.postMessage({
        type: 'FLIGHTS_PROCESSED',
        result: {
            features: features,
            counts: counts,
            batchSquawks: Array.from(currentBatchSquawks)
        }
    });
}

function processShips(allEvents, config) {
    const { entityLimit } = config;
    const features = [];
    let countGap = 0, countEncounter = 0, countLoitering = 0, countFishing = 0, countPort = 0;

    for (let i = 0; i < allEvents.length; i++) {
        const event = allEvents[i];
        if (!event.position) continue;

        let iconType = 'ship-icon';
        let color = '#0088ff';
        let eventLabel = event.type;
        let priority = 0;

        if (event.type === 'encounter') {
            color = '#ff00ff';
            eventLabel = "AT-SEA ENCOUNTER";
            priority = 4;
            countEncounter++;
        } else if (event.type === 'gap') {
            color = '#ff3333';
            eventLabel = "AIS GAP (DARK)";
            priority = 5;
            countGap++;
        } else if (event.type === 'loitering') {
            color = '#ff6800';
            eventLabel = "LOITERING";
            priority = 3;
            countLoitering++;
        } else if (event.type === 'fishing') {
            color = '#00ffcc';
            eventLabel = "FISHING ACTIVITY";
            priority = 2;
            countFishing++;
        } else if (event.type === 'port_visit') {
            color = '#0088ff';
            eventLabel = "PORT VISIT";
            priority = 1;
            countPort++;
        }

        features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [event.position.lon, event.position.lat]
            },
            properties: {
                id: event.id,
                type: eventLabel,
                rawType: event.type,
                vesselId: event.vessel.id,
                ssvid: event.vessel.ssvid,
                imo: event.vessel.imo,
                vesselName: event.vessel.name || "UNKNOWN VESSEL",
                flag: event.vessel.flag || "XX",
                start: event.start,
                end: event.end,
                iconType: iconType,
                iconColor: color,
                priority: priority
            }
        });
    }

    // Sort by priority to ensure critical events are on top
    features.sort((a, b) => a.properties.priority - b.properties.priority);

    self.postMessage({
        type: 'SHIPS_PROCESSED',
        result: {
            features: features,
            counts: {
                gap: countGap,
                encounter: countEncounter,
                loitering: countLoitering,
                fishing: countFishing,
                port: countPort
            }
        }
    });
}

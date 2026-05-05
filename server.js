const express = require('express');
const cors = require('cors');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fs = require('fs');

const app = express();
const port = 3000;
app.use(cors());
app.use(express.static('public'));

// --- LOAD TRIP DICTIONARY ---
let tripDict = {};
try {
    tripDict = JSON.parse(fs.readFileSync('./trip-dict.json', 'utf8'));
    console.log(`Loaded ${Object.keys(tripDict).length} trip destinations into memory.`);
} catch (error) {
    console.error("Warning: trip-dict.json not found. Run cruncher first!");
}

// --- CACHING & MEMORY SYSTEM ---
let cachedFerryData = [];
let lastFetchTime = 0;
const CACHE_LIFESPAN = 10000;
const serverFerryHistory = {}; // NEW: The server's memory bank for the tails!

app.get('/api/ferries', async (req, res) => {
    try {
        const now = Date.now();
        if (now - lastFetchTime < CACHE_LIFESPAN && cachedFerryData.length > 0) {
            return res.json(cachedFerryData);
        }

        const response = await fetch('http://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions');
        if (!response.ok) throw new Error(`Network error: ${response.status}`);

        const buffer = await response.arrayBuffer();
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

        const smbiFerries = feed.entity.filter(entity => {
            const routeId = entity.vehicle?.trip?.routeId;
            if (!routeId) return false; 
            return routeId.includes('SMBI') || routeId.includes('299');
        });

       const cleanFerryList = smbiFerries.map(ferry => {
            const tripId = ferry.vehicle.trip.tripId;
            const tripInfo = tripDict[tripId] || { destination: "Islands", route_id: "Unknown" };

            const rawId = ferry.vehicle.vehicle.id;
            const vesselName = rawId.includes('_') ? rawId.split('_')[1] : "SMBI Ferry";
            
            const currentLat = ferry.vehicle.position.latitude;
            const currentLon = ferry.vehicle.position.longitude;

            // --- UPDATE SERVER MEMORY & ANTI-TELEPORTATION ---
            if (!serverFerryHistory[rawId]) {
                serverFerryHistory[rawId] = [];
            }
            
            const history = serverFerryHistory[rawId];
            const lastPos = history[history.length - 1];

            // Anti-Teleportation Check: If it jumps too far in 15 seconds, wipe the memory
            if (lastPos) {
                const latDiff = Math.abs(currentLat - lastPos[0]);
                const lonDiff = Math.abs(currentLon - lastPos[1]);
                if (latDiff > 0.008 || lonDiff > 0.008) {
                    serverFerryHistory[rawId] = []; 
                }
            }

            const activeHistory = serverFerryHistory[rawId];
            const activeLastPos = activeHistory[activeHistory.length - 1];

            // Only add dot if it moved
            if (!activeLastPos || activeLastPos[0] !== currentLat || activeLastPos[1] !== currentLon) {
                activeHistory.push([currentLat, currentLon]);
                if (activeHistory.length > 4) {
                    activeHistory.shift(); 
                }
            }

            return {
                id: rawId,
                vesselName: vesselName,
                staticRouteId: tripInfo.route_id,
                destination: tripInfo.destination,
                latitude: currentLat,
                longitude: currentLon,
                history: activeHistory // Send the cleaned tail to the phone!
            };
        });

        cachedFerryData = cleanFerryList;
        lastFetchTime = Date.now();
        res.json(cachedFerryData);

    } catch (error) {
        console.error("Something went wrong:", error);
        res.status(500).json({ error: "Failed to fetch ferry data" });
    }
});

app.listen(port, () => {
    console.log(`SMBI Live Server running on port ${port}`);
});
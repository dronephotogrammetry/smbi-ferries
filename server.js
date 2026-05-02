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

// --- CACHING SYSTEM ---
let cachedFerryData = [];
let lastFetchTime = 0;
const CACHE_LIFESPAN = 15000;

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
            // Access the new smart dictionary
            const tripInfo = tripDict[tripId] || { destination: "Islands", route_id: "Unknown" };

            const rawId = ferry.vehicle.vehicle.id;
            const vesselName = rawId.includes('_') ? rawId.split('_')[1] : "SMBI Ferry";

            return {
                id: rawId,
                vesselName: vesselName,
                staticRouteId: tripInfo.route_id, // <--- Serve the static route code!
                destination: tripInfo.destination,
                latitude: ferry.vehicle.position.latitude,
                longitude: ferry.vehicle.position.longitude
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
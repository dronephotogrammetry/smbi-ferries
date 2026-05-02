const fs = require('fs');
const csv = require('csv-parser');

async function buildSchedule() {
    console.log("1. Finding Ferry Routes...");
    const ferryRouteIds = new Set();
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/routes.txt').pipe(csv())
            .on('data', row => {
                if (row.route_type === '4' || row.route_id.includes('SMBI')) {
                    ferryRouteIds.add(row.route_id);
                }
            })
            .on('end', resolve);
    });

    console.log("2. Mapping TransLink Calendar...");
    const serviceDays = {};
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/calendar.txt').pipe(csv())
            .on('data', row => {
                serviceDays[row.service_id] = {
                    1: row.monday === '1', 2: row.tuesday === '1', 3: row.wednesday === '1',
                    4: row.thursday === '1', 5: row.friday === '1', 6: row.saturday === '1', 0: row.sunday === '1' 
                };
            })
            .on('end', resolve);
    });

    console.log("3. Building Server Dictionary (Now with Route IDs!)...");
    const tripData = {};
    const tripDict = {}; 
    const smbiShapeIds = new Set();
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/trips.txt').pipe(csv())
            .on('data', row => {
                if (ferryRouteIds.has(row.route_id)) {
                    tripData[row.trip_id] = {
                        destination: row.trip_headsign || "Ferry",
                        service_id: row.service_id
                    };
                    // NEW: Store the static route ID so we can color coordinate!
                    tripDict[row.trip_id] = {
                        destination: row.trip_headsign || "Ferry",
                        route_id: row.route_id,
                        shape_id: row.shape_id
                    };
                    if (row.shape_id) smbiShapeIds.add(row.shape_id);
                }
            })
            .on('end', resolve);
    });
    fs.writeFileSync('./trip-dict.json', JSON.stringify(tripDict, null, 2));

    console.log("4. Locating Island Terminals...");
    const targetStops = {};
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/stops.txt').pipe(csv())
            .on('data', row => {
                const name = row.stop_name.toLowerCase();
                if (name.includes('macleay') || name.includes('russell') || 
                    name.includes('lamb') || name.includes('karragarra') || name.includes('redland bay marina')) {
                    targetStops[row.stop_id] = row.stop_name.replace(' ferry terminal', '').trim();
                }
            })
            .on('end', resolve);
    });

    console.log("5. Crunching Stop Times...");
    const schedule = [];
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/stop_times.txt').pipe(csv())
            .on('data', row => {
                if (tripData[row.trip_id] && targetStops[row.stop_id]) {
                    schedule.push({
                        time: row.arrival_time, destination: tripData[row.trip_id].destination,
                        stop: targetStops[row.stop_id], days: serviceDays[tripData[row.trip_id].service_id]
                    });
                }
            })
            .on('end', resolve);
    });
    fs.writeFileSync('./public/smbi-timetable.json', JSON.stringify(schedule, null, 2));

    console.log("6. Extracting FULL Resolution Route Shapes...");
    const rawShapes = {};
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_raw/shapes.txt').pipe(csv())
            .on('data', row => {
                if (smbiShapeIds.has(row.shape_id)) {
                    if (!rawShapes[row.shape_id]) rawShapes[row.shape_id] = [];
                    rawShapes[row.shape_id].push({
                        lat: parseFloat(row.shape_pt_lat),
                        lon: parseFloat(row.shape_pt_lon),
                        seq: parseInt(row.shape_pt_sequence)
                    });
                }
            })
            .on('end', resolve);
    });

    const cleanShapes = [];
    for (const shapeId in rawShapes) {
        rawShapes[shapeId].sort((a, b) => a.seq - b.seq);
        
        // NO MORE DECIMATION! Keep every single point for perfect curves.
        const coords = rawShapes[shapeId].map(pt => [pt.lat, pt.lon]);
        
        // Find out which route this shape belongs to so we can color it
        let routeId = "Unknown";
        for (const trip in tripDict) {
            if (tripDict[trip].shape_id === shapeId) {
                routeId = tripDict[trip].route_id;
                break;
            }
        }
        cleanShapes.push({ shape_id: shapeId, route_id: routeId, coords: coords });
    }
    fs.writeFileSync('./public/smbi-shapes.json', JSON.stringify(cleanShapes));
    
    console.log("SUCCESS! Full resolution shapes and smarter dictionary generated!");
}

buildSchedule();
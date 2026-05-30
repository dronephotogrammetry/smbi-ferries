const fs = require('fs');
const csv = require('csv-parser');

async function buildSchedule() {
    console.log("1. Finding Ferry Routes...");
    const ferryRouteIds = new Set();
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_data/routes.txt').pipe(csv())
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
        fs.createReadStream('./gtfs_data/calendar.txt').pipe(csv())
            .on('data', row => {
                serviceDays[row.service_id] = {
                    1: row.monday === '1', 2: row.tuesday === '1', 3: row.wednesday === '1',
                    4: row.thursday === '1', 5: row.friday === '1', 6: row.saturday === '1', 0: row.sunday === '1' 
                };
            })
            .on('end', resolve);
    });

    console.log("3. Finding Ferry Trips & Shapes...");
    const tripData = {};
    const ferryTrips = new Set(); // <-- The missing list is now created here!
    const smbiShapeIds = new Set();
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_data/trips.txt').pipe(csv())
            .on('data', row => {
                if (ferryRouteIds.has(row.route_id)) {
                    ferryTrips.add(row.trip_id);
                    tripData[row.trip_id] = {
                        destination: row.trip_headsign || "Ferry",
                        service_id: row.service_id,
                        route_id: row.route_id,
                        shape_id: row.shape_id
                    };
                    if (row.shape_id) smbiShapeIds.add(row.shape_id);
                }
            })
            .on('end', resolve);
    });

    console.log("4. Locating Island Terminals...");
    const targetStops = {};
    const russellStopIds = new Set();
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_data/stops.txt').pipe(csv())
            .on('data', row => {
                const name = row.stop_name.toLowerCase();
                if (name.includes('macleay') || name.includes('russell') || 
                    name.includes('lamb') || name.includes('karragarra') || name.includes('redland bay marina')) {
                    targetStops[row.stop_id] = row.stop_name.replace(' ferry terminal', '').trim();
                    if (name.includes('russell')) russellStopIds.add(row.stop_id);
                }
            })
            .on('end', resolve);
    });

    console.log("5. Finding True Final Destinations & Crunching Stop Times...");
    const tripFinalStops = {};
    const schedule = [];
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_data/stop_times.txt').pipe(csv())
            .on('data', row => {
                if (ferryTrips.has(row.trip_id)) {
                    // Track the final physical stop of the boat
                    const seq = parseInt(row.stop_sequence);
                    if (!tripFinalStops[row.trip_id] || seq > tripFinalStops[row.trip_id].seq) {
                        tripFinalStops[row.trip_id] = { seq: seq, stop_id: row.stop_id };
                    }

                    // Save the schedule info
                    if (targetStops[row.stop_id]) {
                        schedule.push({
                            trip_id: row.trip_id, 
                            time: row.arrival_time, 
                            destination: tripData[row.trip_id].destination,
                            stop: targetStops[row.stop_id], 
                            days: serviceDays[tripData[row.trip_id].service_id]
                        });
                    }
                }
            })
            .on('end', resolve);
    });

    console.log("6. Finalizing Dictionary and Schedule Files...");
    const tripDict = {};
    
    // Now that we know the true final stop, build the Red Flags!
    for (const tripId of ferryTrips) {
        const finalStopData = tripFinalStops[tripId];
        let isTerminating = false;

        // The bulletproof check: Is the very last stop Russell Island?
        if (finalStopData && russellStopIds.has(finalStopData.stop_id)) {
            isTerminating = true;
        }

        // Build the backend dictionary for the map
        tripDict[tripId] = {
            destination: tripData[tripId].destination,
            route_id: tripData[tripId].route_id,
            shape_id: tripData[tripId].shape_id,
            is_terminating: isTerminating
        };
        
        // Save the flag so the timetable loop below can grab it
        tripData[tripId].is_terminating = isTerminating; 
    }
    
    // Build the frontend schedule file with the new flag
    const cleanSchedule = schedule.map(entry => ({
        time: entry.time,
        destination: entry.destination,
        stop: entry.stop,
        days: entry.days,
        is_terminating: tripData[entry.trip_id].is_terminating
    }));

    // Save the files!
    fs.writeFileSync('./trip-dict.json', JSON.stringify(tripDict, null, 2));
    fs.writeFileSync('./public/smbi-timetable.json', JSON.stringify(cleanSchedule, null, 2));

    console.log("7. Extracting FULL Resolution Route Shapes...");
    const rawShapes = {};
    await new Promise(resolve => {
        fs.createReadStream('./gtfs_data/shapes.txt').pipe(csv())
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
        const coords = rawShapes[shapeId].map(pt => [pt.lat, pt.lon]);
        
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

// Actually run the function!
buildSchedule();
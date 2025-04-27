// Ensure the Mapbox access token is available
if (typeof MAPBOX_ACCESS_TOKEN === "undefined" || !MAPBOX_ACCESS_TOKEN) {
  console.error("Mapbox Access Token is missing!");
  alert("Mapbox Access Token is missing. Please check the configuration.");
} else {
  mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
}

const map = new mapboxgl.Map({
  container: "map", // container ID
  style: "mapbox://styles/mapbox/streets-v12", // style URL
  center: [-122.45, 37.8], // starting position [lng, lat]
  zoom: 11, // starting zoom
});

const draw = new MapboxDraw({
  displayControlsDefault: false,
  // Select which tools should be displayed.
  controls: {
    polygon: true,
    trash: true, // Ability to delete drawn features
  },
  // Set mapbox-gl-draw to draw into custom source
  defaultMode: "draw_polygon",
});

map.addControl(draw);
map.addControl(new mapboxgl.NavigationControl()); // Add zoom and rotation controls

const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const findRoutesBtn = document.getElementById("find-routes-btn");
const messageDiv = document.getElementById("message");

// Store layers/sources added to the map for easy removal
const addedLayers = [];
const addedSources = [];

function clearMapLayers() {
  addedLayers.forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });
  addedSources.forEach((sourceId) => {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  });
  addedLayers.length = 0;
  addedSources.length = 0;
  // Optionally clear drawn danger zones as well, or keep them
  // draw.deleteAll(); // Uncomment to clear drawn polygons on new search
}

findRoutesBtn.addEventListener("click", async () => {
  const startAddress = startInput.value;
  const endAddress = endInput.value;
  const dangerZones = draw.getAll(); // Get all drawn features (includes points, lines, polygons)

  if (!startAddress || !endAddress) {
    messageDiv.textContent = "Please enter both start and end addresses.";
    messageDiv.style.color = "red";
    return;
  }

  messageDiv.textContent = "Finding routes...";
  messageDiv.style.color = "black";
  clearMapLayers(); // Clear previous routes

  // Filter only polygons for danger zones
  const dangerPolygons = dangerZones.features.filter(
    (f) => f.geometry.type === "Polygon",
  );

  try {
    const response = await fetch("/api/find_safe_routes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start_address: startAddress,
        end_address: endAddress,
        danger_zones: dangerPolygons, // Send the GeoJSON features directly
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      messageDiv.textContent = `Error: ${result.error || "Failed to find routes."}`;
      messageDiv.style.color = "red";
    } else {
      messageDiv.textContent = result.message;
      messageDiv.style.color =
        result.safe_routes.length > 0 ? "green" : "orange";

      if (result.safe_routes && result.safe_routes.length > 0) {
        // Combine all routes into a single FeatureCollection for easier rendering
        const routeFeatureCollection = {
          type: "FeatureCollection",
          features: result.safe_routes,
        };

        const sourceId = "safe-routes-source";
        const layerId = "safe-routes-layer";

        // Add source and layer for safe routes
        map.addSource(sourceId, {
          type: "geojson",
          data: routeFeatureCollection,
        });
        addedSources.push(sourceId);

        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#007cbf", // Blue color for safe routes
            "line-width": 6,
            "line-opacity": 0.8,
          },
        });
        addedLayers.push(layerId);

        // Fit map to the bounds of the first safe route
        // For multiple routes, you might want to calculate combined bounds
        const firstRouteCoords = result.safe_routes[0].geometry.coordinates;
        const bounds = firstRouteCoords.reduce(
          function (bounds, coord) {
            return bounds.extend(coord);
          },
          new mapboxgl.LngLatBounds(firstRouteCoords[0], firstRouteCoords[0]),
        );

        map.fitBounds(bounds, {
          padding: 80, // Add some padding around the bounds
        });
      }
    }
  } catch (error) {
    console.error("Fetch error:", error);
    messageDiv.textContent = "An error occurred while contacting the server.";
    messageDiv.style.color = "red";
  }
});

// Optional: Add listeners for draw events if needed
map.on("draw.create", updateArea);
map.on("draw.delete", updateArea);
map.on("draw.update", updateArea);

function updateArea(e) {
  // You could potentially use this to display info about drawn areas
  // or trigger actions when zones are modified.
  const data = draw.getAll();
  console.log("Draw event:", e.type, "Features:", data.features.length);
}

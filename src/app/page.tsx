"use client";

import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/mapbox";
import { PathLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { EditableGeoJsonLayer } from "@nebula.gl/layers";
import { DrawPolygonMode } from "@nebula.gl/edit-modes";
import { useState, useCallback, useEffect } from "react";
import type { PickInfo } from "@deck.gl/core/lib/deck";
import { Feature, FeatureCollection, Polygon, Position } from "geojson";

export default function App() {
  // --- Types ---
  type InteractionMode = "selectStartPoint" | "drawExclusionZone" | "drawSafeZone";
  interface SafeZonePathRequest {
    id: number;
    start: Position;
    safeZones: Feature<Polygon>[]; // Store the safe zones used for this request
    polygons: Feature<Polygon>[]; // Store the exclusion zones used for this request
    path: Position[] | null;
  }

  // --- State ---
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("selectStartPoint");
  const [drawnExclusionFeatures, setDrawnExclusionFeatures] = useState<
    FeatureCollection<Polygon>
  >({
    type: "FeatureCollection",
    features: [],
  });
  // State specifically for drawing the *next* set of safe zones
  const [currentSafeZoneFeatures, setCurrentSafeZoneFeatures] = useState<
    FeatureCollection<Polygon>
  >({
    type: "FeatureCollection",
    features: [],
  });
  const [pathRequests, setPathRequests] = useState<SafeZonePathRequest[]>([]);
  const [currentStartPoint, setCurrentStartPoint] = useState<Position | null>(null);
  const [nextRequestId, setNextRequestId] = useState(0);
  const [isLoadingPath, setIsLoadingPath] = useState(false);
  const [windowDimensions, setWindowDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  });

  // --- Effects ---
  useEffect(() => {
    function handleResize() {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- API Call Logic ---
  const fetchShortestPathToSafeZone = useCallback(
    async (start: Position, safeZones: Feature<Polygon>[], exclusionPolygons: Feature<Polygon>[]) => {
      const requestBody = {
        start_point: { longitude: start[0], latitude: start[1] },
        safe_zones: safeZones.map(f => ({ coordinates: f.geometry.coordinates[0] })), // Map features to API format
        polygons: exclusionPolygons.map(f => ({ coordinates: f.geometry.coordinates[0] })), // Map features to API format
      };

      console.log("Sending path to safe zone request:", requestBody);
      // Ensure the backend URL is correct (assuming it's still 8080 based on previous code, adjust if needed)
      const response = await fetch("http://127.0.0.1:8080/find_path", { // Changed port from 8000 to 8080 to match run.sh
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("API Error Response:", errorData);
        throw new Error(
          errorData.detail || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      console.log("Path to safe zone response:", data);

      if (data.path_found && data.path_coordinates) {
        return data.path_coordinates;
      } else {
        console.warn(`Path to safe zone finding failed: ${data.message}`);
        return null; // Indicate failure
      }
    },
    [] // No dependencies needed
  );

  // --- Action Handlers ---

  // Function to initiate finding path to the currently drawn safe zones
  const handleFindPathToSafeZone = useCallback(async () => {
    if (!currentStartPoint || currentSafeZoneFeatures.features.length === 0) {
      alert("Please select a start point and draw at least one safe zone polygon.");
      return;
    }

    setIsLoadingPath(true);
    const currentExclusionZones = drawnExclusionFeatures.features.filter(
      (f): f is Feature<Polygon> => f.geometry.type === "Polygon"
    );
    const currentSafeZonesToUse = currentSafeZoneFeatures.features.filter(
      (f): f is Feature<Polygon> => f.geometry.type === "Polygon"
    );

    const newId = nextRequestId;
    setNextRequestId(prevId => prevId + 1);

    // Add a placeholder request (path will be filled by the fetch)
    const newRequest: SafeZonePathRequest = {
      id: newId,
      start: currentStartPoint,
      safeZones: currentSafeZonesToUse, // Store the safe zones used
      polygons: currentExclusionZones, // Store the exclusion zones used
      path: null,
    };
    setPathRequests(prevRequests => [...prevRequests, newRequest]);

    try {
      console.log(`Fetching path for request ${newId} to safe zones:`, currentStartPoint, currentSafeZonesToUse);
      const calculatedPath = await fetchShortestPathToSafeZone(
        currentStartPoint,
        currentSafeZonesToUse,
        currentExclusionZones
      );

      setPathRequests(currentRequests =>
        currentRequests.map(req =>
          req.id === newId ? { ...req, path: calculatedPath } : req
        )
      );

      if (!calculatedPath) {
         alert(`Failed to find path for request ${newId}. ${(calculatedPath === null ? '(No path found)' : '')}`); // More specific message
      }

      // Reset for next request AFTER fetch completes
      setCurrentStartPoint(null);
      setCurrentSafeZoneFeatures({ type: "FeatureCollection", features: [] }); // Clear current drawing
      setInteractionMode("selectStartPoint"); // Go back to selecting points

    } catch (error) {
      console.error(`Error fetching path for request ${newId}:`, error);
      alert(
        `Error fetching path: ${error instanceof Error ? error.message : String(error)}`
      );
      // Update request state to indicate failure clearly
      setPathRequests(currentRequests =>
        currentRequests.map(req =>
          req.id === newId ? { ...req, path: null } : req // Keep request, path is null
        )
      );
       // Reset for next request even on error
       setCurrentStartPoint(null);
       setCurrentSafeZoneFeatures({ type: "FeatureCollection", features: [] });
       setInteractionMode("selectStartPoint");
    } finally {
      setIsLoadingPath(false);
    }
  }, [
    currentStartPoint,
    currentSafeZoneFeatures,
    drawnExclusionFeatures,
    fetchShortestPathToSafeZone,
    nextRequestId,
    setPathRequests // Ensure state setter is a dependency
  ]);


  const resetSelection = () => {
    setPathRequests([]);
    setCurrentStartPoint(null);
    setDrawnExclusionFeatures({ type: "FeatureCollection", features: [] });
    setCurrentSafeZoneFeatures({ type: "FeatureCollection", features: [] });
    setNextRequestId(0);
    setIsLoadingPath(false);
    setInteractionMode("selectStartPoint");
  };

  const handleMapClick = useCallback(
    ({ coordinate, layer }: PickInfo<any>) => {
      if (interactionMode !== "selectStartPoint" || isLoadingPath) {
        console.log(
          `Map click ignored: Mode is ${interactionMode}, Loading: ${isLoadingPath}`
        );
        return;
      }

       // Ignore clicks on existing editable layers
       if (layer?.id?.startsWith("editable-")) {
         console.log("Map click ignored: Clicked on an editable layer.");
         return;
       }

      if (!coordinate) return;

      const [longitude, latitude] = coordinate;
      const clickedPoint: Position = [longitude, latitude];

      // Only set the start point in this mode
      console.log("Setting start point:", clickedPoint);
      setCurrentStartPoint(clickedPoint);
      // Automatically switch to drawing safe zones after selecting start point
      setInteractionMode("drawSafeZone");

    },
    [interactionMode, isLoadingPath, setInteractionMode] // Removed dependencies related to end point
  );

  // --- Layer Definitions ---
   const layers = [
    // Layer for drawing/editing EXCLUSION zones
    interactionMode === "drawExclusionZone" &&
      new EditableGeoJsonLayer({
        id: "editable-exclusion-geojson",
        data: drawnExclusionFeatures,
        mode: new DrawPolygonMode(),
        selectedFeatureIndexes: [],
        onEdit: ({ updatedData }) => setDrawnExclusionFeatures(updatedData),
        pickable: true,
        getFillColor: [255, 0, 0, 100], // Reddish for exclusion
        getLineColor: [255, 0, 0, 200],
        getLineWidth: 2,
      }),
    // Layer for drawing/editing SAFE zones
    interactionMode === "drawSafeZone" &&
      new EditableGeoJsonLayer({
        id: "editable-safezone-geojson",
        data: currentSafeZoneFeatures, // Use the specific state for current safe zones
        mode: new DrawPolygonMode(),
        selectedFeatureIndexes: [],
        onEdit: ({ updatedData }) => setCurrentSafeZoneFeatures(updatedData),
        pickable: true,
        getFillColor: [0, 255, 0, 100], // Greenish for safe zones
        getLineColor: [0, 255, 0, 200],
        getLineWidth: 2,
      }),
    // Display layer for committed EXCLUSION zones (when not editing them)
    interactionMode !== "drawExclusionZone" &&
      drawnExclusionFeatures.features.length > 0 &&
      new GeoJsonLayer({
        id: "drawn-exclusion-polygons-display",
        data: drawnExclusionFeatures,
        getFillColor: [255, 0, 0, 50], // Lighter Red
        getLineColor: [255, 0, 0, 150],
        getLineWidth: 1,
        pickable: false,
      }),
     // Display layer for currently drawing SAFE zones (when not editing them)
     interactionMode !== "drawSafeZone" &&
      currentSafeZoneFeatures.features.length > 0 &&
      new GeoJsonLayer({
          id: "current-safe-zones-display",
          data: currentSafeZoneFeatures,
          getFillColor: [0, 255, 0, 30], // Lighter Green
          getLineColor: [0, 255, 0, 100],
          getLineWidth: 1,
          pickable: false,
      }),
    // Display layer for committed SAFE zones from previous requests
     pathRequests.length > 0 &&
      new GeoJsonLayer({
        id: "committed-safe-zones-display",
        data: pathRequests.flatMap(req => req.safeZones.map(zone => ({...zone, properties: {...zone.properties, requestId: req.id}}))), // Flatten zones from all requests
        getFillColor: [0, 128, 0, 50], // Darker Green fill
        getLineColor: [0, 128, 0, 150], // Darker Green line
        getLineWidth: 1.5,
        pickable: false,
      }),
    // Base map roads
    new GeoJsonLayer({
      id: "region-roads-layer",
      data: "/road_data.geojson",
      getLineColor: [100, 100, 100, 150],
      getLineWidth: 1,
      lineWidthMinPixels: 0.5,
      pickable: false,
    }),
    // Layer for start points (current and from requests)
    new ScatterplotLayer({
      id: "start-points-layer",
      data: [
        ...(currentStartPoint
          ? [{ position: currentStartPoint, type: "currentStart" as const }]
          : []),
        ...pathRequests.map((req) => ({
          position: req.start,
          type: "committedStart" as const,
        })),
      ] as { position: Position; type: "currentStart" | "committedStart" }[],
      getPosition: (d: { position: Position; type: "currentStart" | "committedStart" }) => d.position,
      getColor: (d: { position: Position; type: "currentStart" | "committedStart" }) => {
        if (d.type === "currentStart") return [255, 255, 0, 255]; // Yellow for current selection
        return [0, 255, 0, 255]; // Green for committed start points
      },
      getSize: 100,
      radiusMinPixels: 6,
    }),
    // Layer for calculated paths
    pathRequests.length > 0 &&
      new PathLayer({
        id: "calculated-paths-layer",
        data: pathRequests.filter(req => req.path), // Only include requests with a calculated path
        getPath: (d: SafeZonePathRequest) => d.path!,
        getColor: [0, 0, 255, 200], // Blue for paths
        getWidth: 5,
        widthMinPixels: 3,
      }),
  ].filter(Boolean);


  // --- Render ---
  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      {/* Control Panel UI */}
      <div
         style={{
            position: "absolute",
            zIndex: 10,
            right: "max(16px, 2vw)",
            bottom: "max(16px, 2vh)",
            background: "rgba(255, 255, 255, 0.95)",
            padding: "clamp(8px, 1.5vw, 16px)",
            borderRadius: "12px",
            display: "flex",
            flexDirection: windowDimensions.width < 768 ? "column" : "row", // Adjust breakpoint maybe
            gap: "clamp(8px, 0.8vw, 12px)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
            backdropFilter: "blur(8px)",
            maxWidth: windowDimensions.width < 500 ? "calc(100% - 32px)" : "auto",
            transition: "all 0.2s ease-in-out",
        }}
      >
        {/* Mode Buttons */}
         <button
            onClick={() => setInteractionMode("selectStartPoint")}
            disabled={isLoadingPath || interactionMode === "selectStartPoint"}
            style={getButtonStyle(interactionMode === "selectStartPoint", isLoadingPath)}
         >
            Select Start Point
         </button>
          <button
            onClick={() => setInteractionMode("drawSafeZone")}
            disabled={isLoadingPath || interactionMode === "drawSafeZone"}
            style={getButtonStyle(interactionMode === "drawSafeZone", isLoadingPath)}
          >
            Draw Safe Zone
          </button>
          <button
            onClick={() => setInteractionMode("drawExclusionZone")}
            disabled={isLoadingPath || interactionMode === "drawExclusionZone"}
            style={getButtonStyle(interactionMode === "drawExclusionZone", isLoadingPath)}
         >
            Draw Exclusion Zone
         </button>

         {/* Action Button */}
          <button
            onClick={handleFindPathToSafeZone}
            disabled={isLoadingPath || !currentStartPoint || currentSafeZoneFeatures.features.length === 0}
            style={{
                ...getButtonStyle(false, isLoadingPath || !currentStartPoint || currentSafeZoneFeatures.features.length === 0),
                background: (!isLoadingPath && currentStartPoint && currentSafeZoneFeatures.features.length > 0)
                    ? "linear-gradient(135deg, #10B981, #059669)" // Green gradient when active
                    : "#F3F4F6", // Default greyed out
                color: (!isLoadingPath && currentStartPoint && currentSafeZoneFeatures.features.length > 0) ? "white" : "#6B7280", // White text when active
                 boxShadow: (!isLoadingPath && currentStartPoint && currentSafeZoneFeatures.features.length > 0)
                    ? "0 2px 8px rgba(16, 185, 129, 0.4)"
                    : "0 1px 2px rgba(0, 0, 0, 0.05)",
            }}
        >
            Find Path to Safe Zone
          </button>

          {/* Reset Button */}
          <button
            onClick={resetSelection}
            disabled={isLoadingPath}
            style={{
                background: "#F3F4F6",
                color: "#1F2937",
                fontWeight: 500,
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(209, 213, 219, 0.8)",
                cursor: isLoadingPath ? "default" : "pointer",
                transition: "all 0.2s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                opacity: isLoadingPath ? 0.5 : 1,
                fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
                flexShrink: 0,
                whiteSpace: "nowrap",
                minWidth: "80px",
            }}
            >
                Reset
            </button>

          {/* Loading Indicator */}
          {isLoadingPath && (
              <div style={{
                display: "flex",
                alignItems: "center",
                color: "#3B82F6",
                fontWeight: 500,
                fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
                marginLeft: "4px", // Adjusted spacing if needed
              }}>
                <div style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  border: "2px solid rgba(59, 130, 246, 0.2)",
                  borderTopColor: "#3B82F6",
                  animation: "spin 0.8s linear infinite",
                  marginRight: "8px",
                }}></div>
                <span>Finding path...</span>
              </div>
          )}
      </div>

      {/* DeckGL Map */}
      <DeckGL
        initialViewState={{
          longitude: -122.4, // Keep initial view state
          latitude: 37.74,
          zoom: 11,
          maxZoom: 20,
          bearing: 0,
        }}
        controller={true}
        layers={layers} // Use the dynamic layers array
        onClick={handleMapClick}
      >
        <Map
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          doubleClickZoom={!interactionMode.startsWith("draw")} // Disable doubleClickZoom when drawing
        />
      </DeckGL>
      {/* Keyframes for spinner */}
      <style jsx>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
    </div>
  );
}

// Helper function for button styling to reduce repetition
function getButtonStyle(isActive: boolean, isDisabled: boolean): React.CSSProperties {
    const activeBg = "linear-gradient(135deg, #3B82F6, #2563EB)";
    const inactiveBg = "white";
    const activeColor = "white";
    const inactiveColor = "#1F2937";
    const activeShadow = "0 2px 8px rgba(37, 99, 235, 0.3)";
    const inactiveShadow = "0 1px 2px rgba(0, 0, 0, 0.05)";

    return {
      background: isActive ? activeBg : inactiveBg,
      color: isActive ? activeColor : inactiveColor,
      fontWeight: 500,
      padding: "10px 14px",
      borderRadius: "8px",
      border: isActive ? "none" : "1px solid rgba(209, 213, 219, 0.8)",
      cursor: isDisabled ? "default" : "pointer",
      transition: "all 0.2s ease",
      boxShadow: isActive ? activeShadow : inactiveShadow,
      fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
      flexShrink: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      minWidth: "120px",
      opacity: isDisabled && !isActive ? 0.6 : 1, // Dim if disabled but not the active mode itself
    };
}

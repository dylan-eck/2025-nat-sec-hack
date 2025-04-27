"use client";

import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/mapbox";
import { PathLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { EditableGeoJsonLayer } from "@nebula.gl/layers";
import { DrawPolygonMode } from "@nebula.gl/edit-modes";
import { useState, useCallback, useEffect } from "react";
import type { PickInfo } from "@deck.gl/core/lib/deck";
import { Feature, FeatureCollection, Polygon, Position } from "geojson";

const API_URL = "http://127.0.0.1:8080";

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
  // State for committed safe zones (persist like exclusion zones)
  const [committedSafeZoneFeatures, setCommittedSafeZoneFeatures] = useState<
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
  // === ADDED: State for save/load operations ===
  const [isSavingZones, setIsSavingZones] = useState<boolean>(false);
  const [isLoadingZones, setIsLoadingZones] = useState<boolean>(false);
  const [zoneMessage, setZoneMessage] = useState<string | null>(null);
  // === END ADDED STATE ===

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
      const response = await fetch(`${API_URL}/find_path`, { // Changed port from 8000 to 8080 to match run.sh
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

  // Function to initiate finding path using the current start point and committed zones
  const handleFindPath = useCallback(async () => {
    if (!currentStartPoint) {
      alert("Please select a start point.");
      return;
    }

    setIsLoadingPath(true);
    const exclusionZones = drawnExclusionFeatures.features.filter(
      (f): f is Feature<Polygon> => f.geometry.type === "Polygon"
    );
    const safeZones = committedSafeZoneFeatures.features.filter(
      (f): f is Feature<Polygon> => f.geometry.type === "Polygon"
    );

    const newId = nextRequestId;
    setNextRequestId(prevId => prevId + 1);

    const newRequest: SafeZonePathRequest = {
      id: newId,
      start: currentStartPoint,
      safeZones: safeZones,
      polygons: exclusionZones,
      path: null,
    };
    setPathRequests(prevRequests => [...prevRequests, newRequest]);

    try {
      console.log(`Fetching path for request ${newId}: Start=${currentStartPoint}, SafeZones=${safeZones.length}, ExclusionZones=${exclusionZones.length}`);
      const calculatedPath = await fetchShortestPathToSafeZone(
        currentStartPoint,
        safeZones,
        exclusionZones
      );

      setPathRequests(currentRequests =>
        currentRequests.map(req =>
          req.id === newId ? { ...req, path: calculatedPath } : req
        )
      );

      if (!calculatedPath) {
         alert(`Failed to find path for request ${newId}. ${(calculatedPath === null ? '(No path found)' : '')}`);
      }

      setCurrentStartPoint(null);

    } catch (error) {
      console.error(`Error fetching path for request ${newId}:`, error);
      alert(
        `Error fetching path: ${error instanceof Error ? error.message : String(error)}`
      );
      setPathRequests(currentRequests =>
        currentRequests.map(req =>
          req.id === newId ? { ...req, path: null } : req
        )
      );
       setCurrentStartPoint(null);
    } finally {
      setIsLoadingPath(false);
    }
  }, [
    currentStartPoint,
    committedSafeZoneFeatures,
    drawnExclusionFeatures,
    fetchShortestPathToSafeZone,
    nextRequestId,
    setPathRequests
  ]);


  const resetSelection = () => {
    setPathRequests([]);
    setCurrentStartPoint(null);
    setDrawnExclusionFeatures({ type: "FeatureCollection", features: [] });
    setCommittedSafeZoneFeatures({ type: "FeatureCollection", features: [] });
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

       if (layer?.id?.startsWith("editable-")) {
         console.log("Map click ignored: Clicked on an editable layer.");
         return;
       }

      if (!coordinate) return;

      const clickedPoint: Position = coordinate;

      console.log("Setting start point:", clickedPoint);
      setCurrentStartPoint(clickedPoint);

    },
    [interactionMode, isLoadingPath]
  );

  // === ADDED: Function to Save Zones ===
  const handleSaveZones = async () => {
    if (isSavingZones || isLoadingZones) return;
    setIsSavingZones(true); 
    setZoneMessage('Saving zones...'); 

    // Get current zones from state (which holds the Feature objects)
    // Extract coordinates in the format expected by the backend API
    const exclusionZonesForApi = drawnExclusionFeatures.features.map(zone => ({
         // Draw returns coordinates wrapped in an extra array for Polygon
        coordinates: zone.geometry.coordinates[0]
    }));
    const safeZonesForApi = committedSafeZoneFeatures.features.map(zone => ({
        coordinates: zone.geometry.coordinates[0]
    }));

    const zonesData = {
        exclusion: exclusionZonesForApi,
        safe: safeZonesForApi
    };

    try {
      const response = await fetch(`${API_URL}/save_zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zonesData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || 'Failed to save zones');
      }

      setZoneMessage('Zones saved successfully!'); 
      console.log('Zones saved:', result);

    } catch (error: unknown) { 
      console.error('Error saving zones:', error);
      // Type check before accessing message
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setZoneMessage(`Error: ${errorMessage}`); 
    } finally {
      setIsSavingZones(false); 
      // Clear message after a delay
      setTimeout(() => setZoneMessage(null), 3000); 
    }
  };
  // === END ADDED SAVE FUNCTION ===

  // === ADDED: Function to Load Zones ===
  const handleLoadZones = async () => {
    if (isLoadingZones || isSavingZones) return;
    setIsLoadingZones(true); 
    setZoneMessage('Loading zones...'); 

    try {
      const response = await fetch(`${API_URL}/load_zones`);
      const loadedZones: any = await response.json();

      if (!response.ok) {
        // @ts-ignore - detail might be on error response json
        throw new Error(loadedZones.detail || 'Failed to load zones');
      }

      // Clear existing drawings and state
      setDrawnExclusionFeatures({ type: "FeatureCollection", features: [] });
      setCommittedSafeZoneFeatures({ type: "FeatureCollection", features: [] });
      setCurrentStartPoint(null);
      setPathRequests([]);

      // Add loaded zones to Draw and update state
      const loadedExclusionFeatures: any[] = [];
      const loadedSafeFeatures: any[] = [];

      // Ensure loadedZones and its properties exist before iterating
      if (loadedZones?.exclusion) {
          loadedZones.exclusion.forEach((zone: any, index: number) => {
              if (!zone?.coordinates) return; // Skip if coordinates are missing
              const feature = {
                  id: `loaded-exclusion-${Date.now()}-${index}`,
                  type: 'Feature',
                  properties: { type: 'exclusion' },
                  geometry: {
                      type: 'Polygon',
                      coordinates: [zone.coordinates] // Wrap coordinates for GeoJSON Polygon
                  }
              };
              loadedExclusionFeatures.push(feature);
          });
      }

      if (loadedZones?.safe) {
          loadedZones.safe.forEach((zone: any, index: number) => {
              if (!zone?.coordinates) return; // Skip if coordinates are missing
              const feature = {
                  id: `loaded-safe-${Date.now()}-${index}`,
                  type: 'Feature',
                  properties: { type: 'safe' },
                  geometry: {
                      type: 'Polygon',
                      coordinates: [zone.coordinates]
                  }
              };
              loadedSafeFeatures.push(feature);
          });
      }

      // Update state with the full Feature objects added to Draw
      setDrawnExclusionFeatures({ type: "FeatureCollection", features: loadedExclusionFeatures });
      setCommittedSafeZoneFeatures({ type: "FeatureCollection", features: loadedSafeFeatures });

      setZoneMessage(`Loaded ${loadedExclusionFeatures.length} exclusion and ${loadedSafeFeatures.length} safe zones.`); 
      console.log('Zones loaded:', loadedZones);
      // Switch back to point selection mode after loading
      setInteractionMode('selectStartPoint');

    } catch (error: unknown) { 
      console.error('Error loading zones:', error);
      // Type check before accessing message
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setZoneMessage(`Error: ${errorMessage}`); 
    } finally {
      setIsLoadingZones(false); 
       // Clear message after a delay
      setTimeout(() => setZoneMessage(null), 3000); 
    }
  };
  // === END ADDED LOAD FUNCTION ===


  // --- Layer Definitions ---
   const layers = [
    interactionMode === "drawExclusionZone" &&
      new EditableGeoJsonLayer({
        id: "editable-exclusion-geojson",
        data: drawnExclusionFeatures,
        mode: new DrawPolygonMode(),
        selectedFeatureIndexes: [],
        onEdit: ({ updatedData }) => setDrawnExclusionFeatures(updatedData),
        pickable: true,
        getFillColor: [255, 0, 0, 100],
        getLineColor: [255, 0, 0, 200],
        getLineWidth: 2,
      }),
    interactionMode === "drawSafeZone" &&
      new EditableGeoJsonLayer({
        id: "editable-safezone-geojson",
        data: committedSafeZoneFeatures,
        mode: new DrawPolygonMode(),
        selectedFeatureIndexes: [],
        onEdit: ({ updatedData }) => setCommittedSafeZoneFeatures(updatedData),
        pickable: true,
        getFillColor: [0, 255, 0, 100],
        getLineColor: [0, 255, 0, 200],
        getLineWidth: 2,
      }),
    interactionMode !== "drawExclusionZone" &&
      drawnExclusionFeatures.features.length > 0 &&
      new GeoJsonLayer({
        id: "drawn-exclusion-polygons-display",
        data: drawnExclusionFeatures,
        getFillColor: [255, 0, 0, 50],
        getLineColor: [255, 0, 0, 150],
        getLineWidth: 1,
        pickable: false,
      }),
    interactionMode !== "drawSafeZone" &&
      committedSafeZoneFeatures.features.length > 0 &&
      new GeoJsonLayer({
          id: "committed-safe-zones-display",
          data: committedSafeZoneFeatures,
          getFillColor: [0, 128, 0, 50],
          getLineColor: [0, 128, 0, 150],
          getLineWidth: 1.5,
          pickable: false,
      }),
    new GeoJsonLayer({
      id: "region-roads-layer",
      data: "/road_data.geojson",
      getLineColor: [100, 100, 100, 150],
      getLineWidth: 1,
      lineWidthMinPixels: 0.5,
      pickable: false,
    }),
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
        if (d.type === "currentStart") return [255, 255, 0, 255];
        return [0, 255, 0, 255];
      },
      getSize: 100,
      radiusMinPixels: 6,
    }),
    pathRequests.length > 0 &&
      new PathLayer({
        id: "calculated-paths-layer",
        data: pathRequests.filter(req => req.path),
        getPath: (d: SafeZonePathRequest) => d.path!,
        getColor: [0, 0, 255, 200],
        getWidth: 5,
        widthMinPixels: 3,
      }),
  ].filter(Boolean);


  // --- Render ---
  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
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
            flexDirection: windowDimensions.width < 768 ? "column" : "row",
            gap: "clamp(8px, 0.8vw, 12px)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
            backdropFilter: "blur(8px)",
            maxWidth: windowDimensions.width < 500 ? "calc(100% - 32px)" : "auto",
            transition: "all 0.2s ease-in-out",
        }}
      >
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

          <button
            onClick={handleFindPath}
            disabled={isLoadingPath || !currentStartPoint}
            style={{
                ...getButtonStyle(false, isLoadingPath || !currentStartPoint),
                background: (!isLoadingPath && currentStartPoint)
                    ? "linear-gradient(135deg, #10B981, #059669)"
                    : "#F3F4F6",
                color: (!isLoadingPath && currentStartPoint) ? "white" : "#6B7280",
                 boxShadow: (!isLoadingPath && currentStartPoint)
                    ? "0 2px 8px rgba(16, 185, 129, 0.4)"
                    : "0 1px 2px rgba(0, 0, 0, 0.05)",
            }}
        >
            Find Path
          </button>

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

            {/* === ADDED: Save/Load Buttons === */}
            <button
              onClick={handleSaveZones}
              disabled={isSavingZones || isLoadingZones}
              style={{
                background: "#F3F4F6",
                color: "#1F2937",
                fontWeight: 500,
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(209, 213, 219, 0.8)",
                cursor: isSavingZones || isLoadingZones ? "default" : "pointer",
                transition: "all 0.2s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                opacity: isSavingZones || isLoadingZones ? 0.6 : 1,
                fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
                flexShrink: 0,
                whiteSpace: "nowrap",
                minWidth: "80px",
              }}
            >
              {isSavingZones ? 'Saving...' : 'Save Zones'}
            </button>
            <button
              onClick={handleLoadZones}
              disabled={isSavingZones || isLoadingZones}
              style={{
                background: "#F3F4F6",
                color: "#1F2937",
                fontWeight: 500,
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(209, 213, 219, 0.8)",
                cursor: isSavingZones || isLoadingZones ? "default" : "pointer",
                transition: "all 0.2s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                opacity: isSavingZones || isLoadingZones ? 0.6 : 1,
                fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
                flexShrink: 0,
                whiteSpace: "nowrap",
                minWidth: "80px",
              }}
            >
              {isLoadingZones ? 'Loading...' : 'Load Zones'}
            </button>
            {/* === END ADDED BUTTONS === */}

          {isLoadingPath && (
              <div style={{
                display: "flex",
                alignItems: "center",
                color: "#3B82F6",
                fontWeight: 500,
                fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
                marginLeft: "4px",
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
          {/* === ADDED: Zone Message Display === */}
          {zoneMessage && (
            <div style={{
              display: "flex",
              alignItems: "center",
              color: "#1F2937",
              fontWeight: 500,
              fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
              marginLeft: "4px",
            }}>
              <span>{zoneMessage}</span>
            </div>
          )}
          {/* === END ADDED ZONE MESSAGE DISPLAY === */}
      </div>

      <DeckGL
        initialViewState={{
          longitude: -122.4,
          latitude: 37.74,
          zoom: 11,
          maxZoom: 20,
          bearing: 0,
        }}
        controller={true}
        layers={layers}
        onClick={handleMapClick}
      >
        <Map
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          doubleClickZoom={!interactionMode.startsWith("draw")}
        />
      </DeckGL>
      <style jsx>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
    </div>
  );
}

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
      opacity: isDisabled && !isActive ? 0.6 : 1,
    };
}

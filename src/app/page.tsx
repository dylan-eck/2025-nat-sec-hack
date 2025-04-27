"use client";

import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/mapbox";
import { PathLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { EditableGeoJsonLayer } from "@nebula.gl/layers";
import { DrawPolygonMode } from "@nebula.gl/edit-modes";
import { useState, useCallback } from "react";
import { PickingInfo } from "@deck.gl/core";
import { Feature, FeatureCollection, Polygon, Position } from "geojson";

<<<<<<< Updated upstream
=======
// Type matching backend API for loading zones
interface PolygonInput {
  coordinates: Position[]; // Assuming the API sends just the array of positions for a polygon
}

interface LoadedZonesData {
  exclusion: PolygonInput[];
  safe: PolygonInput[];
}

const API_URL = "http://127.0.0.1:8080";

>>>>>>> Stashed changes
export default function App() {
  type InteractionMode = "selectPoints" | "drawPolygon";
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("selectPoints");

  const [drawnFeatures, setDrawnFeatures] = useState<
    FeatureCollection<Polygon>
  >({
    type: "FeatureCollection",
    features: [],
  });

  const [startPoint, setStartPoint] = useState<Position | null>(null);
  const [endPoint, setEndPoint] = useState<Position | null>(null);
  const [shortestPath, setShortestPath] = useState<Position[] | null>(null);
  const [isLoadingPath, setIsLoadingPath] = useState(false);

  const fetchShortestPath = useCallback(
    async (start: Position, end: Position) => {
      if (!start || !end) return;

      setIsLoadingPath(true);
      setShortestPath(null);

      const polygons = drawnFeatures.features
        .filter((f: Feature<Polygon>) => f.geometry.type === "Polygon")
        .map((f: Feature<Polygon>) => ({
          coordinates: f.geometry.coordinates[0],
        }));

      const requestBody = {
        start_point: { longitude: start[0], latitude: start[1] },
        end_point: { longitude: end[0], latitude: end[1] },
        polygons: polygons,
      };

      console.log("Sending path request:", requestBody);

      try {
        const response = await fetch("http://127.0.0.1:8080/find_path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.detail || `HTTP error! status: ${response.status}`
          );
        }

        const data = await response.json();
        console.log("Path response:", data);

        if (data.path_found && data.path_coordinates) {
          setShortestPath(data.path_coordinates);
        } else {
          alert(`Path finding failed: ${data.message}`);
        }
      } catch (error) {
        console.error("Error fetching shortest path:", error);
        alert(
          `Error fetching shortest path: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
<<<<<<< Updated upstream
      } finally {
        setIsLoadingPath(false);
=======
      }

      const data = await response.json();
      console.log("Path to safe zone response:", data);

      if (data.path_found && data.path) {
        return data.path;
      } else {
        console.warn(`Path to safe zone finding failed: ${data.message}`);
        return null; // Indicate failure
>>>>>>> Stashed changes
      }
    },
    [drawnFeatures]
  );

  const resetSelection = () => {
    setStartPoint(null);
    setEndPoint(null);
    setShortestPath(null);
    setIsLoadingPath(false);
    setInteractionMode("selectPoints");
  };

  // --- Map Interaction ---
  const handleMapClick = useCallback(
<<<<<<< Updated upstream
    ({ coordinate, layer }: PickingInfo) => {
      if (interactionMode !== "selectPoints" || isLoadingPath) {
=======
    // Refine PickInfo type for object structure
    ({ coordinate, layer, object }: PickInfo<{ object?: { properties?: { id?: string | number } } }>) => {
      // Ignore clicks if not in selection mode or if pathfinding is in progress
      if (interactionMode !== "selectStartPoint" || isLoadingPath) {
>>>>>>> Stashed changes
        console.log(
          `Map click ignored: Mode is ${interactionMode}, Loading: ${isLoadingPath}`
        );
        return;
      }

<<<<<<< Updated upstream
      if (layer?.id === "editable-geojson") {
        console.log("Map click ignored: Clicked on editable layer.");
=======
      // Ignore clicks on the editable layers themselves (the polygons)
      if (layer?.id?.startsWith("exclusion-zones-editor") || layer?.id?.startsWith("safe-zones-editor")) {
        console.log("Map click ignored: Clicked on an editable layer polygon.");
>>>>>>> Stashed changes
        return;
      }

      if (!coordinate) {
        console.log("Map click ignored: No coordinate data.");
        return; // No coordinate data
      }

<<<<<<< Updated upstream
      const [longitude, latitude] = coordinate;

      if (!startPoint) {
        console.log("Setting start point:", [longitude, latitude]);
        setStartPoint([longitude, latitude]);
        setEndPoint(null);
        setShortestPath(null);
      } else if (!endPoint) {
        console.log("Setting end point:", [longitude, latitude]);
        setEndPoint([longitude, latitude]);
        fetchShortestPath(startPoint, [longitude, latitude]);
      } else {
        console.log("Resetting points, setting new start point:", [
          longitude,
          latitude,
        ]);
        setStartPoint([longitude, latitude]);
        setEndPoint(null);
        setShortestPath(null);
=======
      // --- Handle Clicks Based on Mode ---

      // Check if clicking on an existing *rendered object* (like points from ScatterplotLayer)
      if (object) {
        console.log("Clicked on object:", object);
        // Safely access properties - check structure before accessing
        if (object.properties && typeof object.properties.id !== 'undefined') {
          const featureId = object.properties.id;
          console.log(`Clicked on feature with id: ${featureId}`);
          // If clicking on an object, don't place a new start point
          // Deselect any pending start point
          setCurrentStartPoint(null);
          return;
        } else {
          // Clicked on *some* object, but not one with the expected properties
          console.log("Clicked on an unrecognized object type.");
          // Still treat this as not clicking the empty map - deselect start point
          setCurrentStartPoint(null);
          return;
        }
      }

      // If clicking on empty map space in the correct mode
      if (interactionMode === "selectStartPoint") {
        const clickedPoint: Position = coordinate;
        console.log("Setting start point:", clickedPoint);
        setCurrentStartPoint(clickedPoint);
>>>>>>> Stashed changes
      }
    },
    [interactionMode, startPoint, endPoint, fetchShortestPath, isLoadingPath]
  );

<<<<<<< Updated upstream
=======
  const onEditExclusion = useCallback(
    // Type the event object
    (event: { updatedData: FeatureCollection<Polygon> }) => {
      // Only update if the mode is correct to prevent state changes during other operations
      if (interactionMode === "drawExclusionZone") {
        const updatedData = event.updatedData; // Access updatedData from event
        console.log("Exclusion Zone Edit:", updatedData);
        setDrawnExclusionFeatures(updatedData);
      }
    },
    [interactionMode] // Depend on interactionMode
  );

  const onEditSafe = useCallback(
    // Type the event object
    (event: { updatedData: FeatureCollection<Polygon> }) => {
      if (interactionMode === "drawSafeZone") {
        const updatedData = event.updatedData; // Access updatedData from event
        console.log("Safe Zone Edit:", updatedData);
        setCommittedSafeZoneFeatures(updatedData); // Use the committed state setter
      }
    },
    [interactionMode]
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
  const handleLoadZones = useCallback(async () => {
    setIsLoadingZones(true);
    setZoneMessage("Loading zones...");
    try {
      const response = await fetch(`${API_URL}/load_zones`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to parse error response' }));
        throw new Error(
          errorData.detail || `HTTP error! status: ${response.status}`
        );
      }
      const loadedData: LoadedZonesData = await response.json();

      console.log("Loaded zones data:", loadedData);

      // Convert loaded data (PolygonInput[]) back to GeoJSON FeatureCollection
      const exclusionFeatures: Feature<Polygon>[] = loadedData.exclusion.map((poly, index) => ({
        type: "Feature",
        properties: { id: `loaded-exclusion-${index}` }, // Assign some unique ID
        geometry: {
          type: "Polygon",
          coordinates: [poly.coordinates], // Wrap coordinates in an extra array for GeoJSON Polygon
        },
      }));

      const safeFeatures: Feature<Polygon>[] = loadedData.safe.map((poly, index) => ({
        type: "Feature",
        properties: { id: `loaded-safe-${index}` },
        geometry: {
          type: "Polygon",
          coordinates: [poly.coordinates],
        },
      }));

      setDrawnExclusionFeatures({ type: "FeatureCollection", features: exclusionFeatures });
      setCommittedSafeZoneFeatures({ type: "FeatureCollection", features: safeFeatures });

      setZoneMessage("Zones loaded successfully!");
    } catch (error) {
      console.error("Failed to load zones:", error);
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      setZoneMessage(`Error loading zones: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsLoadingZones(false);
      // Clear message after a delay
      setTimeout(() => setZoneMessage(null), 3000);
    }
  }, []);
  // === END ADDED LOAD FUNCTION ===


  // --- Layer Definitions ---
   const layers = [
    interactionMode === "drawExclusionZone" &&
      new EditableGeoJsonLayer({
        id: "exclusion-zones-editor",
        data: drawnExclusionFeatures,
        mode: new DrawPolygonMode(),
        selectedFeatureIndexes: [],
        onEdit: onEditExclusion, // Pass the correct callback
        visible: interactionMode === "drawExclusionZone",
        // Styling for exclusion zones
        filled: true,
        getFillColor: [255, 0, 0, 100],
        getLineColor: [255, 0, 0, 200],
        getLineWidth: 2,
      }),
    interactionMode === "drawSafeZone" &&
      new EditableGeoJsonLayer({
        id: "safe-zones-editor",
        data: committedSafeZoneFeatures, // Use committed state
        mode: new DrawPolygonMode(),
        selectedFeatureIndexes: [],
        onEdit: onEditSafe, // Pass the correct callback
        visible: interactionMode === "drawSafeZone",
        // Styling for safe zones
        filled: true,
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
>>>>>>> Stashed changes
  return (
    <div>
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          margin: 10,
          background: "white",
          padding: "5px",
          borderRadius: "3px",
          display: "flex",
          gap: "5px",
        }}
      >
        <button
          onClick={() => setInteractionMode("selectPoints")}
          disabled={isLoadingPath || interactionMode === "selectPoints"}
          style={{
            fontWeight: interactionMode === "selectPoints" ? "bold" : "normal",
          }}
        >
          Select Path Points
        </button>
        <button
          onClick={() => setInteractionMode("drawPolygon")}
          disabled={isLoadingPath || interactionMode === "drawPolygon"}
          style={{
            fontWeight: interactionMode === "drawPolygon" ? "bold" : "normal",
          }}
        >
          Draw Exclusion Zone
        </button>
        <button onClick={resetSelection} disabled={isLoadingPath}>
          Reset
        </button>
        {isLoadingPath && <span> Finding path...</span>}
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
        layers={[
          interactionMode === "drawPolygon" &&
            new EditableGeoJsonLayer({
              id: "editable-geojson",
              data: drawnFeatures,
              mode: new DrawPolygonMode(),
              selectedFeatureIndexes: [],
              onEdit: ({ updatedData }) => setDrawnFeatures(updatedData),
              pickable: true,
              getFillColor: [0, 0, 255, 100],
              getLineColor: [0, 0, 255, 255],
              getLineWidth: 2,
            }),
          new GeoJsonLayer({
            id: "region-roads-layer",
            data: "/road_data.geojson",
            getLineColor: [100, 100, 100, 150],
            getLineWidth: 1,
            lineWidthMinPixels: 0.5,
            pickable: false,
          }),
          startPoint &&
            new ScatterplotLayer({
              id: "start-point-layer",
              data: [{ position: startPoint }],
              getPosition: (d: { position: Position }) => d.position,
              getColor: [0, 255, 0, 255],
              getSize: 100,
              radiusMinPixels: 6,
            }),
          endPoint &&
            new ScatterplotLayer({
              id: "end-point-layer",
              data: [{ position: endPoint }],
              getPosition: (d: { position: Position }) => d.position,
              getColor: [255, 0, 0, 255],
              getSize: 100,
              radiusMinPixels: 6,
            }),
          shortestPath &&
            new PathLayer({
              id: "shortest-path-layer",
              data: [{ path: shortestPath }],
              getPath: (d: { path: Position[] }) => d.path,
              getColor: [0, 0, 255, 200],
              getWidth: 5,
              widthMinPixels: 3,
            }),
          interactionMode !== "drawPolygon" &&
            drawnFeatures.features.length > 0 &&
            new GeoJsonLayer({
              id: "drawn-polygons-display",
              data: drawnFeatures,
              getFillColor: [0, 0, 255, 50],
              getLineColor: [0, 0, 255, 150],
              getLineWidth: 1,
              pickable: false,
            }),
        ].filter(Boolean)}
        onClick={handleMapClick}
      >
        <Map
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          doubleClickZoom={interactionMode !== "drawPolygon"}
        />
      </DeckGL>
    </div>
  );
<<<<<<< Updated upstream
=======

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
>>>>>>> Stashed changes
}

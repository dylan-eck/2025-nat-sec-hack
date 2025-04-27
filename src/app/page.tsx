"use client";

import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/mapbox";
import { PathLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { EditableGeoJsonLayer } from "@nebula.gl/layers";
import { DrawPolygonMode } from "@nebula.gl/edit-modes";
import { useState, useCallback, useEffect } from "react";
import type { PickInfo } from "@deck.gl/core/lib/deck";
import { Feature, FeatureCollection, Polygon, Position } from "geojson";

// Type matching backend API for loading zones
interface PolygonInput {
  coordinates: Position[]; // Assuming the API sends just the array of positions for a polygon
}

interface LoadedZonesData {
  exclusion: PolygonInput[];
  safe: PolygonInput[];
}

const API_URL = "http://127.0.0.1:8080";
// Add environment variables for SMS
const TEXTBELT_API_KEY = process.env.NEXT_PUBLIC_TEXTBELT;
const EMERGENCY_PHONE = process.env.NEXT_PUBLIC_EMERGENCY_PHONE;

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
  // === ADDED: State for send operation ===
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
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

      if (data.path_found && data.path) { // FIX: Check for 'path' field now
        return data.path; // FIX: Return 'path' field
      } else {
        console.warn(`Path to safe zone finding failed: ${data.message}`);
        return null; // Indicate failure
      }
    },
    [] // No dependencies needed
  );

  // --- Helper Function: Generate Google Maps Link ---
  /**
   * Generate a Google Maps route link from an array of [latitude, longitude] pairs.
   * Note: This function expects points in [latitude, longitude] order.
   *
   * @param points Array of coordinates in [lat, lng] order.
   * @returns A share-ready Google Maps directions URL.
   */
  function generateGoogleMapsRouteLink(points: Array<[number, number]>): string {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error('Need at least 2 points to create a route');
    }

    // Start & end
    const origin = `${points[0][0]},${points[0][1]}`;
    const destination = `${points[points.length - 1][0]},${points[points.length - 1][1]}`;

    // Intermediate way-points (everything except first & last)
    const waypoints = points
      .slice(1, -1)
      .map(([lat, lng]) => `${lat},${lng}`)
      .join('|'); // Google expects vertical-bar separators

    // Assemble URL
    let url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}`;

    if (waypoints) {
      url += `&waypoints=${encodeURIComponent(waypoints)}`;
    }

    return url;
  }

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

  // --- Map Interaction ---
  const handleMapClick = useCallback(
    // FIX: Correctly destructure PickInfo and refine type
    ({ coordinate, layer, object }: PickInfo<{ object?: { properties?: { id?: string | number } } }>) => {
      // Ignore clicks if not in selection mode or if pathfinding is in progress
      if (interactionMode !== "selectStartPoint" || isLoadingPath) {
        console.log(
          `Map click ignored: Mode is ${interactionMode}, Loading: ${isLoadingPath}`
        );
        return;
      }

      // Ignore clicks on the editable layers themselves (the polygons)
      if (layer?.id?.startsWith("exclusion-zones-editor") || layer?.id?.startsWith("safe-zones-editor")) {
        console.log("Map click ignored: Clicked on an editable layer polygon.");
        return;
      }

      if (!coordinate) {
        console.log("Map click ignored: No coordinate data.");
        return; // No coordinate data
      }

      // --- Handle Clicks Based on Mode ---

      // Check if clicking on an existing *rendered object* (like points from ScatterplotLayer)
      if (object) { // FIX: Use 'object' directly
        console.log("Clicked on object:", object);
        // Safely access properties - check structure before accessing
        // FIX: Use optional chaining just in case 'properties' doesn't exist
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
      }
    },
    [interactionMode, isLoadingPath]
  );

  // FIX: Define edit handlers using useCallback
  const onEditExclusion = useCallback(
    (event: { updatedData: FeatureCollection<Polygon> }) => {
      if (interactionMode === "drawExclusionZone") {
        const updatedData = event.updatedData;
        console.log("Exclusion Zone Edit:", updatedData);
        setDrawnExclusionFeatures(updatedData);
      }
    },
    [interactionMode]
  );

  const onEditSafe = useCallback(
    (event: { updatedData: FeatureCollection<Polygon> }) => {
      if (interactionMode === "drawSafeZone") {
        const updatedData = event.updatedData;
        console.log("Safe Zone Edit:", updatedData);
        setCommittedSafeZoneFeatures(updatedData);
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

      // FIX: Convert loaded data (PolygonInput[]) back to GeoJSON FeatureCollection
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
      // FIX: Use @ts-expect-error
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      setZoneMessage(`Error loading zones: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsLoadingZones(false);
      // Clear message after a delay
      setTimeout(() => setZoneMessage(null), 3000);
    }
  }, []);
  // === END ADDED LOAD FUNCTION ===

  // === MODIFIED: Function to handle Send operation with SMS notification ===
  const handleSend = useCallback(async () => {
    if (isSending) return;
    setIsSending(true);
    setSendMessage("Sending notification...");
    
    try {
      // Create evacuation message with Google Maps link if available
      let evacuationLink = "";
      if (pathRequests.length > 0) {
        // Find the most recent path with valid route data
        const latestValidRequest = [...pathRequests]
          .reverse()
          .find(req => req.path && req.path.length >= 2);
          
        if (latestValidRequest?.path) {
          // Convert backend path format [longitude, latitude] to [latitude, longitude] for Google Maps
          const routePoints = latestValidRequest.path.map(
            point => [point[1], point[0]] as [number, number]
          );
          evacuationLink = generateGoogleMapsRouteLink(routePoints);
        }
      }
      
      const message = `You are in the evacuation zone. Evacuate immediately. Access your evacuation map at: localhost:3000/location/`
      
      console.log(`Preparing to send evacuation SMS message`);
      
      // Make API call to our Next.js API route instead of directly to Textbelt
      const response = await fetch('/api/send-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || "Failed to send SMS");
      }
      
      setSendMessage("Emergency notification sent!");
      console.log("SMS notification sent successfully:", result);
      
    } catch (error) {
      console.error("Error sending SMS notification:", error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setSendMessage(`Error: ${errorMessage}`);
    } finally {
      setIsSending(false);
      // Clear message after a delay
      setTimeout(() => setSendMessage(null), 5000);
    }
  }, [isSending, pathRequests]);
  // === END MODIFIED SEND FUNCTION ===

  // --- Layer Definitions ---
   const layers = [
    interactionMode === "drawExclusionZone" &&
      new EditableGeoJsonLayer({
        id: "exclusion-zones-editor",
        data: drawnExclusionFeatures,
        mode: new DrawPolygonMode(),
        selectedFeatureIndexes: [],
        onEdit: onEditExclusion, // FIX: Pass the correct callback
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
        onEdit: onEditSafe, // FIX: Pass the correct callback
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
  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <h1 style={{
        position: "absolute",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        color: "white",
        textShadow: "0 2px 4px rgba(0, 0, 0, 0.5)",
        fontSize: "clamp(1.5rem, 3vw, 2.5rem)",
        fontWeight: "700",
        margin: 0,
        padding: "8px 16px",
        borderRadius: "8px",
        background: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(4px)",
        zIndex: 10,
        textAlign: "center",
        letterSpacing: "0.5px",
        display: "flex",
        alignItems: "center",
        gap: "12px"
      }}>
        <img 
          src="/logo.png" 
          alt="Guardian Grid Logo" 
          style={{
            height: "clamp(2rem, 4vw, 3rem)",
            width: "auto",
            objectFit: "contain"
          }}
        />
        Guardian Grid SF
      </h1>
      
      <div
         style={{
            position: "absolute",
            zIndex: 10,
            left: "50%",
            bottom: "max(16px, 2vh)",
            transform: "translateX(-50%)",
            background: "rgba(255, 255, 255, 0.95)",
            padding: "clamp(8px, 1.5vw, 16px)",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "clamp(12px, 1.5vw, 16px)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
            backdropFilter: "blur(8px)",
            maxWidth: "min(95%, 800px)",
            width: "fit-content",
            justifyContent: "center",
            transition: "all 0.2s ease-in-out",
            maxHeight: "calc(100vh - 40px)",
            overflow: "visible",
            pointerEvents: "auto", // Ensures clicks are captured by this element
        }}
        onClick={(e) => e.stopPropagation()} // Prevent clicks from propagating to the map
      >
        {/* Selection Tools Row */}
        <div style={{
          display: "flex",
          flexDirection: windowDimensions.width < 600 ? "column" : "row",
          gap: "clamp(8px, 0.8vw, 12px)",
          justifyContent: "center",
        }}>
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
        </div>

        {/* Action Tools Row */}
        <div style={{
          display: "flex",
          flexDirection: windowDimensions.width < 600 ? "column" : "row",
          gap: "clamp(8px, 0.8vw, 12px)",
          justifyContent: "center",
        }}>
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

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={isSending}
            style={{
              background: isSending ? "#F3F4F6" : "linear-gradient(135deg, #EF4444, #DC2626)",
              color: "white",
              fontWeight: 500,
              padding: "10px 14px",
              borderRadius: "8px",
              border: "none",
              cursor: isSending ? "default" : "pointer",
              transition: "all 0.2s ease",
              boxShadow: isSending ? "0 1px 2px rgba(0, 0, 0, 0.05)" : "0 2px 8px rgba(220, 38, 38, 0.4)",
              opacity: isSending ? 0.7 : 1,
              fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
              flexShrink: 0,
              whiteSpace: "nowrap",
              minWidth: "80px",
            }}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>

          {/* Save/Load Buttons */}
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
        </div>
        
        {/* Status Messages */}
        <div style={{ 
          display: "flex", 
          justifyContent: "center",
          flexWrap: "wrap",
          gap: "12px"
        }}>
          {isLoadingPath && (
            <div style={{
              display: "flex",
              alignItems: "center",
              color: "#3B82F6",
              fontWeight: 500,
              fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
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
          {zoneMessage && (
            <div style={{
              display: "flex",
              alignItems: "center",
              color: "#1F2937",
              fontWeight: 500,
              fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
            }}>
              <span>{zoneMessage}</span>
            </div>
          )}
          {sendMessage && (
            <div style={{
              display: "flex",
              alignItems: "center",
              color: sendMessage.includes("Error") ? "#DC2626" : "#047857",
              fontWeight: 500,
              fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
            }}>
              <span>{sendMessage}</span>
            </div>
          )}
        </div>
      </div>

      <DeckGL
        initialViewState={{
          longitude: -122.4,
          latitude: 37.74,
          zoom: 11,
          maxZoom: 20,
          bearing: 0,
        }}
        controller={{
          scrollZoom: {
            smooth: true,
            speed: 0.01,
            around: 'center'
          },
          doubleClickZoom: !interactionMode.startsWith("draw"),
          dragPan: true,
          touchZoom: true
        }}
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
      minWidth: windowDimensions.width < 500 ? "80px" : "120px",
      maxWidth: windowDimensions.width < 500 ? "100px" : "auto",
      opacity: isDisabled && !isActive ? 0.6 : 1,
    };
  }
}

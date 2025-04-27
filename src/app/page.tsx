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
  type InteractionMode = "selectPoints" | "drawPolygon";
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("selectPoints");

  const [drawnFeatures, setDrawnFeatures] = useState<
    FeatureCollection<Polygon>
  >({
    type: "FeatureCollection",
    features: [],
  });

  const [windowDimensions, setWindowDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  });

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

  // State for multiple independent path requests
  interface PathRequest {
    id: number;
    start: Position;
    end: Position;
    path: Position[] | null;
  }
  const [pathRequests, setPathRequests] = useState<PathRequest[]>([]);
  const [currentStartPoint, setCurrentStartPoint] = useState<Position | null>(null);
  const [nextRequestId, setNextRequestId] = useState(0); // Simple ID generator

  const [isLoadingPath, setIsLoadingPath] = useState(false);

  const fetchShortestPathSegment = useCallback(
    async (start: Position, end: Position, polygons: any[]) => {
      const requestBody = {
        start_point: { longitude: start[0], latitude: start[1] },
        end_point: { longitude: end[0], latitude: end[1] },
        polygons: polygons,
      };

      console.log("Sending path segment request:", requestBody);
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
      console.log("Path segment response:", data);

      if (data.path_found && data.path_coordinates) {
        return data.path_coordinates;
      } else {
        console.warn(`Path segment finding failed: ${data.message}`);
        return null; // Indicate failure for this segment
      }
    },
    [] // No dependencies as it's a pure fetch function now
  );

  // Function to fetch a single path and update the state
  const fetchSinglePath = useCallback(async (id: number, start: Position, end: Position) => {
    setIsLoadingPath(true);
    const polygons = drawnFeatures.features
      .filter((f: Feature<Polygon>) => f.geometry.type === "Polygon")
      .map((f: Feature<Polygon>) => ({ coordinates: f.geometry.coordinates[0] }));

    try {
      console.log(`Fetching path for request ${id}:`, start, end);
      const segment = await fetchShortestPathSegment(start, end, polygons);
      
      setPathRequests(currentRequests => 
        currentRequests.map(req => 
          req.id === id ? { ...req, path: segment } : req
        )
      );
      
      if (!segment) {
         alert(`Failed to find path for request ${id}.`);
      }

    } catch (error) {
      console.error(`Error fetching path for request ${id}:`, error);
      alert(
        `Error fetching path: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Optionally mark the request as failed or remove it
      setPathRequests(currentRequests => 
        currentRequests.map(req => 
          req.id === id ? { ...req, path: null } : req // Keep request but clear path on error
        )
      );
    } finally {
      // Consider more granular loading state if needed
      setIsLoadingPath(false);
    }
  }, [drawnFeatures, fetchShortestPathSegment]);

  const resetSelection = () => {
    setPathRequests([]);
    setCurrentStartPoint(null);
    setNextRequestId(0);
    setIsLoadingPath(false);
    setInteractionMode("selectPoints");
    setDrawnFeatures({
      type: "FeatureCollection",
      features: [],
    });
  };

  const handleMapClick = useCallback(
    ({ coordinate, layer }: PickInfo<any>) => {
      if (interactionMode !== "selectPoints" || isLoadingPath) {
        console.log(
          `Map click ignored: Mode is ${interactionMode}, Loading: ${isLoadingPath}`
        );
        return;
      }

      if (layer?.id === "editable-geojson") {
        console.log("Map click ignored: Clicked on editable layer.");
        return;
      }

      if (!coordinate) return;

      const [longitude, latitude] = coordinate;
      const clickedPoint: Position = [longitude, latitude];

      if (!currentStartPoint) {
        // This is the first click (start point)
        console.log("Setting start point:", clickedPoint);
        setCurrentStartPoint(clickedPoint);
      } else {
        // This is the second click (end point)
        console.log("Setting end point:", clickedPoint);
        const newId = nextRequestId;
        setNextRequestId(prevId => prevId + 1); // Increment ID for next request

        // Add the new request pair to the state
        setPathRequests(prevRequests => [
          ...prevRequests,
          { id: newId, start: currentStartPoint, end: clickedPoint, path: null },
        ]);

        // Fetch the path for this new pair
        fetchSinglePath(newId, currentStartPoint, clickedPoint);

        // Reset currentStartPoint to allow defining a new pair
        setCurrentStartPoint(null);
      }
    },
    [
      interactionMode, 
      isLoadingPath, 
      currentStartPoint, 
      fetchSinglePath, 
      nextRequestId, 
      setPathRequests // Added setPathRequests dependency
    ]
  );

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
          flexDirection: windowDimensions.width < 640 ? "column" : "row",
          gap: "clamp(8px, 0.8vw, 12px)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
          backdropFilter: "blur(8px)",
          maxWidth: windowDimensions.width < 500 ? "calc(100% - 32px)" : "auto",
          transition: "all 0.2s ease-in-out",
        }}
      >
        <button
          onClick={() => setInteractionMode("selectPoints")}
          disabled={isLoadingPath || interactionMode === "selectPoints"}
          style={{
            background: interactionMode === "selectPoints" 
              ? "linear-gradient(135deg, #3B82F6, #2563EB)" 
              : "white",
            color: interactionMode === "selectPoints" ? "white" : "#1F2937",
            fontWeight: 500,
            padding: "10px 14px",
            borderRadius: "8px",
            border: interactionMode === "selectPoints" 
              ? "none" 
              : "1px solid rgba(209, 213, 219, 0.8)",
            cursor: isLoadingPath || interactionMode === "selectPoints" 
              ? "default" 
              : "pointer",
            transition: "all 0.2s ease",
            boxShadow: interactionMode === "selectPoints" 
              ? "0 2px 8px rgba(37, 99, 235, 0.3)" 
              : "0 1px 2px rgba(0, 0, 0, 0.05)",
            fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
            flexShrink: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: "120px",
          }}
        >
          Select Path Points
        </button>
        <button
          onClick={() => setInteractionMode("drawPolygon")}
          disabled={isLoadingPath || interactionMode === "drawPolygon"}
          style={{
            background: interactionMode === "drawPolygon" 
              ? "linear-gradient(135deg, #3B82F6, #2563EB)" 
              : "white",
            color: interactionMode === "drawPolygon" ? "white" : "#1F2937",
            fontWeight: 500,
            padding: "10px 14px",
            borderRadius: "8px",
            border: interactionMode === "drawPolygon" 
              ? "none" 
              : "1px solid rgba(209, 213, 219, 0.8)",
            cursor: isLoadingPath || interactionMode === "drawPolygon" 
              ? "default" 
              : "pointer",
            transition: "all 0.2s ease",
            boxShadow: interactionMode === "drawPolygon" 
              ? "0 2px 8px rgba(37, 99, 235, 0.3)" 
              : "0 1px 2px rgba(0, 0, 0, 0.05)",
            fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
            flexShrink: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: "120px",
          }}
        >
          Draw Exclusion Zone
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
            <span>Finding path</span>
            <style jsx>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}
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
          // Layer for all start/end points and the current start point
          new ScatterplotLayer({
            id: "start-end-points-layer",
            data: [
              // Add the current start point if it exists
              ...(currentStartPoint
                ? [{ position: currentStartPoint, type: "current" as const }]
                : []),
              // Add all start points from requests
              ...pathRequests.map((req) => ({
                position: req.start,
                type: "start" as const,
              })),
              // Add all end points from requests
              ...pathRequests.map((req) => ({
                position: req.end,
                type: "end" as const,
              })),
            ] as { position: Position; type: "start" | "end" | "current" }[], // Explicitly type the data array
            getPosition: (d: { position: Position; type: string }) => d.position,
            getColor: (d: { position: Position; type: string }) => {
              if (d.type === "start") return [0, 255, 0, 255]; // Green for start
              if (d.type === "end") return [255, 0, 0, 255]; // Red for end
              return [255, 255, 0, 255]; // Yellow for current selection
            },
            getSize: 100,
            radiusMinPixels: 6,
          }),
          // Layer for all calculated paths
          pathRequests.length > 0 &&
            new PathLayer({
              id: "multiple-paths-layer",
              data: pathRequests.filter(req => req.path), // Only include requests with a calculated path
              getPath: (d: PathRequest) => d.path!,
              getColor: [0, 0, 255, 200], // Blue for paths
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
}

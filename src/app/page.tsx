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
      } finally {
        setIsLoadingPath(false);
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
      }
    },
    [interactionMode, startPoint, endPoint, fetchShortestPath, isLoadingPath]
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
}

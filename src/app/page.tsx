"use client";

import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/mapbox";
import { PathLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { EditableGeoJsonLayer } from "@nebula.gl/layers";
import { DrawPolygonMode } from "@nebula.gl/edit-modes";
import { useState, useCallback } from "react";
import { PickingInfo } from "@deck.gl/core";
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
  };

  const handleMapClick = useCallback(
    ({ coordinate, layer }: PickingInfo) => {
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
}

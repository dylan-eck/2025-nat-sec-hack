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
  const [drawMode, setDrawMode] = useState(false);
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
  };

  const handleMapClick = useCallback(
    ({ coordinate, layer }: PickingInfo) => {
      if (layer?.id === "editable-geojson" || drawMode || isLoadingPath) {
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
    [startPoint, endPoint, drawMode, fetchShortestPath, isLoadingPath]
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
        }}
      >
        <button
          onClick={() => setDrawMode((prev) => !prev)}
          disabled={isLoadingPath}
        >
          {drawMode ? "Finish Drawing" : "Draw Polygon"}
        </button>
        <button
          onClick={resetSelection}
          style={{ marginLeft: "5px" }}
          disabled={isLoadingPath}
        >
          Reset Points
        </button>
        {isLoadingPath && (
          <span style={{ marginLeft: "10px" }}> Finding path...</span>
        )}
        {!isLoadingPath && startPoint && !endPoint && (
          <span style={{ marginLeft: "10px" }}>
            Click map to select end point.
          </span>
        )}
        {!isLoadingPath && startPoint && endPoint && (
          <span style={{ marginLeft: "10px" }}>
            Click map to reset start point.
          </span>
        )}
        {!isLoadingPath && !startPoint && (
          <span style={{ marginLeft: "10px" }}>
            Click map to select start point.
          </span>
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
          new EditableGeoJsonLayer({
            id: "editable-geojson",
            data: drawnFeatures,
            mode: drawMode ? new DrawPolygonMode() : null,
            selectedFeatureIndexes: [],
            onEdit: ({ updatedData }) => setDrawnFeatures(updatedData),
            pickable: !drawMode,
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
        ].filter(Boolean)}
        onClick={handleMapClick}
      >
        <Map
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        />
      </DeckGL>
    </div>
  );
}

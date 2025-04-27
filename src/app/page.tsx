"use client";

import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/mapbox";
import { PathLayer, PolygonLayer, GeoJsonLayer } from "@deck.gl/layers";
import { EditableGeoJsonLayer } from "@nebula.gl/layers";
import { DrawPolygonMode } from "@nebula.gl/edit-modes";

type BartLine = {
  name: string;
  color: string;
  path: [longitude: number, latitude: number][];
};

type ZipCode = {
  zipcode: number;
  population: number;
  area: number;
  contour: [longitude: number, latitude: number][];
};

function hexToRgb(hex: string): [number, number, number] {
  const match = hex.replace("#", "").match(/.{1,2}/g);
  if (!match) return [0, 0, 0];
  return match.map((x) => parseInt(x, 16)) as [number, number, number];
}

import { useState } from "react";

export default function App() {
  const [drawMode, setDrawMode] = useState(false);
  const [drawnFeatures, setDrawnFeatures] = useState({
    type: "FeatureCollection",
    features: [],
  });
  const [selectedZip, setSelectedZip] = useState<number | null>(null);

  return (
    <div>
      <button
        onClick={() => setDrawMode((prev) => !prev)}
        style={{ position: "absolute", zIndex: 10, margin: 10 }}
      >
        {drawMode ? "Finish Drawing" : "Draw Polygon"}
      </button>
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
          new PolygonLayer({
            id: "PolygonLayer",
            data: "https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/sf-zipcodes.json",
            getPolygon: (d: ZipCode) => d.contour,
            getElevation: (d: ZipCode) => d.population / d.area / 10,
            getFillColor: (d: ZipCode) =>
              d.zipcode === selectedZip
                ? [255, 0, 0, 200] // Highlight color for selected
                : [d.population / d.area / 60, 140, 0],
            getLineColor: [255, 255, 255],
            getLineWidth: 20,
            lineWidthMinPixels: 1,
            pickable: true,
            updateTriggers: {
              getFillColor: [selectedZip],
            },
          }),
          new EditableGeoJsonLayer({
            id: "editable-geojson",
            data: drawnFeatures,
            mode: drawMode ? new DrawPolygonMode() : null, // Toggle mode based on state
            selectedFeatureIndexes: [],
            onEdit: ({ updatedData }) => setDrawnFeatures(updatedData),
            pickable: true,
            getFillColor: [0, 0, 255, 100],
            getLineColor: [0, 0, 255, 255],
            getLineWidth: 2,
          }),
          new PathLayer({
            id: "PathLayer",
            data: "https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart-lines.json",
            getColor: (d: BartLine) => hexToRgb(d.color),
            getPath: (d: BartLine) => d.path,
            getWidth: 100,
            pickable: true,
          }),
          // Add new GeoJsonLayer for roads
          new GeoJsonLayer({
            id: "region-roads-layer",
            data: "/road_data.geojson", // Path relative to public dir
            getLineColor: [255, 0, 0, 200], // Red roads
            getLineWidth: 2,
            lineWidthMinPixels: 1,
            pickable: true,
          }),
        ]}
        getTooltip={
          ({ object }: PickingInfo) =>
            object && (object.properties?.name || `Zip: ${object.zipcode}`) // Show tooltip for zips or roads
        }
        onClick={({ object, layer }: PickingInfo) => {
          // Only update selected zip if clicking on the PolygonLayer
          if (layer?.id === "PolygonLayer") {
            setSelectedZip(object?.zipcode || null);
          }
        }}
      >
        <Map
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        />
      </DeckGL>
    </div>
  );
}

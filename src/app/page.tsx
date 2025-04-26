"use client";

import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/mapbox";
import { PathLayer, PolygonLayer } from "@deck.gl/layers";

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
  const [selectedZip, setSelectedZip] = useState<number | null>(null);

  const polyLayer = new PolygonLayer<ZipCode>({
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
  });

  const pathLayer = new PathLayer<BartLine>({
    id: "PathLayer",
    data: "https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart-lines.json",
    getColor: (d: BartLine) => hexToRgb(d.color),
    getPath: (d: BartLine) => d.path,
    getWidth: 100,
    pickable: true,
  });

  return (
    <DeckGL
      initialViewState={{
        longitude: -122.4,
        latitude: 37.74,
        zoom: 11,
        maxZoom: 20,
        bearing: 0,
      }}
      controller={true}
      layers={[polyLayer, pathLayer]}
      onClick={({ object }) => {
        if (object && "zipcode" in object) {
          setSelectedZip(
            selectedZip === object.zipcode ? null : object.zipcode
          );
        }
      }}
    >
      <Map
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      />
    </DeckGL>
  );
}

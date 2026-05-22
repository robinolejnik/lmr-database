import type { StyleSpecification } from "maplibre-gl";

export type BaseLayerId =
  | "openfreemap-liberty"
  | "openfreemap-positron"
  | "openfreemap-dark"
  | "satellite";

export type BaseLayer = {
  id: BaseLayerId;
  label: string;
  style: string | StyleSpecification;
};

const SATELLITE_RASTER_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{ id: "esri-imagery", type: "raster", source: "esri-imagery" }],
};

export const BASE_LAYERS: BaseLayer[] = [
  {
    id: "openfreemap-liberty",
    label: "Liberty (colour)",
    style: "https://tiles.openfreemap.org/styles/liberty",
  },
  {
    id: "openfreemap-positron",
    label: "Positron (light)",
    style: "https://tiles.openfreemap.org/styles/positron",
  },
  {
    id: "openfreemap-dark",
    label: "Dark",
    style: "https://tiles.openfreemap.org/styles/dark",
  },
  {
    id: "satellite",
    label: "Satellite (Esri)",
    style: SATELLITE_RASTER_STYLE,
  },
];

export const DEFAULT_BASE_LAYER: BaseLayerId = "openfreemap-liberty";

export function getBaseLayer(id: BaseLayerId): BaseLayer {
  return BASE_LAYERS.find((b) => b.id === id) ?? BASE_LAYERS[0];
}

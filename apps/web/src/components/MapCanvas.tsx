import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MlMap,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getBaseLayer, type BaseLayerId } from "../lib/mapStyles";

export type MapPoint = {
  id: string;
  lat: number;
  lon: number;
  name: string;
  /** Optional MapLibre symbol image id (used by legacy-antennae layer). */
  pinId?: string;
};

export type MapBearing = {
  id: string;
  signalId: string;
  signalName: string;
  receiverName: string;
  observedAt: string;
  azimuthDeg: number;
  uncertaintyDeg: number | null;
  ray: GeoJSON.LineString | null;
  wedge: GeoJSON.LineString | GeoJSON.Polygon | null;
};

export type MapReceptionPoint = {
  id: string;
  lat: number;
  lon: number;
  weight: number;
};

export type MapCanvasProps = {
  baseLayer: BaseLayerId;
  receivers: MapPoint[];
  transmitters: MapPoint[];
  bearings: MapBearing[];
  receptions: MapReceptionPoint[];
  legacyAntennae: MapPoint[];
  showReceptions: boolean;
  showLegacyAntennae: boolean;
  /**
   * Minimum zoom at which the legacy antenna layer renders. Lower when the
   * filtered result set is small so the pins are visible at country/world
   * zoom; higher (e.g. 9) when there are many antennae and country zoom
   * would drown in pins.
   */
  legacyAntennaeMinZoom?: number;
  onBearingClick?: (signalId: string) => void;
  onLegacyAntennaClick?: (antennaId: string) => void;
  onMoveEnd?: (bounds: LngLatBoundsLike) => void;
};

const LEGACY_ANTENNAE_DEFAULT_MIN_ZOOM = 9;

const INITIAL_CENTRE: [number, number] = [10.45, 51.16];
const INITIAL_ZOOM = 5.5;

function toFC<T extends GeoJSON.Geometry>(
  features: GeoJSON.Feature<T>[]
): GeoJSON.FeatureCollection<T> {
  return { type: "FeatureCollection", features };
}

function pointsFC(items: { id: string; lat: number; lon: number; name?: string; pinId?: string }[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return toFC(
    items
      .filter((it) => Number.isFinite(it.lat) && Number.isFinite(it.lon))
      .map((it) => ({
        type: "Feature",
        id: it.id,
        geometry: { type: "Point", coordinates: [Number(it.lon), Number(it.lat)] },
        properties: {
          id: it.id,
          name: it.name ?? "",
          ...(it.pinId ? { pinId: it.pinId } : {}),
        },
      }))
  );
}

function bearingRaysFC(bearings: MapBearing[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return toFC(
    bearings
      .filter((b): b is MapBearing & { ray: GeoJSON.LineString } => b.ray?.type === "LineString")
      .map((b) => ({
        type: "Feature",
        id: b.id,
        geometry: b.ray,
        properties: {
          id: b.id,
          signalId: b.signalId,
          signalName: b.signalName,
          receiverName: b.receiverName,
          observedAt: b.observedAt,
          azimuthDeg: b.azimuthDeg,
          uncertaintyDeg: b.uncertaintyDeg,
        },
      }))
  );
}

function bearingWedgesFC(bearings: MapBearing[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return toFC(
    bearings
      .filter((b): b is MapBearing & { wedge: GeoJSON.Polygon } => b.wedge?.type === "Polygon")
      .map((b) => ({
        type: "Feature",
        id: b.id,
        geometry: b.wedge,
        properties: {
          id: b.id,
          signalId: b.signalId,
          signalName: b.signalName,
        },
      }))
  );
}

function receptionsFC(items: MapReceptionPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return toFC(
    items
      .filter((it) => Number.isFinite(it.lat) && Number.isFinite(it.lon))
      .map((it) => ({
        type: "Feature",
        id: it.id,
        geometry: { type: "Point", coordinates: [it.lon, it.lat] },
        properties: { weight: it.weight },
      }))
  );
}

const SOURCE_IDS = {
  receivers: "src-receivers",
  transmitters: "src-transmitters",
  bearingRays: "src-bearing-rays",
  bearingWedges: "src-bearing-wedges",
  receptions: "src-receptions",
  legacyAntennae: "src-legacy-antennae",
} as const;

const LAYER_IDS = {
  legacyAntennae: "lyr-legacy-antennae",
  receptionsHeat: "lyr-receptions-heat",
  bearingWedges: "lyr-bearing-wedges",
  bearingRays: "lyr-bearing-rays",
  transmitters: "lyr-transmitters",
  transmittersLabel: "lyr-transmitters-label",
  receivers: "lyr-receivers",
  receiversLabel: "lyr-receivers-label",
} as const;

// Google-Earth-style teardrop placemark, with one image variant per
// allocation-status colour. Rasterised lazily and re-added after every
// setStyle (which wipes images) via the styleimagemissing event.
export const LEGACY_PIN_IMAGE_IDS = {
  green:  "legacy-antenna-pin-green",
  orange: "legacy-antenna-pin-orange",
  gray:   "legacy-antenna-pin-gray",
} as const;
export type LegacyPinId =
  (typeof LEGACY_PIN_IMAGE_IDS)[keyof typeof LEGACY_PIN_IMAGE_IDS];

const LEGACY_PIN_FILLS: Record<LegacyPinId, string> = {
  [LEGACY_PIN_IMAGE_IDS.green]:  "#16a34a",
  [LEGACY_PIN_IMAGE_IDS.orange]: "#f59e0b",
  [LEGACY_PIN_IMAGE_IDS.gray]:   "#9ca3af",
};

function legacyPinSvg(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" width="64" height="96">
    <defs>
      <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1" flood-opacity="0.45"/>
      </filter>
    </defs>
    <path filter="url(#s)"
      d="M16 0 C7.163 0 0 7.163 0 16 c0 11 16 32 16 32 s16 -21 16 -32 C32 7.163 24.837 0 16 0 z"
      fill="${fill}" stroke="#1f2937" stroke-width="2.5"/>
    <circle cx="16" cy="16" r="6" fill="#1f2937"/>
  </svg>`;
}

const legacyPinPromises: Map<string, Promise<ImageData>> = new Map();

function loadLegacyPinImage(pinId: LegacyPinId): Promise<ImageData> {
  const cached = legacyPinPromises.get(pinId);
  if (cached) return cached;
  const promise = new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = 64, h = 96;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("2d canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = (e) => reject(e instanceof Event ? new Error("pin svg failed to load") : e);
    img.src = "data:image/svg+xml;base64," + btoa(legacyPinSvg(LEGACY_PIN_FILLS[pinId]));
  });
  legacyPinPromises.set(pinId, promise);
  return promise;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function applyOverlays(map: MlMap) {
  const addSource = (id: string) => {
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: emptyFC() });
    }
  };
  Object.values(SOURCE_IDS).forEach(addSource);

  if (!map.getLayer(LAYER_IDS.legacyAntennae)) {
    map.addLayer({
      id: LAYER_IDS.legacyAntennae,
      type: "symbol",
      source: SOURCE_IDS.legacyAntennae,
      minzoom: 0,  // controlled at runtime via setLayerZoomRange below
      layout: {
        // Per-feature pin colour. Falls back to gray for any row whose
        // pinId we couldn't compute (e.g. antenna with no zuteilung).
        "icon-image": ["coalesce", ["get", "pinId"], LEGACY_PIN_IMAGE_IDS.gray],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.25, 14, 0.45, 18, 0.7],
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.receptionsHeat)) {
    map.addLayer({
      id: LAYER_IDS.receptionsHeat,
      type: "heatmap",
      source: SOURCE_IDS.receptions,
      paint: {
        "heatmap-weight": ["coalesce", ["get", "weight"], 0.5],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 14, 2.4],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 14, 40],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.8, 17, 0.2],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(0, 100, 200, 0)",
          0.2, "rgba(0, 150, 220, 0.5)",
          0.4, "rgba(60, 200, 120, 0.7)",
          0.6, "rgba(240, 220, 0, 0.8)",
          0.8, "rgba(240, 130, 0, 0.85)",
          1, "rgba(220, 30, 30, 0.9)",
        ],
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.bearingWedges)) {
    map.addLayer({
      id: LAYER_IDS.bearingWedges,
      type: "fill",
      source: SOURCE_IDS.bearingWedges,
      paint: {
        "fill-color": "#f59e0b",
        "fill-opacity": 0.15,
        "fill-outline-color": "rgba(0,0,0,0)",
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.bearingRays)) {
    map.addLayer({
      id: LAYER_IDS.bearingRays,
      type: "line",
      source: SOURCE_IDS.bearingRays,
      paint: {
        "line-color": "#f59e0b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 12, 2.2],
        "line-opacity": 0.85,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }

  if (!map.getLayer(LAYER_IDS.transmitters)) {
    map.addLayer({
      id: LAYER_IDS.transmitters,
      type: "circle",
      source: SOURCE_IDS.transmitters,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 14, 8],
        "circle-color": "#ef4444",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.transmittersLabel)) {
    map.addLayer({
      id: LAYER_IDS.transmittersLabel,
      type: "symbol",
      source: SOURCE_IDS.transmitters,
      minzoom: 10,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#ef4444",
        "text-halo-color": "rgba(255,255,255,0.85)",
        "text-halo-width": 1.4,
      },
    });
  }

  if (!map.getLayer(LAYER_IDS.receivers)) {
    map.addLayer({
      id: LAYER_IDS.receivers,
      type: "circle",
      source: SOURCE_IDS.receivers,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4.5, 14, 9],
        "circle-color": "#2563eb",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.receiversLabel)) {
    map.addLayer({
      id: LAYER_IDS.receiversLabel,
      type: "symbol",
      source: SOURCE_IDS.receivers,
      minzoom: 9,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#2563eb",
        "text-halo-color": "rgba(255,255,255,0.85)",
        "text-halo-width": 1.4,
      },
    });
  }
}

function setSourceData(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
}

function setLayerVisible(map: MlMap, id: string, visible: boolean) {
  if (!map.getLayer(id)) return;
  map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

type MapCallbacks = {
  ensurePinImages: () => Promise<void>;
  applyAndSyncAll: () => void;
};

export function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const callbacksRef = useRef<MapCallbacks | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // 1. Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialStyle = getBaseLayer(propsRef.current.baseLayer).style;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle as string | StyleSpecification,
      center: INITIAL_CENTRE,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    // Pin images are not part of StyleSpecification, so `transformStyle`
    // can't carry them across a base-layer swap. We re-add via addImage
    // every time the style settles. Promises in `loadLegacyPinImage` are
    // cached, so subsequent calls resolve instantly with the same ImageData.
    const ensurePinImages = async () => {
      await Promise.all(
        Object.values(LEGACY_PIN_IMAGE_IDS).map(async (pinId) => {
          if (map.hasImage(pinId)) return;
          const data = await loadLegacyPinImage(pinId);
          if (!map.hasImage(pinId)) map.addImage(pinId, data);
        })
      );
    };

    const applyAndSyncAll = () => {
      applyOverlays(map);
      const p = propsRef.current;
      setSourceData(map, SOURCE_IDS.receivers,      pointsFC(p.receivers));
      setSourceData(map, SOURCE_IDS.transmitters,   pointsFC(p.transmitters));
      setSourceData(map, SOURCE_IDS.bearingRays,    bearingRaysFC(p.bearings));
      setSourceData(map, SOURCE_IDS.bearingWedges,  bearingWedgesFC(p.bearings));
      setSourceData(map, SOURCE_IDS.receptions,     receptionsFC(p.receptions));
      setSourceData(map, SOURCE_IDS.legacyAntennae, pointsFC(p.legacyAntennae));
      setLayerVisible(map, LAYER_IDS.receptionsHeat, p.showReceptions);
      setLayerVisible(map, LAYER_IDS.legacyAntennae, p.showLegacyAntennae);
      map.setLayerZoomRange(
        LAYER_IDS.legacyAntennae,
        p.legacyAntennaeMinZoom ?? LEGACY_ANTENNAE_DEFAULT_MIN_ZOOM,
        24
      );
    };

    callbacksRef.current = { ensurePinImages, applyAndSyncAll };

    // Backup: lazy image load when MapLibre asks for a missing icon.
    map.on("styleimagemissing", (e: { id: string }) => {
      if (!(e.id in LEGACY_PIN_FILLS) || map.hasImage(e.id)) return;
      void loadLegacyPinImage(e.id as LegacyPinId).then((data) => {
        if (!map.hasImage(e.id)) map.addImage(e.id, data);
      });
    });

    // Initial setup. `load` fires once after the map's first render is done.
    // Subsequent style swaps are handled in the baseLayer useEffect below.
    map.on("load", () => {
      void ensurePinImages().then(() => {
        applyAndSyncAll();
        // Emit initial bounds so parents that depend on the viewport (e.g.
        // the bbox-filtered legacy antennae query) can fetch right away,
        // before the user has interacted with the map.
        propsRef.current.onMoveEnd?.(map.getBounds().toArray() as LngLatBoundsLike);
      });
    });

    // Click handlers: bearings, markers
    const onBearingClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0];
      const signalId = f?.properties?.signalId as string | undefined;
      if (signalId) propsRef.current.onBearingClick?.(signalId);
    };
    map.on("click", LAYER_IDS.bearingRays, onBearingClick);
    map.on("mouseenter", LAYER_IDS.bearingRays, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", LAYER_IDS.bearingRays, () => { map.getCanvas().style.cursor = ""; });

    const onLegacyAntennaClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0];
      const id = f?.properties?.id as string | undefined;
      if (id) propsRef.current.onLegacyAntennaClick?.(id);
    };
    map.on("click", LAYER_IDS.legacyAntennae, onLegacyAntennaClick);
    map.on("mouseenter", LAYER_IDS.legacyAntennae, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", LAYER_IDS.legacyAntennae, () => { map.getCanvas().style.cursor = ""; });

    const popupOnPoint = (layerId: string, kind: "receiver" | "transmitter") => {
      map.on("click", layerId, (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const [lon, lat] = f.geometry.coordinates;
        const name = (f.properties?.name as string) || "(unnamed)";
        new maplibregl.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat([lon, lat])
          .setHTML(
            `<div style="font: 12px system-ui; min-width: 160px;">` +
              `<div style="font-weight:600; margin-bottom:2px;">${escapeHtml(name)}</div>` +
              `<div style="opacity:0.7; text-transform:capitalize;">${kind}</div>` +
              `<div style="opacity:0.7; font-variant-numeric: tabular-nums;">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>` +
            `</div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
    };
    popupOnPoint(LAYER_IDS.receivers,    "receiver");
    popupOnPoint(LAYER_IDS.transmitters, "transmitter");

    map.on("moveend", () => {
      propsRef.current.onMoveEnd?.(map.getBounds().toArray() as LngLatBoundsLike);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Swap base layer when prop changes.
  //
  // We use `transformStyle` (the official mechanism documented on
  // StyleSwapOptions in maplibre-gl.d.ts:7158) to merge our custom sources
  // and layers into the new style spec before commit, so MapLibre re-creates
  // them as part of the swap instead of leaving the map empty of overlays.
  //
  // Pin images are NOT part of StyleSpecification and cannot be carried via
  // transformStyle; we re-register them with `addImage` once the new style
  // is fully settled (the `idle` event — defined in maplibre-gl.d.ts:9624
  // as "Fired after the last frame rendered before the map enters an 'idle'
  // state … all currently requested tiles have loaded …"). `once` ensures
  // a single re-apply per swap.
  useEffect(() => {
    const map = mapRef.current;
    const cbs = callbacksRef.current;
    if (!map || !cbs) return;
    const next = getBaseLayer(props.baseLayer).style;
    const customSourceIds = new Set<string>(Object.values(SOURCE_IDS));
    const customLayerIds  = new Set<string>(Object.values(LAYER_IDS));

    map.setStyle(next as string | StyleSpecification, {
      diff: false,
      transformStyle: (prev, nxt) => {
        if (!prev) return nxt;
        const preservedSources: Record<string, any> = { ...nxt.sources };
        for (const sid of customSourceIds) {
          if (prev.sources[sid]) preservedSources[sid] = prev.sources[sid];
        }
        const preservedLayers = prev.layers.filter((l) => customLayerIds.has(l.id));
        return {
          ...nxt,
          sources: preservedSources,
          layers: [...nxt.layers, ...preservedLayers],
        };
      },
    });

    map.once("idle", () => {
      void cbs.ensurePinImages().then(() => cbs.applyAndSyncAll());
    });
  }, [props.baseLayer]);

  // 3. Push data into existing sources whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setSourceData(map, SOURCE_IDS.receivers, pointsFC(props.receivers));
  }, [props.receivers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setSourceData(map, SOURCE_IDS.transmitters, pointsFC(props.transmitters));
  }, [props.transmitters]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setSourceData(map, SOURCE_IDS.bearingRays,   bearingRaysFC(props.bearings));
    setSourceData(map, SOURCE_IDS.bearingWedges, bearingWedgesFC(props.bearings));
  }, [props.bearings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setSourceData(map, SOURCE_IDS.receptions, receptionsFC(props.receptions));
  }, [props.receptions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setSourceData(map, SOURCE_IDS.legacyAntennae, pointsFC(props.legacyAntennae));
  }, [props.legacyAntennae]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setLayerVisible(map, LAYER_IDS.receptionsHeat, props.showReceptions);
  }, [props.showReceptions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setLayerVisible(map, LAYER_IDS.legacyAntennae, props.showLegacyAntennae);
  }, [props.showLegacyAntennae]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(LAYER_IDS.legacyAntennae)) return;
    map.setLayerZoomRange(
      LAYER_IDS.legacyAntennae,
      props.legacyAntennaeMinZoom ?? LEGACY_ANTENNAE_DEFAULT_MIN_ZOOM,
      24
    );
  }, [props.legacyAntennaeMinZoom]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;"  :
    c === ">" ? "&gt;"  :
    c === '"' ? "&quot;" :
    "&#39;"
  );
}

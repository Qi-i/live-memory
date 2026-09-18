export interface AMapMarkerOptions {
  position?: [number, number];
  title?: string;
  content?: string | HTMLElement;
  anchor?: string;
  offset?: unknown;
  zIndex?: number;
}

export interface AMapMarkerInstance {
  on?: (event: string, handler: (event?: unknown) => void) => void;
  setContent?: (content: string | HTMLElement) => void;
  setPosition?: (position: [number, number]) => void;
}

export interface AMapMapInstance {
  add?: (items: unknown[] | unknown) => void;
  setFitView?: (...args: unknown[]) => void;
  setCenter?: (center: [number, number], immediately?: boolean, duration?: number) => void;
  setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void;
  on?: (event: string, handler: (event?: unknown) => void) => void;
  destroy: () => void;
}

export interface AMapLngLatLike {
  lng?: number;
  lat?: number;
  getLng?: () => number;
  getLat?: () => number;
}

export interface AMapGeocoderResult {
  info?: string;
  geocodes?: Array<{ location?: AMapLngLatLike | [number, number] }>;
}

export interface AMapGeocoderInstance {
  getLocation: (keyword: string, callback: (status: string, result: AMapGeocoderResult) => void) => void;
}

export interface AMapNamespace {
  Map: new (container: HTMLElement | string, options?: Record<string, unknown>) => AMapMapInstance;
  Marker: new (options?: AMapMarkerOptions) => AMapMarkerInstance;
  Polyline?: new (options?: Record<string, unknown>) => unknown;
  Geocoder?: new (options?: Record<string, unknown>) => AMapGeocoderInstance;
  plugin?: (plugins: string | string[], callback: () => void) => void;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

let pending: Promise<AMapNamespace> | null = null;
let pendingKey = "";

export function loadAmap({ key, securityCode = "" }: { key: string; securityCode?: string }) {
  const trimmedKey = key.trim();
  if (!trimmedKey) return Promise.reject(new Error("AMap key is required"));
  if (typeof window === "undefined") return Promise.reject(new Error("AMap requires a browser"));
  if (window.AMap) return Promise.resolve(window.AMap);
  if (pending && pendingKey === trimmedKey) return pending;

  if (securityCode.trim()) {
    window._AMapSecurityConfig = { ...(window._AMapSecurityConfig || {}), securityJsCode: securityCode.trim() };
  }
  pendingKey = trimmedKey;
  pending = new Promise<AMapNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-live-memory-amap="1"]');
    const script = existing || document.createElement("script");
    const finish = () => {
      if (window.AMap) resolve(window.AMap);
      else {
        pending = null;
        reject(new Error("AMap loaded without a global namespace"));
      }
    };
    const fail = () => {
      pending = null;
      reject(new Error("AMap script failed to load"));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.dataset.liveMemoryAmap = "1";
      script.async = true;
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(trimmedKey)}`;
      document.head.appendChild(script);
    }
  });
  return pending;
}

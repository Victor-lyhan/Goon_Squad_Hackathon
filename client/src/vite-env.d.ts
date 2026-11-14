/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Maps JavaScript API browser key (repo-root .env). Optional: the map shows a key-missing state without it. */
  readonly VITE_GOOGLE_MAPS_BROWSER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

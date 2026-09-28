/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Strava API client ID (public). Set in CI from the STRAVA_CLIENT_ID repo variable. */
  readonly VITE_STRAVA_CLIENT_ID?: string;
}

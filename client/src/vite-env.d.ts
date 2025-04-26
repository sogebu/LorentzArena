/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    VITE_SIGNALING_SERVER_URL: string
  }
}

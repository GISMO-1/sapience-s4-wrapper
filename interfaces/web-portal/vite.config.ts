import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  server:
    command === "serve" && mode !== "test"
      ? {
          port: 5173,
          host: "0.0.0.0",
          proxy: {
            "/v1": {
              target: process.env.VITE_API_BASE || "http://localhost:8080",
              changeOrigin: true
            }
          }
        }
      : undefined,
  test: {
    environment: "jsdom",
    globals: true,
    pool: "threads",
    setupFiles: []
  }
}));

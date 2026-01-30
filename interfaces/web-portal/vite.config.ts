import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server:
    command === "serve"
      ? {
          port: 5173,
          host: "0.0.0.0"
        }
      : undefined,
  test: {
    environment: "jsdom",
    globals: true
  }
}));

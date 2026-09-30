import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localDb } from "./server/local-db.js";
import { apiMiddleware } from "./server/middleware.js";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    react(),
    {
      name: "site-check-api",
      configureServer(server) {
        server.middlewares.use(apiMiddleware(localDb()));
      },
    },
  ],
});

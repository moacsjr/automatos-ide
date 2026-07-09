import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js (via seu polyfill de buffer) referencia `global`,
  // que não existe no browser. Sem isto o módulo de login quebra no runtime
  // (ReferenceError: global is not defined) tanto no dev quanto no build.
  define: {
    global: "globalThis",
  },
  server: {
    port: 3000,
  },
});

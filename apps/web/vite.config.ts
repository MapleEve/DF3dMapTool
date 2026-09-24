/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    // three.js 引擎 chunk（动态加载）含轨道相机/楼层系统/流式加载，压缩后约 660KB，
    // 为有意拆分而非意外膨胀；阈值上调至 700KB 以免误导性告警，应用主包仍在 320KB 以内。
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

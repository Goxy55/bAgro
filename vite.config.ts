import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      deny: [
        "**/.env*",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/data/**",
        "**/source/**",
        "**/server/**",
        "**/scripts/**",
        "**/tests/**",
        "**/migrations/**",
      ],
    },
  },
  build: { outDir: "dist" },
});

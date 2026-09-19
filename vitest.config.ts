import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The same `@/` alias as tsconfig.json, so a test can import real modules
// rather than having to mock every `@/lib/...` the code under test touches.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

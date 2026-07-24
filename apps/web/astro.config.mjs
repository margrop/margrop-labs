import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

export default defineConfig({
  site: "https://lab.margrop.net",
  output: "static",
  integrations: [preact()],
});

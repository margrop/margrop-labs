import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://lab.margrop.net",
  output: "static",
  integrations: [
    preact(),
    sitemap({
      filter: (page) =>
        page !== "https://lab.margrop.net/404/" &&
        page !== "https://lab.margrop.net/interview-workbench/",
    }),
  ],
});

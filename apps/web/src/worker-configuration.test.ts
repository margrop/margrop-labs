import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

type WranglerConfiguration = {
  vars: {
    TOKEN_FORGE_AI_BUDGET_MULTIPLIER: string;
    TOKEN_FORGE_AI_TRANSPORT: string;
  };
  env: {
    preview: {
      vars: {
        TOKEN_FORGE_AI_BUDGET_MULTIPLIER: string;
        TOKEN_FORGE_AI_TRANSPORT: string;
      };
    };
  };
};

const readWranglerConfiguration = async (): Promise<WranglerConfiguration> => {
  const source = await readFile(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );

  return JSON.parse(
    source.replace(/,\s*([}\]])/g, "$1"),
  ) as WranglerConfiguration;
};

describe("Cloudflare Worker environment configuration", () => {
  it("uses the Preview-proven TCP transport in both environments", async () => {
    const configuration = await readWranglerConfiguration();

    expect(configuration.vars.TOKEN_FORGE_AI_TRANSPORT).toBe("cloudflare-tcp");
    expect(configuration.env.preview.vars.TOKEN_FORGE_AI_TRANSPORT).toBe(
      "cloudflare-tcp",
    );
  });

  it("keeps Production and Preview budget multipliers isolated", async () => {
    const configuration = await readWranglerConfiguration();

    expect(configuration.vars.TOKEN_FORGE_AI_BUDGET_MULTIPLIER).toBe("1");
    expect(
      configuration.env.preview.vars.TOKEN_FORGE_AI_BUDGET_MULTIPLIER,
    ).toBe("100");
  });
});

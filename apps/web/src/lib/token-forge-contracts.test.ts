import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  type TokenForgeInput,
  type TokenForgePlan,
  TokenForgeContractError,
  validateTokenForgeInput,
  validateTokenForgePlan,
} from "./token-forge-contracts";

const fixtureUrl = (name: string): URL =>
  new URL(`../../../../labs/token-forge/fixtures/${name}`, import.meta.url);

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const loadValidContracts = async (): Promise<{
  input: TokenForgeInput;
  plan: TokenForgePlan;
}> => {
  const input = validateTokenForgeInput(await readFixture("input.valid.json"));
  const plan = validateTokenForgePlan(
    input,
    await readFixture("plan.valid.json"),
  );

  return { input, plan };
};

const taskAt = (plan: TokenForgePlan, index: number) => {
  const task = plan.tasks[index];
  if (!task) {
    throw new Error(`Fixture task ${index} is required by this test.`);
  }

  return task;
};

describe("Token Forge v1 contracts", () => {
  it("accepts the repository fixtures", async () => {
    const { input, plan } = await loadValidContracts();

    expect(input.schema_version).toBe("1.0");
    expect(plan.mode).toBe("template");
    expect(plan.tasks.map((task) => task.size)).toEqual(["S", "M"]);
  });

  it("rejects non-GitHub repository URLs without echoing their value", async () => {
    const input = validateTokenForgeInput(
      await readFixture("input.valid.json"),
    );
    const candidate = {
      ...input,
      repository_url: "https://private.example.com/secret/repository",
    };

    let error: unknown;
    try {
      validateTokenForgeInput(candidate);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TokenForgeContractError);
    expect((error as Error).message).toContain("/repository_url");
    expect((error as Error).message).not.toContain("private.example.com");
  });

  it("rejects unknown input fields", async () => {
    const input = validateTokenForgeInput(
      await readFixture("input.valid.json"),
    );

    expect(() =>
      validateTokenForgeInput({
        ...input,
        private_token: "must-not-be-accepted",
      }),
    ).toThrow(/additional properties/);
  });

  it("rejects task estimates outside their S/M/L token band", async () => {
    const { input, plan } = await loadValidContracts();
    const candidate = structuredClone(plan);
    taskAt(candidate, 0).estimated_tokens = 8000;

    expect(() => validateTokenForgePlan(input, candidate)).toThrow(
      /token-forge-plan-v1 validation failed/,
    );
  });

  it("rejects duplicate task ids", async () => {
    const { input, plan } = await loadValidContracts();
    const candidate = structuredClone(plan);
    taskAt(candidate, 1).id = taskAt(candidate, 0).id;
    taskAt(candidate, 1).dependencies = [];

    expect(() => validateTokenForgePlan(input, candidate)).toThrow(
      /task ids must be unique/,
    );
  });

  it("rejects a plan whose task estimates exceed the token budget", async () => {
    const { input, plan } = await loadValidContracts();
    const smallerBudget = {
      ...input,
      token_budget: 20_000,
    };

    expect(() => validateTokenForgePlan(smallerBudget, plan)).toThrow(
      /estimated tokens exceed/,
    );
  });

  it("rejects a plan whose task estimates exceed available time", async () => {
    const { input, plan } = await loadValidContracts();
    const lessTime = {
      ...input,
      available_hours: 10,
    };

    expect(() => validateTokenForgePlan(lessTime, plan)).toThrow(
      /estimated hours exceed/,
    );
  });

  it("rejects dependencies outside the same plan", async () => {
    const { input, plan } = await loadValidContracts();
    const candidate = structuredClone(plan);
    taskAt(candidate, 1).dependencies = ["missing-task"];

    expect(() => validateTokenForgePlan(input, candidate)).toThrow(
      /dependencies must reference tasks in the same plan/,
    );
  });

  it("rejects cyclic dependencies", async () => {
    const { input, plan } = await loadValidContracts();
    const candidate = structuredClone(plan);
    taskAt(candidate, 0).dependencies = [taskAt(candidate, 1).id];

    expect(() => validateTokenForgePlan(input, candidate)).toThrow(
      /dependencies must not contain a cycle/,
    );
  });
});

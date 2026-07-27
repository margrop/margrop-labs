import {
  type TokenForgePolicyMutation,
  type TokenForgePolicyStore,
  handleTokenForgeAiRequest,
  tokenForgeAiEndpointPath,
} from "./server/token-forge-ai-runtime";
import type { TokenForgeAiPolicySnapshot } from "@margrop-labs/ai-gateway/token-forge-policy";

type DurableObjectTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

type DurableObjectStorage = {
  transaction<T>(
    callback: (transaction: DurableObjectTransaction) => Promise<T>,
  ): Promise<T>;
};

type DurableObjectState = {
  storage: DurableObjectStorage;
};

type DurableObjectStub = {
  fetch(request: Request): Promise<Response>;
};

type DurableObjectNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
};

type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnvironment = {
  ASSETS: AssetBinding;
  TOKEN_FORGE_AI_POLICY: DurableObjectNamespace;
  TOKEN_FORGE_AI_BASE_URL: string;
  TOKEN_FORGE_AI_MODEL: string;
  TOKEN_FORGE_AI_FALLBACK_MODEL: string;
  TOKEN_FORGE_AI_API_KEY: string;
  TOKEN_FORGE_ACTOR_KEY_SECRET: string;
};

const policySnapshotKey = "token-forge-ai-policy-v1";
const policyObjectName = "token-forge-plan-v1";

class DurableObjectPolicyStore implements TokenForgePolicyStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  mutate<T>(
    mutation: (
      snapshot: TokenForgeAiPolicySnapshot | undefined,
    ) => TokenForgePolicyMutation<T>,
  ): Promise<T> {
    return this.storage.transaction(async (transaction) => {
      const snapshot =
        await transaction.get<TokenForgeAiPolicySnapshot>(policySnapshotKey);
      const next = mutation(snapshot);
      await transaction.put(policySnapshotKey, next.snapshot);
      return next.result;
    });
  }
}

export class TokenForgeAiPolicyObject {
  private readonly store: TokenForgePolicyStore;

  constructor(
    state: DurableObjectState,
    private readonly environment: WorkerEnvironment,
  ) {
    this.store = new DurableObjectPolicyStore(state.storage);
  }

  fetch(request: Request): Promise<Response> {
    return handleTokenForgeAiRequest(request, {
      store: this.store,
      environment: this.environment,
    });
  }
}

export default {
  fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === tokenForgeAiEndpointPath) {
      const id = environment.TOKEN_FORGE_AI_POLICY.idFromName(policyObjectName);
      return environment.TOKEN_FORGE_AI_POLICY.get(id).fetch(request);
    }
    if (url.pathname.startsWith("/api/")) {
      return Promise.resolve(
        new Response("Not found", {
          status: 404,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        }),
      );
    }
    return environment.ASSETS.fetch(request);
  },
};

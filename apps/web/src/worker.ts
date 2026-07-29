import {
  type TokenForgePolicyMutation,
  type TokenForgePolicyStore,
  handleTokenForgeAiRequest,
  tokenForgeAiEndpointPath,
  tokenForgeAiGatewayPolicy,
} from "./server/token-forge-ai-runtime";
import {
  handleInterviewAiRequest,
  interviewAiGatewayPolicy,
  type InterviewAiRuntimeEnvironment,
} from "./server/interview-ai-runtime";
import { getInterviewAiOperationByPath } from "./server/ai-operation-registry";
import {
  handleIncidentDetectiveAiRequest,
  incidentDetectiveAiGatewayPolicy,
  type IncidentDetectiveAiRuntimeEnvironment,
} from "./server/incident-detective-ai-runtime";
import { getIncidentDetectiveAiOperationByPath } from "./server/incident-detective-ai-registry";
import type { TokenForgeAiPolicySnapshot } from "@margrop-labs/ai-gateway/token-forge-policy";
import { connect } from "cloudflare:sockets";

import { createCloudflareTcpFetch } from "./server/cloudflare-tcp-fetch";
import {
  type TokenForgeAnalyticsSnapshot,
  tokenForgeAnalyticsEndpointPath,
} from "./server/token-forge-analytics";
import { interviewAnalyticsEndpointPath } from "./lib/interview-analytics";
import {
  handleLabAnalyticsRequest,
  migrateTokenForgeAnalyticsSnapshot,
  type LabAnalyticsMutation,
  type LabAnalyticsSnapshot,
  type LabAnalyticsStore,
} from "./server/lab-analytics";

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
  INTERVIEW_AI_POLICY: DurableObjectNamespace;
  INCIDENT_DETECTIVE_AI_POLICY: DurableObjectNamespace;
  TOKEN_FORGE_ANALYTICS: DurableObjectNamespace;
  TOKEN_FORGE_AI_BASE_URL: string;
  TOKEN_FORGE_AI_MODEL: string;
  TOKEN_FORGE_AI_FALLBACK_MODEL: string;
  TOKEN_FORGE_AI_BUDGET_MULTIPLIER: string;
  TOKEN_FORGE_AI_TRANSPORT: string;
  TOKEN_FORGE_AI_API_KEY: string;
  TOKEN_FORGE_ACTOR_KEY_SECRET: string;
};

const policySnapshotKey = "token-forge-ai-policy-v1";
const policyObjectName = "token-forge-plan-v1";
const interviewPolicySnapshotKey = "interview-ai-policy-v1";
const incidentDetectivePolicySnapshotKey = "incident-detective-ai-policy-v1";
const legacyAnalyticsSnapshotKey = "token-forge-analytics-snapshot-v1";
const analyticsSnapshotKey = "lab-analytics-snapshot-v1";
const analyticsObjectName = "token-forge-analytics-v1";

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

class DurableObjectInterviewAiPolicyStore implements TokenForgePolicyStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  mutate<T>(
    mutation: (
      snapshot: TokenForgeAiPolicySnapshot | undefined,
    ) => TokenForgePolicyMutation<T>,
  ): Promise<T> {
    return this.storage.transaction(async (transaction) => {
      const snapshot = await transaction.get<TokenForgeAiPolicySnapshot>(
        interviewPolicySnapshotKey,
      );
      const next = mutation(snapshot);
      await transaction.put(interviewPolicySnapshotKey, next.snapshot);
      return next.result;
    });
  }
}

class DurableObjectIncidentDetectiveAiPolicyStore implements TokenForgePolicyStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  mutate<T>(
    mutation: (
      snapshot: TokenForgeAiPolicySnapshot | undefined,
    ) => TokenForgePolicyMutation<T>,
  ): Promise<T> {
    return this.storage.transaction(async (transaction) => {
      const snapshot = await transaction.get<TokenForgeAiPolicySnapshot>(
        incidentDetectivePolicySnapshotKey,
      );
      const next = mutation(snapshot);
      await transaction.put(incidentDetectivePolicySnapshotKey, next.snapshot);
      return next.result;
    });
  }
}

export class TokenForgeAiPolicyObject {
  private readonly store: TokenForgePolicyStore;
  private readonly providerFetch: typeof fetch;

  constructor(
    state: DurableObjectState,
    private readonly environment: WorkerEnvironment,
  ) {
    this.store = new DurableObjectPolicyStore(state.storage);
    this.providerFetch =
      environment.TOKEN_FORGE_AI_TRANSPORT === "cloudflare-tcp"
        ? createCloudflareTcpFetch({
            connect,
            maxResponseBytes: tokenForgeAiGatewayPolicy.maxResponseBytes,
          })
        : environment.TOKEN_FORGE_AI_TRANSPORT === "fetch"
          ? fetch
          : () => Promise.reject(new TypeError("Invalid Provider transport."));
  }

  fetch(request: Request): Promise<Response> {
    return handleTokenForgeAiRequest(request, {
      store: this.store,
      environment: this.environment,
      fetch: this.providerFetch,
    });
  }
}

export class InterviewAiPolicyObject {
  private readonly store: TokenForgePolicyStore;
  private readonly providerFetch: typeof fetch;

  constructor(
    state: DurableObjectState,
    private readonly environment: WorkerEnvironment,
  ) {
    this.store = new DurableObjectInterviewAiPolicyStore(state.storage);
    this.providerFetch =
      environment.TOKEN_FORGE_AI_TRANSPORT === "cloudflare-tcp"
        ? createCloudflareTcpFetch({
            connect,
            maxResponseBytes: interviewAiGatewayPolicy.maxResponseBytes,
          })
        : environment.TOKEN_FORGE_AI_TRANSPORT === "fetch"
          ? fetch
          : () => Promise.reject(new TypeError("Invalid Provider transport."));
  }

  fetch(request: Request): Promise<Response> {
    return handleInterviewAiRequest(request, {
      store: this.store,
      environment: this.environment as InterviewAiRuntimeEnvironment,
      fetch: this.providerFetch,
    });
  }
}

export class IncidentDetectiveAiPolicyObject {
  private readonly store: TokenForgePolicyStore;
  private readonly providerFetch: typeof fetch;

  constructor(
    state: DurableObjectState,
    private readonly environment: WorkerEnvironment,
  ) {
    this.store = new DurableObjectIncidentDetectiveAiPolicyStore(state.storage);
    this.providerFetch =
      environment.TOKEN_FORGE_AI_TRANSPORT === "cloudflare-tcp"
        ? createCloudflareTcpFetch({
            connect,
            maxResponseBytes: incidentDetectiveAiGatewayPolicy.maxResponseBytes,
          })
        : environment.TOKEN_FORGE_AI_TRANSPORT === "fetch"
          ? fetch
          : () => Promise.reject(new TypeError("Invalid Provider transport."));
  }

  fetch(request: Request): Promise<Response> {
    return handleIncidentDetectiveAiRequest(request, {
      store: this.store,
      environment: this.environment as IncidentDetectiveAiRuntimeEnvironment,
      fetch: this.providerFetch,
    });
  }
}

class DurableObjectAnalyticsStore implements LabAnalyticsStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  mutate<T>(
    mutation: (
      snapshot: LabAnalyticsSnapshot | undefined,
    ) => LabAnalyticsMutation<T>,
  ): Promise<T> {
    return this.storage.transaction(async (transaction) => {
      const sharedSnapshot =
        await transaction.get<LabAnalyticsSnapshot>(analyticsSnapshotKey);
      const legacySnapshot = sharedSnapshot
        ? undefined
        : await transaction.get<TokenForgeAnalyticsSnapshot>(
            legacyAnalyticsSnapshotKey,
          );
      const snapshot =
        sharedSnapshot ?? migrateTokenForgeAnalyticsSnapshot(legacySnapshot);
      const next = mutation(snapshot);
      await transaction.put(analyticsSnapshotKey, next.snapshot);
      return next.result;
    });
  }
}

export class TokenForgeAnalyticsObject {
  private readonly store: LabAnalyticsStore;

  constructor(state: DurableObjectState) {
    this.store = new DurableObjectAnalyticsStore(state.storage);
  }

  fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === tokenForgeAnalyticsEndpointPath) {
      return handleLabAnalyticsRequest(
        request,
        { store: this.store },
        "token-forge",
      );
    }
    if (pathname === interviewAnalyticsEndpointPath) {
      return handleLabAnalyticsRequest(
        request,
        { store: this.store },
        "interview-workbench",
      );
    }
    return Promise.resolve(
      new Response(null, {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      }),
    );
  }
}

export default {
  fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === tokenForgeAiEndpointPath) {
      const id = environment.TOKEN_FORGE_AI_POLICY.idFromName(policyObjectName);
      return environment.TOKEN_FORGE_AI_POLICY.get(id).fetch(request);
    }
    const interviewOperation = getInterviewAiOperationByPath(url.pathname);
    if (interviewOperation) {
      const id = environment.INTERVIEW_AI_POLICY.idFromName(
        interviewOperation.operation,
      );
      return environment.INTERVIEW_AI_POLICY.get(id).fetch(request);
    }
    const incidentDetectiveOperation = getIncidentDetectiveAiOperationByPath(
      url.pathname,
    );
    if (incidentDetectiveOperation) {
      const id = environment.INCIDENT_DETECTIVE_AI_POLICY.idFromName(
        incidentDetectiveOperation.operation,
      );
      return environment.INCIDENT_DETECTIVE_AI_POLICY.get(id).fetch(request);
    }
    if (
      url.pathname === tokenForgeAnalyticsEndpointPath ||
      url.pathname === interviewAnalyticsEndpointPath
    ) {
      const id =
        environment.TOKEN_FORGE_ANALYTICS.idFromName(analyticsObjectName);
      return environment.TOKEN_FORGE_ANALYTICS.get(id).fetch(request);
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

import type { JsonObject } from "@margrop-labs/ai-gateway";

import baseScenarioCandidate from "../../../../labs/incident-detective/cases/mysql-leading-wildcard/scenario.json";
import {
  incidentDetectiveExplanationOperationId,
  validateIncidentDetectiveExplanation,
  validateIncidentDetectiveExplanationInput,
} from "../lib/incident-detective-ai-explanation";
import {
  type IncidentDetectiveCaseGenerationProviderInput,
  incidentDetectiveCaseGenerationOperationId,
  postProcessIncidentDetectiveCaseProposal,
  prepareIncidentDetectiveCaseGenerationProviderInput,
  validateIncidentDetectiveCaseGenerationInput,
} from "../lib/incident-detective-case-generation";
import { validateIncidentDetectiveScenario } from "../lib/incident-detective-contracts";
import { incidentDetectiveAiSystemPrompts } from "./incident-detective-ai-prompt";

export const incidentDetectiveAiLabId = "incident-detective" as const;

export type IncidentDetectiveAiOperationKey = "explanation" | "caseProposal";

export type IncidentDetectiveAiOperationDefinition = Readonly<{
  key: IncidentDetectiveAiOperationKey;
  lab_id: typeof incidentDetectiveAiLabId;
  operation: string;
  endpoint_path: string;
  system_prompt: string;
  prepareInput(candidate: JsonObject): JsonObject;
  validateOutput(
    candidate: unknown,
    publicInput: JsonObject,
    providerInput: JsonObject,
  ): JsonObject;
}>;

const baseScenario = validateIncidentDetectiveScenario(baseScenarioCandidate);

const definitions: Record<
  IncidentDetectiveAiOperationKey,
  IncidentDetectiveAiOperationDefinition
> = {
  explanation: {
    key: "explanation",
    lab_id: incidentDetectiveAiLabId,
    operation: incidentDetectiveExplanationOperationId,
    endpoint_path: "/api/incident-detective/explanation",
    system_prompt: incidentDetectiveAiSystemPrompts.explanation,
    prepareInput: (candidate) =>
      validateIncidentDetectiveExplanationInput(
        candidate,
      ) as unknown as JsonObject,
    validateOutput: (candidate, publicInput) =>
      validateIncidentDetectiveExplanation(
        candidate,
        validateIncidentDetectiveExplanationInput(publicInput),
      ) as unknown as JsonObject,
  },
  caseProposal: {
    key: "caseProposal",
    lab_id: incidentDetectiveAiLabId,
    operation: incidentDetectiveCaseGenerationOperationId,
    endpoint_path: "/api/incident-detective/case-proposal",
    system_prompt: incidentDetectiveAiSystemPrompts.caseProposal,
    prepareInput: (candidate) =>
      prepareIncidentDetectiveCaseGenerationProviderInput(
        validateIncidentDetectiveCaseGenerationInput(candidate),
        baseScenario,
      ) as unknown as JsonObject,
    validateOutput: (candidate, publicInput, providerInput) =>
      postProcessIncidentDetectiveCaseProposal(
        validateIncidentDetectiveCaseGenerationInput(publicInput),
        providerInput as IncidentDetectiveCaseGenerationProviderInput,
        candidate,
      ) as unknown as JsonObject,
  },
};

export const incidentDetectiveAiOperationRegistry: Readonly<
  Record<
    IncidentDetectiveAiOperationKey,
    IncidentDetectiveAiOperationDefinition
  >
> = Object.freeze(definitions);

const definitionsByPath = new Map(
  Object.values(definitions).map((definition) => [
    definition.endpoint_path,
    definition,
  ]),
);
const definitionsByOperation = new Map(
  Object.values(definitions).map((definition) => [
    definition.operation,
    definition,
  ]),
);

export const getIncidentDetectiveAiOperationByPath = (
  path: string,
): IncidentDetectiveAiOperationDefinition | undefined =>
  definitionsByPath.get(path);

export const getIncidentDetectiveAiOperation = (
  labId: string,
  operation: string,
): IncidentDetectiveAiOperationDefinition | undefined =>
  labId === incidentDetectiveAiLabId
    ? definitionsByOperation.get(operation)
    : undefined;

export const incidentDetectiveAiEndpointPaths = Object.freeze([
  ...definitionsByPath.keys(),
] as string[]);

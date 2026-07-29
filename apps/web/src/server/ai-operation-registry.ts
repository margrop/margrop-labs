import type { JsonObject } from "@margrop-labs/ai-gateway";

import {
  interviewAiLabId,
  interviewAiOperationIds,
  validateInterviewAiConclusionInput,
  validateInterviewAiConclusionOutput,
  validateInterviewAiMatchInput,
  validateInterviewAiMatchOutput,
  validateInterviewAiPlanInput,
  validateInterviewAiPlanOutput,
} from "./interview-ai-contracts";
import { interviewAiSystemPrompts } from "./interview-ai-prompt";
import {
  smartRmaAiEndpointPath,
  smartRmaAiOperationId,
  validateSmartRmaAiExplanation,
  validateSmartRmaAiInput,
} from "../lib/smart-rma-ai";
import { smartRmaAiSystemPrompt } from "./smart-rma-ai-prompt";

export type InterviewAiOperationKey =
  "match" | "plan" | "conclusion" | "smart-rma-explain";

export type InterviewAiOperationDefinition = Readonly<{
  key: InterviewAiOperationKey;
  lab_id: string;
  operation: string;
  endpoint_path: string;
  system_prompt: string;
  validateInput(candidate: JsonObject): JsonObject;
  validateOutput(candidate: unknown, input: JsonObject): JsonObject;
}>;

const definitions: Record<
  InterviewAiOperationKey,
  InterviewAiOperationDefinition
> = {
  match: {
    key: "match",
    lab_id: interviewAiLabId,
    operation: interviewAiOperationIds.match,
    endpoint_path: "/api/interview-workbench/match",
    system_prompt: interviewAiSystemPrompts.match,
    validateInput: (candidate) =>
      validateInterviewAiMatchInput(candidate) as unknown as JsonObject,
    validateOutput: (candidate, input) =>
      validateInterviewAiMatchOutput(
        candidate,
        validateInterviewAiMatchInput(input),
      ) as unknown as JsonObject,
  },
  plan: {
    key: "plan",
    lab_id: interviewAiLabId,
    operation: interviewAiOperationIds.plan,
    endpoint_path: "/api/interview-workbench/plan",
    system_prompt: interviewAiSystemPrompts.plan,
    validateInput: (candidate) =>
      validateInterviewAiPlanInput(candidate) as unknown as JsonObject,
    validateOutput: (candidate, input) =>
      validateInterviewAiPlanOutput(
        candidate,
        validateInterviewAiPlanInput(input),
      ) as unknown as JsonObject,
  },
  conclusion: {
    key: "conclusion",
    lab_id: interviewAiLabId,
    operation: interviewAiOperationIds.conclusion,
    endpoint_path: "/api/interview-workbench/conclusion",
    system_prompt: interviewAiSystemPrompts.conclusion,
    validateInput: (candidate) =>
      validateInterviewAiConclusionInput(candidate) as unknown as JsonObject,
    validateOutput: (candidate, input) =>
      validateInterviewAiConclusionOutput(
        candidate,
        validateInterviewAiConclusionInput(input),
      ) as unknown as JsonObject,
  },
  "smart-rma-explain": {
    key: "smart-rma-explain",
    lab_id: "smart-rma",
    operation: smartRmaAiOperationId,
    endpoint_path: smartRmaAiEndpointPath,
    system_prompt: smartRmaAiSystemPrompt,
    validateInput: (candidate) =>
      validateSmartRmaAiInput(candidate) as unknown as JsonObject,
    validateOutput: (candidate, input) =>
      validateSmartRmaAiExplanation(
        candidate,
        validateSmartRmaAiInput(input),
      ) as unknown as JsonObject,
  },
};

export const interviewAiOperationRegistry: Readonly<
  Record<InterviewAiOperationKey, InterviewAiOperationDefinition>
> = Object.freeze(definitions);

const definitionsByPath = new Map(
  Object.values(definitions).map((definition) => [
    definition.endpoint_path,
    definition,
  ]),
);
const definitionsByOperation = new Map(
  Object.values(definitions).map((definition) => [
    `${definition.lab_id}:${definition.operation}`,
    definition,
  ]),
);

export const getInterviewAiOperationByPath = (
  path: string,
): InterviewAiOperationDefinition | undefined => definitionsByPath.get(path);

export const getInterviewAiOperation = (
  labId: string,
  operation: string,
): InterviewAiOperationDefinition | undefined =>
  definitionsByOperation.get(`${labId}:${operation}`);

export const interviewAiEndpointPaths = Object.freeze([
  ...definitionsByPath.keys(),
] as string[]);

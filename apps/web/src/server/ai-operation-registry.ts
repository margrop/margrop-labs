import type { JsonObject } from "@margrop-labs/ai-gateway";

import {
  interviewAiLabId,
  interviewAiOperationIds,
  type InterviewAiConclusionInput,
  type InterviewAiMatchInput,
  type InterviewAiPlanInput,
  validateInterviewAiConclusionInput,
  validateInterviewAiConclusionOutput,
  validateInterviewAiMatchInput,
  validateInterviewAiMatchOutput,
  validateInterviewAiPlanInput,
  validateInterviewAiPlanOutput,
} from "./interview-ai-contracts";
import { interviewAiSystemPrompts } from "./interview-ai-prompt";

export type InterviewAiOperationKey = "match" | "plan" | "conclusion";

export type InterviewAiOperationDefinition = Readonly<{
  key: InterviewAiOperationKey;
  lab_id: typeof interviewAiLabId;
  operation: string;
  endpoint_path: string;
  system_prompt: string;
  validateInput(
    candidate: JsonObject,
  ): InterviewAiMatchInput | InterviewAiPlanInput | InterviewAiConclusionInput;
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
    validateInput: (candidate) => validateInterviewAiMatchInput(candidate),
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
    validateInput: (candidate) => validateInterviewAiPlanInput(candidate),
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
    validateInput: (candidate) => validateInterviewAiConclusionInput(candidate),
    validateOutput: (candidate, input) =>
      validateInterviewAiConclusionOutput(
        candidate,
        validateInterviewAiConclusionInput(input),
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
    definition.operation,
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
  labId === interviewAiLabId
    ? definitionsByOperation.get(operation)
    : undefined;

export const interviewAiEndpointPaths = Object.freeze([
  ...definitionsByPath.keys(),
] as string[]);

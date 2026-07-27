import {
  type TokenForgeInput,
  type TokenForgePlan,
  type TokenForgeTask,
  validateTokenForgePlan,
} from "./token-forge-contracts";

export type TokenForgeQualityStatus = "ready" | "review";
export type TokenForgeQualityRuleStatus = "pass" | "warning";
export type TokenForgeRepositoryQualityStatus =
  "not-requested" | "summarized" | "fallback";

export type TokenForgeQualityRule = {
  rule_id: `QF-Q0${1 | 2 | 3 | 4 | 5 | 6}`;
  status: TokenForgeQualityRuleStatus;
  points: number;
  max_points: number;
  message: string;
};

export type TokenForgeOrderRule = {
  rule_id: "QF-O01" | "QF-O02" | "QF-O03";
  message: string;
};

export type TokenForgeQualityEvidence = {
  rule_id: "QF-E01" | "QF-E02" | "QF-E03";
  message: string;
};

export type TokenForgeTaskQuality = {
  task_id: string;
  score: number;
  status: TokenForgeQualityStatus;
  rank: number;
  original_rank: number;
  rules: TokenForgeQualityRule[];
  order: TokenForgeOrderRule;
};

export type TokenForgePlanQuality = {
  schema_version: "1.0";
  score: number;
  status: TokenForgeQualityStatus;
  ready_task_count: number;
  review_task_count: number;
  ordered_task_ids: string[];
  tasks: TokenForgeTaskQuality[];
  evidence: TokenForgeQualityEvidence;
};

export type TokenForgeQualityResult = {
  plan: TokenForgePlan;
  quality: TokenForgePlanQuality;
};

export type TokenForgeQualityContext = {
  repository_status: TokenForgeRepositoryQualityStatus;
};

type ScoredTask = {
  task: TokenForgeTask;
  score: number;
  status: TokenForgeQualityStatus;
  originalIndex: number;
  rules: TokenForgeQualityRule[];
};

const readyScore = 80;
const budgetConcentrationThreshold = 0.7;

const actionPattern =
  /定义|实现|接通|生成|修复|创建|构建|迁移|补齐|收紧|验证|增加|更新|替换|移除|拆分|重构|配置|部署|编写|建立/iu;
const artifactPattern =
  /合同|schema|测试|文档|功能|组件|页面|接口|流程|核心|入口|适配器|任务|计划|导出|脚本|规则|状态|样例|基准|api|mvp|ui|响应|请求|数据|报告/iu;
const boundaryPattern =
  /仓库|模型|服务|基础设施|生产|外部|登录|支付|持久化|网络|存储|写操作|部署|ai|analytics/iu;
const vaguePattern =
  /相关|适当|尽量|有所|达到预期|符合要求|视情况|根据实际情况|整体效果|其他事项/iu;
const verificationPattern =
  /测试|验证|验收|质量命令|schema|类型检查|构建|状态码|响应|检查|断言|fixture|快照|lint|typecheck/iu;
const outcomePattern =
  /通过|返回|生成|包含|不包含|拒绝|阻断|保持|产生|完成|覆盖|可用|一致|小于|大于|不超过|不得|不会|不调用|不回显|可以|能够|必须/iu;
const evidencePattern =
  /测试|命令|schema|状态|返回|输出|文件|页面|键盘|移动端|网络|provider|fixture|样例|合同|依赖|预算|工时|文档|字段|任务|路径|内容|错误|结果|入口|流程|链接|组件|api|响应|请求|token|小时|长度|次数|百分比|\d/iu;

const rule = (
  ruleId: TokenForgeQualityRule["rule_id"],
  points: number,
  maxPoints: number,
  passMessage: string,
  warningMessage: string,
): TokenForgeQualityRule => ({
  rule_id: ruleId,
  status: points === maxPoints ? "pass" : "warning",
  points,
  max_points: maxPoints,
  message: points === maxPoints ? passMessage : warningMessage,
});

const scoreTitle = (task: TokenForgeTask): TokenForgeQualityRule => {
  const hasAction = actionPattern.test(task.title);
  const hasArtifact = artifactPattern.test(task.title);
  const isVague = vaguePattern.test(task.title);
  const points =
    !isVague && hasAction && hasArtifact
      ? 20
      : hasAction || hasArtifact
        ? 10
        : 0;

  return rule(
    "QF-Q01",
    points,
    20,
    "标题同时给出交付动作和可识别产物。",
    "标题缺少明确动作或产物，或仍包含空泛限定词。",
  );
};

const scoreScope = (task: TokenForgeTask): TokenForgeQualityRule => {
  const includedPoints = task.scope.included.length >= 2 ? 8 : 0;
  const hasSpecificExclusion = task.scope.excluded.some(
    (item) =>
      !vaguePattern.test(item) &&
      (artifactPattern.test(item) || boundaryPattern.test(item)),
  );
  const points = includedPoints + (hasSpecificExclusion ? 7 : 0);

  return rule(
    "QF-Q02",
    points,
    15,
    "包含范围至少两项，且非目标指向具体产物或系统边界。",
    "包含范围过少，或非目标仍不足以阻止任务扩张。",
  );
};

const scoreAcceptanceDepth = (task: TokenForgeTask): TokenForgeQualityRule => {
  const points = task.acceptance_criteria.length >= 2 ? 15 : 5;

  return rule(
    "QF-Q03",
    points,
    15,
    "至少两条验收标准覆盖任务结果。",
    "只有一条验收标准，失败和边界结果可能没有被覆盖。",
  );
};

const isVerifiableCriterion = (criterion: string): boolean =>
  !vaguePattern.test(criterion) &&
  outcomePattern.test(criterion) &&
  evidencePattern.test(criterion);

const scoreAcceptanceVerifiability = (
  task: TokenForgeTask,
): TokenForgeQualityRule => {
  const verifiableCount = task.acceptance_criteria.filter(
    isVerifiableCriterion,
  ).length;
  const ratio = verifiableCount / task.acceptance_criteria.length;
  const points = ratio === 1 ? 20 : ratio >= 0.5 ? 10 : 0;

  return rule(
    "QF-Q04",
    points,
    20,
    "每条验收标准都包含可观察结果和验证证据。",
    "部分验收标准无法由测试、命令、状态或明确产物客观判断。",
  );
};

const scorePrompt = (task: TokenForgeTask): TokenForgeQualityRule => {
  const hasAction = actionPattern.test(task.prompt);
  const hasVerification = verificationPattern.test(task.prompt);
  const points =
    hasAction && hasVerification ? 15 : hasAction || hasVerification ? 8 : 0;

  return rule(
    "QF-Q05",
    points,
    15,
    "执行 Prompt 同时包含实施动作和验证步骤。",
    "执行 Prompt 缺少实施动作或可重复的验证步骤。",
  );
};

const scoreBudgetBalance = (
  input: TokenForgeInput,
  plan: TokenForgePlan,
  task: TokenForgeTask,
): TokenForgeQualityRule => {
  if (plan.tasks.length === 1) {
    return rule(
      "QF-Q06",
      15,
      15,
      "单任务计划已通过总 Token 与工时上限验证。",
      "",
    );
  }

  const tokenConcentrated =
    task.estimated_tokens / input.token_budget > budgetConcentrationThreshold;
  const timeConcentrated =
    task.estimated_hours / input.available_hours > budgetConcentrationThreshold;
  const points =
    tokenConcentrated && timeConcentrated
      ? 0
      : tokenConcentrated || timeConcentrated
        ? 8
        : 15;

  return rule(
    "QF-Q06",
    points,
    15,
    "该任务不独占超过 70% 的 Token 或可投入工时。",
    "该任务占用超过 70% 的 Token 或工时，执行前应确认是否继续拆分。",
  );
};

const scoreTask = (
  input: TokenForgeInput,
  plan: TokenForgePlan,
  task: TokenForgeTask,
  originalIndex: number,
): ScoredTask => {
  const rules = [
    scoreTitle(task),
    scoreScope(task),
    scoreAcceptanceDepth(task),
    scoreAcceptanceVerifiability(task),
    scorePrompt(task),
    scoreBudgetBalance(input, plan, task),
  ];
  const score = rules.reduce((total, item) => total + item.points, 0);
  const hasCriticalBudgetConcentration = rules.some(
    (item) => item.rule_id === "QF-Q06" && item.points === 0,
  );

  return {
    task,
    score,
    status:
      score >= readyScore && !hasCriticalBudgetConcentration
        ? "ready"
        : "review",
    originalIndex,
    rules,
  };
};

const orderTasks = (
  scoredTasks: ScoredTask[],
): Array<ScoredTask & { order: TokenForgeOrderRule }> => {
  const remaining = new Map(
    scoredTasks.map((task) => [task.task.id, task] as const),
  );
  const placed = new Set<string>();
  const ordered: Array<ScoredTask & { order: TokenForgeOrderRule }> = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((candidate) =>
        candidate.task.dependencies.every((dependency) =>
          placed.has(dependency),
        ),
      )
      .sort(
        (left, right) =>
          right.score - left.score || left.originalIndex - right.originalIndex,
      );
    const selected = ready[0];

    if (!selected) {
      throw new Error(
        "Token Forge quality ordering requires an acyclic validated plan.",
      );
    }

    const lowerScoreWasReady = ready.some(
      (candidate) => candidate.score < selected.score,
    );
    const order: TokenForgeOrderRule =
      selected.task.dependencies.length > 0
        ? {
            rule_id: "QF-O01",
            message: "所有前置任务已排在此前，再按质量分进入当前可执行位置。",
          }
        : lowerScoreWasReady
          ? {
              rule_id: "QF-O02",
              message: "在当前可执行任务中，较高规则质量分优先。",
            }
          : {
              rule_id: "QF-O03",
              message: "当前可执行任务同分，保留原始稳定顺序。",
            };

    ordered.push({ ...selected, order });
    placed.add(selected.task.id);
    remaining.delete(selected.task.id);
  }

  return ordered;
};

const buildEvidence = (
  input: TokenForgeInput,
  context?: TokenForgeQualityContext,
): TokenForgeQualityEvidence => {
  const repositoryStatus =
    context?.repository_status ??
    (input.repository_url === undefined ? "not-requested" : "fallback");

  if (repositoryStatus === "summarized") {
    return {
      rule_id: "QF-E02",
      message:
        "受限仓库摘要可用；评分仍只判断任务结构，不把采样结果当作完整代码审计。",
    };
  }

  if (repositoryStatus === "fallback") {
    return {
      rule_id: "QF-E03",
      message: "仓库证据不可用或已降级；评分不声称任务与现有实现完全匹配。",
    };
  }

  return {
    rule_id: "QF-E01",
    message: "未请求仓库证据；评分只判断计划是否清楚、可验收且符合预算。",
  };
};

export const assessAndOrderTokenForgePlan = (
  input: TokenForgeInput,
  candidate: unknown,
  context?: TokenForgeQualityContext,
): TokenForgeQualityResult => {
  const validatedPlan = validateTokenForgePlan(input, candidate);
  const ordered = orderTasks(
    validatedPlan.tasks.map((task, index) =>
      scoreTask(input, validatedPlan, task, index),
    ),
  );
  const plan = validateTokenForgePlan(input, {
    ...validatedPlan,
    tasks: ordered.map((task) => task.task),
  });
  const tasks: TokenForgeTaskQuality[] = ordered.map((task, index) => ({
    task_id: task.task.id,
    score: task.score,
    status: task.status,
    rank: index + 1,
    original_rank: task.originalIndex + 1,
    rules: task.rules,
    order: task.order,
  }));
  const reviewTaskCount = tasks.filter(
    (task) => task.status === "review",
  ).length;
  const score = Math.round(
    tasks.reduce((total, task) => total + task.score, 0) / tasks.length,
  );

  return {
    plan,
    quality: {
      schema_version: "1.0",
      score,
      status: reviewTaskCount === 0 ? "ready" : "review",
      ready_task_count: tasks.length - reviewTaskCount,
      review_task_count: reviewTaskCount,
      ordered_task_ids: tasks.map((task) => task.task_id),
      tasks,
      evidence: buildEvidence(input, context),
    },
  };
};

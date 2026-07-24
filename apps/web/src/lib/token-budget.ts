export type TaskBand = {
  label: "S" | "M" | "L";
  title: string;
  scope: string;
  color: "amber" | "cyan" | "violet";
};

export const calculateDailyBudget = (tokens: number, days: number): number =>
  Math.floor(tokens / Math.max(days, 1));

export const chooseTask = (tokens: number, days: number): TaskBand => {
  const dailyBudget = calculateDailyBudget(tokens, days);

  if (tokens >= 25_000 && dailyBudget >= 3_000) {
    return {
      label: "L",
      title: "完成一条离线 MVP",
      scope: "拆成 2–3 个可验收阶段：合同与测试、确定性核心、交互与文档。",
      color: "violet",
    };
  }

  if (tokens >= 8_000) {
    return {
      label: "M",
      title: "实现一个完整功能切片",
      scope: "选择一个解析器、适配器或交互流程，同时补齐失败测试和文档。",
      color: "cyan",
    };
  }

  return {
    label: "S",
    title: "完成一个低风险小任务",
    scope: "优先处理 Schema、fixture、纯函数、测试或一段明确的技术文档。",
    color: "amber",
  };
};

export const explainTaskBand = (tokens: number, days: number): string => {
  const task = chooseTask(tokens, days);
  const dailyBudget = calculateDailyBudget(tokens, days);

  if (task.label === "L") {
    return `总额度不少于 25,000，且每日预算 ${dailyBudget.toLocaleString("zh-CN")} 不少于 3,000。`;
  }

  if (task.label === "M") {
    return `总额度不少于 8,000；当前每日预算约 ${dailyBudget.toLocaleString("zh-CN")}。`;
  }

  return `总额度少于 8,000；当前每日预算约 ${dailyBudget.toLocaleString("zh-CN")}。`;
};

export const buildTokenBudgetExport = (
  tokens: number,
  days: number,
): string => {
  const task = chooseTask(tokens, days);

  return [
    "# Margrop Labs · Token 预算预览",
    "",
    "## 输入",
    "",
    `- 可用 Token：${tokens.toLocaleString("zh-CN")}`,
    `- 距离过期：${days} 天`,
    `- 每日预算：${calculateDailyBudget(tokens, days).toLocaleString("zh-CN")}`,
    "",
    "## 规则结果",
    "",
    `- 建议规模：${task.label}`,
    `- 建议任务：${task.title}`,
    `- 范围说明：${task.scope}`,
    `- 判定依据：${explainTaskBand(tokens, days)}`,
    "",
    "## 数据边界",
    "",
    "- 结果由浏览器本地规则生成。",
    "- 未调用 AI，未读取仓库，也未保存输入。",
    "",
  ].join("\n");
};

export type TaskBand = {
  label: "S" | "M" | "L";
  title: string;
  scope: string;
  color: "amber" | "cyan" | "violet";
};

export const chooseTask = (tokens: number, days: number): TaskBand => {
  const dailyBudget = tokens / Math.max(days, 1);

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

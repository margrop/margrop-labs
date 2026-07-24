import { useId, useMemo, useState } from "preact/hooks";

type TaskBand = {
  label: "S" | "M" | "L";
  title: string;
  scope: string;
  color: string;
};

const chooseTask = (tokens: number, days: number): TaskBand => {
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

export default function TokenBudgetPreview() {
  const tokenId = useId();
  const dayId = useId();
  const [tokens, setTokens] = useState(12_000);
  const [days, setDays] = useState(7);
  const task = useMemo(() => chooseTask(tokens, days), [tokens, days]);

  return (
    <section class="token-preview" aria-labelledby="token-preview-title">
      <div class="preview-copy">
        <p class="section-kicker">HELLO LAB · LOCAL ONLY</p>
        <h2 id="token-preview-title">先把一份闲置额度，变成一条任务</h2>
        <p>
          这个预览完全在浏览器计算，不调用 AI，也不保存输入。正式的 Token
          任务炼金炉会在后续里程碑读取受限的公开仓库摘要。
        </p>
      </div>

      <div class="preview-controls">
        <label for={tokenId}>
          可用 Token
          <output>{tokens.toLocaleString("zh-CN")}</output>
        </label>
        <input
          id={tokenId}
          type="range"
          min="2000"
          max="60000"
          step="1000"
          value={tokens}
          onInput={(event) =>
            setTokens(Number((event.currentTarget as HTMLInputElement).value))
          }
        />

        <label for={dayId}>
          距离过期
          <output>{days} 天</output>
        </label>
        <input
          id={dayId}
          type="range"
          min="1"
          max="30"
          value={days}
          onInput={(event) =>
            setDays(Number((event.currentTarget as HTMLInputElement).value))
          }
        />
      </div>

      <div class={`task-result task-result--${task.color}`} aria-live="polite">
        <span class="task-band">{task.label}</span>
        <div>
          <p>建议任务规模</p>
          <h3>{task.title}</h3>
          <span>{task.scope}</span>
        </div>
      </div>
    </section>
  );
}

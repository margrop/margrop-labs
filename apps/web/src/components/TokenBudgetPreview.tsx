import { useId, useMemo, useState } from "preact/hooks";
import { chooseTask } from "../lib/token-budget";

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

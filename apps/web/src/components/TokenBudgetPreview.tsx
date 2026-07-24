import { useId, useMemo, useState } from "preact/hooks";
import {
  buildTokenBudgetExport,
  calculateDailyBudget,
  chooseTask,
  explainTaskBand,
} from "../lib/token-budget";
import { EvidenceCard } from "./ui/EvidenceCard";
import { ExportActions } from "./ui/ExportActions";
import { FormField } from "./ui/FormField";
import { StatusNotice } from "./ui/StatusNotice";

const defaultTokens = 12_000;
const defaultDays = 7;

export default function TokenBudgetPreview() {
  const tokenId = useId();
  const dayId = useId();
  const [tokens, setTokens] = useState(defaultTokens);
  const [days, setDays] = useState(defaultDays);
  const task = useMemo(() => chooseTask(tokens, days), [tokens, days]);
  const dailyBudget = useMemo(
    () => calculateDailyBudget(tokens, days),
    [tokens, days],
  );
  const exportContent = useMemo(
    () => buildTokenBudgetExport(tokens, days),
    [tokens, days],
  );

  return (
    <section class="token-preview" aria-labelledby="token-preview-title">
      <div class="preview-copy">
        <p class="section-kicker">HELLO LAB · LOCAL ONLY</p>
        <h2 id="token-preview-title">先把一份闲置额度，变成一条任务</h2>
        <p>
          这个预览完全在浏览器计算，不调用 AI，也不保存输入。正式的 Token
          任务炼金炉会在后续里程碑读取受限的公开仓库摘要。
        </p>
        <StatusNotice tone="ready" title="本地计算已就绪">
          不调用 AI、不发送网络请求，也不保存输入。
        </StatusNotice>
      </div>

      <form
        class="preview-controls"
        onSubmit={(event) => event.preventDefault()}
        onReset={(event) => {
          event.preventDefault();
          setTokens(defaultTokens);
          setDays(defaultDays);
        }}
      >
        <fieldset>
          <legend>调整任务预算</legend>
          <FormField
            id={tokenId}
            label="可用 Token"
            value={tokens.toLocaleString("zh-CN")}
            hint="使用左右方向键微调，每次增加或减少 1,000。"
          >
            <input
              id={tokenId}
              type="range"
              min="2000"
              max="60000"
              step="1000"
              value={tokens}
              aria-describedby={`${tokenId}-hint`}
              onInput={(event) =>
                setTokens(
                  Number((event.currentTarget as HTMLInputElement).value),
                )
              }
            />
          </FormField>

          <FormField
            id={dayId}
            label="距离过期"
            value={`${days} 天`}
            hint="使用方向键选择 1–30 天，规则会即时重新计算。"
          >
            <input
              id={dayId}
              type="range"
              min="1"
              max="30"
              value={days}
              aria-describedby={`${dayId}-hint`}
              onInput={(event) =>
                setDays(Number((event.currentTarget as HTMLInputElement).value))
              }
            />
          </FormField>

          <button class="button button--secondary button--compact" type="reset">
            恢复示例值
          </button>
        </fieldset>
      </form>

      <div
        class={`task-result task-result--${task.color}`}
        role="status"
        aria-atomic="true"
      >
        <span class="task-band" aria-hidden="true">
          {task.label}
        </span>
        <div>
          <p>规则结果 · 建议规模 {task.label}</p>
          <h3>{task.title}</h3>
          <span>{task.scope}</span>
        </div>
      </div>

      <section class="evidence-section" aria-labelledby="evidence-heading">
        <div class="evidence-heading">
          <p class="section-kicker">VISIBLE EVIDENCE</p>
          <h3 id="evidence-heading">结论从哪里来</h3>
        </div>
        <div class="evidence-grid">
          <EvidenceCard
            kind="input"
            title="当前预算"
            value={`${tokens.toLocaleString("zh-CN")} Token · ${days} 天`}
          >
            这些数值只存在于当前页面内存中。
          </EvidenceCard>
          <EvidenceCard
            kind="rule"
            title="档位判定"
            value={`约 ${dailyBudget.toLocaleString("zh-CN")} Token / 天`}
          >
            {explainTaskBand(tokens, days)}
          </EvidenceCard>
          <EvidenceCard kind="ai" title="模型参与" value="未调用">
            当前建议完全由确定性规则生成。
          </EvidenceCard>
          <EvidenceCard kind="unknown" title="仓库上下文" value="尚未提供">
            正式 MVP 才会读取受限的公开仓库摘要。
          </EvidenceCard>
        </div>
      </section>

      <ExportActions
        content={exportContent}
        fileName="margrop-token-budget.md"
      />
    </section>
  );
}

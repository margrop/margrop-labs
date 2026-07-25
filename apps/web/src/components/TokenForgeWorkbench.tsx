import { useEffect, useState } from "preact/hooks";

import type {
  TokenForgeInput,
  TokenForgePlan,
} from "../lib/token-forge-contracts";
import {
  type TokenForgeExportBundle,
  buildTokenForgeExports,
} from "../lib/token-forge-exports";
import {
  type TokenForgeEventName,
  type TokenForgeFormValues,
  TokenForgeFormError,
  buildTokenForgeInputFromForm,
  classifyTokenForgeDevice,
  emitTokenForgeEvent,
  tokenForgeSyntheticFormValues,
} from "../lib/token-forge-page";
import { generateTokenForgeTemplatePlan } from "../lib/token-forge-templates";
import { EvidenceCard } from "./ui/EvidenceCard";
import { ExportActions } from "./ui/ExportActions";
import { FormField } from "./ui/FormField";
import { StatusNotice, type StatusTone } from "./ui/StatusNotice";

type TokenForgeWorkbenchProps = {
  articleUrl: string;
  sourceUrl: string;
};

type TokenForgeResult = {
  input: TokenForgeInput;
  plan: TokenForgePlan;
  exports: TokenForgeExportBundle;
};

type WorkbenchStatus = {
  tone: StatusTone;
  title: string;
  message: string;
};

const initialStatus: WorkbenchStatus = {
  tone: "info",
  title: "本地模式已就绪",
  message:
    "表单只在当前浏览器标签页中处理；生成计划不登录、不读取仓库，也不调用 AI。",
};

const freshSyntheticValues = (): TokenForgeFormValues => ({
  ...tokenForgeSyntheticFormValues,
});

const track = (eventName: TokenForgeEventName): void => {
  const width = typeof window === "undefined" ? undefined : window.innerWidth;
  emitTokenForgeEvent(eventName, classifyTokenForgeDevice(width));
};

export default function TokenForgeWorkbench({
  articleUrl,
  sourceUrl,
}: TokenForgeWorkbenchProps) {
  const [form, setForm] = useState<TokenForgeFormValues>(freshSyntheticValues);
  const [result, setResult] = useState<TokenForgeResult | null>(null);
  const [status, setStatus] = useState<WorkbenchStatus>(initialStatus);

  useEffect(() => {
    track("lab_open");
  }, []);

  const updateField = (
    field: keyof TokenForgeFormValues,
    value: string,
  ): void => {
    setForm((current) => ({ ...current, [field]: value }));
    setResult(null);
    setStatus(initialStatus);
  };

  const loadSyntheticExample = (): void => {
    setForm(freshSyntheticValues());
    setResult(null);
    setStatus({
      tone: "info",
      title: "合成样例已载入",
      message: "这些是公开的演示值；你可以直接生成，也可以继续修改。",
    });
  };

  const generatePlan = (event: SubmitEvent): void => {
    event.preventDefault();

    try {
      const input = buildTokenForgeInputFromForm(form);
      const plan = generateTokenForgeTemplatePlan(input);
      const exports = buildTokenForgeExports(input, plan);

      setResult({ input, plan, exports });
      setStatus({
        tone: "ready",
        title: "模板计划已生成",
        message:
          "计划已通过输入、预算、工时和导出合同校验；没有发生网络请求或 AI 调用。",
      });
      track("run_success");
    } catch (error) {
      setResult(null);
      setStatus({
        tone: "error",
        title: "无法生成计划",
        message:
          error instanceof TokenForgeFormError
            ? error.message
            : "本地合同校验没有通过，请检查字段后重试。",
      });
      track("run_failure");
    }
  };

  const totalTokens =
    result?.plan.tasks.reduce(
      (total, task) => total + task.estimated_tokens,
      0,
    ) ?? 0;
  const totalHours =
    result?.plan.tasks.reduce(
      (total, task) => total + task.estimated_hours,
      0,
    ) ?? 0;

  return (
    <div class="token-forge-shell">
      <form class="token-forge-form" onSubmit={generatePlan}>
        <div class="token-forge-form-heading">
          <div>
            <p class="section-kicker">LOCAL TEMPLATE ENGINE</p>
            <h2>定义这次 Token 冲刺</h2>
          </div>
          <span>v1.0 · Template</span>
        </div>

        <div class="token-forge-field-grid">
          <FormField
            id="token-budget"
            label="可用 Token"
            value={`${form.token_budget || "—"} Token`}
            hint="2,000–60,000 的整数；用于限定所有任务的预计总额。"
          >
            <input
              id="token-budget"
              name="token_budget"
              type="number"
              min="2000"
              max="60000"
              step="1000"
              inputMode="numeric"
              value={form.token_budget}
              aria-describedby="token-budget-hint"
              onInput={(event) =>
                updateField("token_budget", event.currentTarget.value)
              }
            />
          </FormField>

          <FormField
            id="expires-in-days"
            label="几天内使用"
            value={`${form.expires_in_days || "—"} 天`}
            hint="1–30 天的整数；帮助模板控制任务数量与依赖。"
          >
            <input
              id="expires-in-days"
              name="expires_in_days"
              type="number"
              min="1"
              max="30"
              step="1"
              inputMode="numeric"
              value={form.expires_in_days}
              aria-describedby="expires-in-days-hint"
              onInput={(event) =>
                updateField("expires_in_days", event.currentTarget.value)
              }
            />
          </FormField>

          <FormField
            id="available-hours"
            label="可投入时间"
            value={`${form.available_hours || "—"} 小时`}
            hint="1–80 小时，以 0.5 小时为步长；计划不会超过这个上限。"
          >
            <input
              id="available-hours"
              name="available_hours"
              type="number"
              min="1"
              max="80"
              step="0.5"
              inputMode="decimal"
              value={form.available_hours}
              aria-describedby="available-hours-hint"
              onInput={(event) =>
                updateField("available_hours", event.currentTarget.value)
              }
            />
          </FormField>

          <FormField
            id="tech-stack"
            label="技术栈"
            value="1–8 项"
            hint="用逗号或换行分隔；这里只用于生成通用任务边界。"
          >
            <input
              id="tech-stack"
              name="tech_stack"
              type="text"
              maxLength={640}
              autoComplete="off"
              value={form.tech_stack}
              aria-describedby="tech-stack-hint"
              onInput={(event) =>
                updateField("tech_stack", event.currentTarget.value)
              }
            />
          </FormField>
        </div>

        <FormField
          id="token-goal"
          label="想完成的目标"
          value={`${form.goal.length}/500`}
          hint="请描述可公开的目标；不要粘贴 Token、Cookie、Authorization 或私有仓库内容。"
        >
          <textarea
            id="token-goal"
            name="goal"
            rows={5}
            minLength={10}
            maxLength={500}
            value={form.goal}
            aria-describedby="token-goal-hint"
            onInput={(event) => updateField("goal", event.currentTarget.value)}
          />
        </FormField>

        <div class="token-forge-actions">
          <button class="button button--primary" type="submit">
            生成任务计划
          </button>
          <button
            class="button button--secondary"
            type="button"
            onClick={loadSyntheticExample}
          >
            载入合成样例
          </button>
        </div>

        <div class="token-forge-privacy">
          <strong>本页不保存表单。</strong>
          <span>无需登录 · 不读取仓库 · 不调用 AI · 不上传目标正文</span>
        </div>
      </form>

      <StatusNotice tone={status.tone} title={status.title}>
        <p>{status.message}</p>
      </StatusNotice>

      {result ? (
        <section
          class="token-forge-result"
          aria-labelledby="forge-result-title"
        >
          <div class="token-forge-result-heading">
            <div>
              <p class="section-kicker">VALIDATED PLAN</p>
              <h2 id="forge-result-title">可执行的模板任务</h2>
            </div>
            <p>
              {result.plan.tasks.length} 项任务 · {totalTokens.toLocaleString()}
              {" Token · "}
              {totalHours} 小时
            </p>
          </div>

          <div class="token-forge-tasks">
            {result.plan.tasks.map((task) => (
              <article class="token-forge-task" key={task.id}>
                <div class="token-forge-task-meta">
                  <span>{task.size}</span>
                  <code>{task.id}</code>
                </div>
                <h3>{task.title}</h3>
                <p>
                  {task.estimated_tokens.toLocaleString()} Token ·{" "}
                  {task.estimated_hours} 小时
                </p>
                <div class="token-forge-task-columns">
                  <div>
                    <h4>包含范围</h4>
                    <ul>
                      {task.scope.included.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>验收标准</h4>
                    <ul>
                      {task.acceptance_criteria.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div class="evidence-grid token-forge-evidence">
            <EvidenceCard
              kind="input"
              title="预算边界"
              value={`${result.input.token_budget.toLocaleString()} Token / ${result.input.available_hours} 小时`}
            >
              <p>
                计划使用 {totalTokens.toLocaleString()} Token 和 {totalHours}
                小时，未超过用户设定的上限。
              </p>
            </EvidenceCard>
            <EvidenceCard
              kind="rule"
              title="生成路径"
              value="template · deterministic"
            >
              <p>使用 P1-002 固定模板，并重新通过 Token Forge v1 合同。</p>
            </EvidenceCard>
            <EvidenceCard kind="ai" title="模型调用" value="未调用">
              <p>当前正式页面不需要 API Key，也不会把表单交给模型。</p>
            </EvidenceCard>
            <EvidenceCard
              kind="unknown"
              title="执行前确认"
              value={`${result.plan.unknowns.length} 项`}
            >
              <p>
                {result.plan.unknowns[0] ??
                  "没有额外未知项；执行前仍建议人工确认范围。"}
              </p>
            </EvidenceCard>
          </div>

          <div class="token-forge-export-grid">
            <section>
              <h3>完整计划</h3>
              <p>适合保存到仓库、笔记或交给 Coding Agent。</p>
              <ExportActions
                content={result.exports.markdown.content}
                fileName={result.exports.markdown.file_name}
                label="计划 Markdown"
                onExport={() => track("export")}
              />
            </section>
            <section>
              <h3>GitHub Issue 草稿</h3>
              <p>按任务拆分标题与正文；下载后由你人工确认和提交。</p>
              <ExportActions
                content={result.exports.github_issues.content}
                fileName={result.exports.github_issues.file_name}
                label="Issue 草稿"
                onExport={() => track("export")}
              />
            </section>
          </div>

          <div class="token-forge-next-links">
            <a
              class="button button--secondary"
              href={articleUrl}
              onClick={() => track("blog_click")}
            >
              阅读设计思路
            </a>
            <a
              class="button button--secondary"
              href={sourceUrl}
              onClick={() => track("github_click")}
            >
              查看 GitHub 源码
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}

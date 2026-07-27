import { useEffect, useRef, useState } from "preact/hooks";

import {
  type TokenForgeEventName,
  type TokenForgeFormValues,
  TokenForgeFormError,
  classifyTokenForgeDevice,
  emitTokenForgeEvent,
  tokenForgeSyntheticFormValues,
} from "../lib/token-forge-page";
import {
  type TokenForgeFirstUseSampleId,
  getTokenForgeFirstUseSampleForm,
  tokenForgeFirstUseSamples,
  tokenForgeFirstUseSteps,
} from "../lib/token-forge-first-use";
import {
  type TokenForgeEditorSession,
  createTokenForgeEditorSession,
} from "../lib/token-forge-editor";
import {
  type TokenForgeRepositoryPageResult,
  generateTokenForgeRepositoryPageResult,
  rebuildTokenForgeEditedPageResult,
} from "../lib/token-forge-repository-page";
import { requestTokenForgeAiPlan } from "../lib/token-forge-ai-client";
import { TokenForgePlanEditor } from "./TokenForgePlanEditor";
import { EvidenceCard } from "./ui/EvidenceCard";
import { ExportActions } from "./ui/ExportActions";
import { FormField } from "./ui/FormField";
import { StatusNotice, type StatusTone } from "./ui/StatusNotice";

type TokenForgeWorkbenchProps = {
  articleUrl: string;
  sourceUrl: string;
};

type WorkbenchStatus = {
  tone: StatusTone;
  title: string;
  message: string;
};

const initialStatus: WorkbenchStatus = {
  tone: "info",
  title: "双路径已就绪",
  message:
    "可显式选择 AI 增强，或始终使用本地模板；任何 AI、网络或合同失败都保留可导出的模板计划。",
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
  const [result, setResult] = useState<TokenForgeRepositoryPageResult | null>(
    null,
  );
  const [baselineResult, setBaselineResult] =
    useState<TokenForgeRepositoryPageResult | null>(null);
  const [editorSession, setEditorSession] =
    useState<TokenForgeEditorSession | null>(null);
  const [status, setStatus] = useState<WorkbenchStatus>(initialStatus);
  const [isLoading, setIsLoading] = useState(false);
  const runVersion = useRef(0);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusResult = useRef(false);

  useEffect(() => {
    track("lab_open");
  }, []);

  useEffect(() => {
    if (!result || !shouldFocusResult.current) {
      return;
    }

    shouldFocusResult.current = false;
    window.requestAnimationFrame(() => {
      resultHeadingRef.current?.focus({ preventScroll: true });
      resultHeadingRef.current?.scrollIntoView({ block: "start" });
    });
  }, [result]);

  const updateField = (
    field: keyof TokenForgeFormValues,
    value: string,
  ): void => {
    runVersion.current += 1;
    shouldFocusResult.current = false;
    setForm((current) => ({ ...current, [field]: value }));
    setResult(null);
    setBaselineResult(null);
    setEditorSession(null);
    setIsLoading(false);
    setStatus(initialStatus);
  };

  const generatePlan = async (
    useAi: boolean,
    candidateForm: TokenForgeFormValues = form,
  ): Promise<void> => {
    const currentRun = runVersion.current + 1;
    runVersion.current = currentRun;
    const repositoryRequested = candidateForm.repository_url.trim().length > 0;

    shouldFocusResult.current = false;
    setResult(null);
    setBaselineResult(null);
    setEditorSession(null);
    setIsLoading(true);
    setStatus(
      useAi
        ? {
            tone: "info",
            title: repositoryRequested
              ? "正在准备公开摘要并请求 AI 增强"
              : "正在请求 AI 增强",
            message:
              "只发送版本化目标、约束和脱敏后的有界公开片段；主模型失败时可顺序调用固定回退模型，45 秒后自动降级。",
          }
        : {
            tone: "info",
            title: repositoryRequested
              ? "正在读取公开仓库摘要"
              : "正在验证本地模板",
            message: repositoryRequested
              ? "只向固定 GitHub API 发出受限 GET 请求；不会调用 AI。"
              : "仓库地址为空，不会发生网络请求或 AI 调用。",
          },
    );

    try {
      const nextResult = await generateTokenForgeRepositoryPageResult(
        candidateForm,
        {
          ...(useAi ? { enhancePlan: requestTokenForgeAiPlan } : {}),
        },
      );

      if (runVersion.current !== currentRun) {
        return;
      }

      const nextEditorSession = createTokenForgeEditorSession(
        nextResult.input,
        nextResult.plan,
      );
      shouldFocusResult.current = true;
      setResult(nextResult);
      setBaselineResult(nextResult);
      setEditorSession(nextEditorSession);
      if (nextResult.quality.status === "review") {
        setStatus({
          tone: "warning",
          title: `计划已生成，${nextResult.quality.review_task_count} 项需人工修改`,
          message:
            "计划已通过 Schema、依赖和总预算合同，但确定性质量规则发现空泛、难验收或预算过度集中的任务；请展开对应任务查看规则依据。",
        });
      } else if (nextResult.ai.status === "ai-assisted") {
        setStatus({
          tone: "ready",
          title: "AI 增强计划已通过确定性校验",
          message:
            "模型结果已重新通过任务 Schema、依赖、预算、工时、脱敏和生产写入边界；导出已按最终计划重建。",
        });
      } else if (nextResult.ai.status === "template-fallback") {
        setStatus({
          tone: "warning",
          title: "AI 已安全降级，模板计划可用",
          message:
            "模型、限流、超时或输出校验没有完成增强；本地模板与三种导出仍已通过验证。",
        });
      } else if (nextResult.repository.status === "fallback") {
        setStatus({
          tone: "warning",
          title: "仓库摘要已降级，模板计划可用",
          message: `${nextResult.repository.message} 本地计划与三种导出仍已通过验证。`,
        });
      } else if (nextResult.repository.status === "summarized") {
        setStatus({
          tone: "ready",
          title: "模板计划与仓库证据已就绪（未调用 AI）",
          message:
            "受限公开仓库摘要已完成；当前选择只生成模板，仓库正文没有改写模板任务。",
        });
      } else {
        setStatus({
          tone: "ready",
          title: "本地模板计划已生成",
          message:
            "计划已通过输入、预算、工时和导出合同校验；没有发生网络请求或 AI 调用。",
        });
      }
      track("run_success");
    } catch (error) {
      if (runVersion.current !== currentRun) {
        return;
      }

      setResult(null);
      setBaselineResult(null);
      setEditorSession(null);
      shouldFocusResult.current = false;
      setStatus({
        tone: "error",
        title: "无法生成计划",
        message:
          error instanceof TokenForgeFormError
            ? error.message
            : "本地合同校验没有通过，请检查字段后重试。",
      });
      track("run_failure");
    } finally {
      if (runVersion.current === currentRun) {
        setIsLoading(false);
      }
    }
  };

  const runFirstUseSample = (id: TokenForgeFirstUseSampleId): void => {
    const sampleForm = getTokenForgeFirstUseSampleForm(id);
    setForm(sampleForm);
    void generatePlan(false, sampleForm);
  };

  const focusFirstField = (): void => {
    firstFieldRef.current?.focus();
    firstFieldRef.current?.scrollIntoView({ block: "center" });
  };

  const handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void generatePlan(true);
  };

  const applyEditorSession = (
    nextSession: TokenForgeEditorSession,
    notice: {
      title: string;
      message: string;
      ordering_mode?: "quality" | "manual";
    },
  ): void => {
    if (!result) {
      return;
    }

    try {
      const rebuilt = rebuildTokenForgeEditedPageResult(
        result,
        nextSession,
        notice.ordering_mode,
      );
      setResult(rebuilt);
      setEditorSession(nextSession);
      setForm((current) => ({
        ...current,
        token_budget: String(nextSession.input.token_budget),
        available_hours: String(nextSession.input.available_hours),
      }));
      setStatus({
        tone: rebuilt.quality.status === "review" ? "warning" : "ready",
        title: notice.title,
        message: `${notice.message} 当前计划规则评分 ${rebuilt.quality.score}/100。`,
      });
    } catch {
      setStatus({
        tone: "error",
        title: "本地修改未应用",
        message: "修改没有通过最终合同或导出验证，上一版计划保持不变。",
      });
    }
  };

  const restoreGeneratedResult = (): void => {
    if (!baselineResult) {
      return;
    }

    setResult(baselineResult);
    setEditorSession(
      createTokenForgeEditorSession(baselineResult.input, baselineResult.plan),
    );
    setForm((current) => ({
      ...current,
      token_budget: String(baselineResult.input.token_budget),
      available_hours: String(baselineResult.input.available_hours),
    }));
    setStatus({
      tone: baselineResult.quality.status === "review" ? "warning" : "ready",
      title: "已恢复生成结果",
      message:
        "本地编辑、锁定和手动顺序已清除；原始生成计划、评分与导出已经恢复。",
    });
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
  const qualityByTaskId = new Map(
    result?.quality.tasks.map((task) => [task.task_id, task]) ?? [],
  );

  return (
    <div class="token-forge-shell">
      <section
        id="token-forge-samples"
        class="token-forge-onboarding"
        aria-labelledby="token-forge-onboarding-title"
      >
        <div class="token-forge-onboarding-heading">
          <div>
            <p class="section-kicker">FIRST RUN · NO LOGIN · NO AI REQUIRED</p>
            <h2 id="token-forge-onboarding-title">三步完成首次体验</h2>
          </div>
          <p>推荐从 6K 完全本地样例开始，通常一分钟内就能看到三种导出。</p>
        </div>

        <ol class="token-forge-journey" aria-label="三步首次体验">
          {tokenForgeFirstUseSteps.map((step) => {
            const state =
              step.id === "choose"
                ? result || isLoading
                  ? "completed"
                  : "current"
                : step.id === "generate"
                  ? result
                    ? "completed"
                    : isLoading
                      ? "current"
                      : "upcoming"
                  : result
                    ? "current"
                    : "upcoming";

            return (
              <li key={step.id} data-state={state}>
                <span>{step.order}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div class="token-forge-sample-grid">
          {tokenForgeFirstUseSamples.map((sample) => (
            <article key={sample.id} class="token-forge-sample">
              <div class="token-forge-sample-meta">
                <span>{sample.label}</span>
                {sample.recommended ? <strong>推荐首次体验</strong> : null}
              </div>
              <h3>{sample.title}</h3>
              <p id={`token-forge-sample-${sample.id}`}>{sample.description}</p>
              <dl>
                <div>
                  <dt>产出</dt>
                  <dd>{sample.outcome}</dd>
                </div>
                <div>
                  <dt>仓库</dt>
                  <dd>
                    {sample.repository_mode === "public-read-only"
                      ? "公开只读 · 失败可降级"
                      : "不读取 · 完全本地"}
                  </dd>
                </div>
              </dl>
              <button
                class={
                  sample.recommended
                    ? "button button--primary"
                    : "button button--secondary"
                }
                type="button"
                disabled={isLoading}
                aria-controls="forge-result"
                aria-describedby={`token-forge-sample-${sample.id}`}
                onClick={() => runFirstUseSample(sample.id)}
              >
                用此样例生成模板
              </button>
            </article>
          ))}
        </div>

        <p class="token-forge-onboarding-note">
          三个样例都无需登录和 AI；只有 24K
          样例会读取有上限的公开仓库摘要，读取失败也能继续导出本地模板。
        </p>
      </section>

      <form
        id="token-forge-input"
        class="token-forge-form"
        onSubmit={handleSubmit}
        aria-busy={isLoading}
      >
        <div class="token-forge-form-heading">
          <div>
            <p class="section-kicker">AI-ASSISTED · TEMPLATE-SAFE</p>
            <h2>定义这次 Token 冲刺</h2>
          </div>
          <span>v1.0 · AI 可选</span>
        </div>

        <div class="token-forge-field-grid">
          <FormField
            id="token-budget"
            label="可用 Token"
            value={`${form.token_budget || "—"} Token`}
            hint="2,000–60,000 的整数；用于限定所有任务的预计总额。"
          >
            <input
              ref={firstFieldRef}
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
          id="repository-url"
          label="公开 GitHub 仓库（可选）"
          value={
            form.repository_url.trim().length > 0
              ? "将读取受限公开样本"
              : "留空即完全本地"
          }
          hint="只接受 https://github.com/owner/repository；不支持私有仓库，不要提供 Token。"
        >
          <input
            id="repository-url"
            name="repository_url"
            type="text"
            inputMode="url"
            maxLength={200}
            autoComplete="off"
            spellcheck={false}
            placeholder="https://github.com/owner/repository"
            value={form.repository_url}
            aria-describedby="repository-url-hint"
            onInput={(event) =>
              updateField("repository_url", event.currentTarget.value)
            }
          />
        </FormField>

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
          <button
            class="button button--primary"
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? "正在生成…" : "AI 增强生成"}
          </button>
          <button
            class="button button--secondary"
            type="button"
            disabled={isLoading}
            onClick={() => void generatePlan(false)}
          >
            仅生成模板
          </button>
        </div>

        <div class="token-forge-privacy">
          <strong>本页不保存表单。</strong>
          <span>
            {
              "无需登录 · 仓库可选且仅限公开只读 · 不发送 GitHub Token · 浏览器不含 API Key"
            }
          </span>
          <span>
            {
              "仅点击“AI 增强生成”时，目标、约束与脱敏后的有界公开片段会发送给服务端模型；不保存、不写日志。"
            }
          </span>
        </div>
      </form>

      <StatusNotice tone={status.tone} title={status.title}>
        <p>{status.message}</p>
      </StatusNotice>

      {result ? (
        <section
          id="forge-result"
          class="token-forge-result"
          aria-labelledby="forge-result-title"
        >
          <div class="token-forge-result-heading">
            <div>
              <p class="section-kicker">
                {editorSession && editorSession.revision > 0
                  ? "USER-EDITED · REVALIDATED PLAN"
                  : "VALIDATED · RULE-SCORED PLAN"}
              </p>
              <h2 id="forge-result-title" ref={resultHeadingRef} tabIndex={-1}>
                {result.ai.status === "ai-assisted"
                  ? "可执行的 AI 增强任务"
                  : "可执行的模板任务"}
              </h2>
            </div>
            <p>
              {result.plan.tasks.length} 项任务 · {totalTokens.toLocaleString()}
              {" Token · "}
              {totalHours} 小时
            </p>
          </div>

          <nav class="token-forge-result-nav" aria-label="计划结果快速导航">
            <a href="#forge-tasks">任务计划</a>
            <a href="#forge-editing">本地编辑</a>
            <a href="#forge-evidence">规则证据</a>
            <a href="#forge-exports">复制或下载</a>
          </nav>

          <section
            id="forge-tasks"
            class="token-forge-result-section"
            aria-labelledby="forge-tasks-title"
          >
            <div class="token-forge-section-heading">
              <p class="section-kicker">STEP 2 · REVIEW</p>
              <h3 id="forge-tasks-title">任务计划</h3>
            </div>
            <div class="token-forge-tasks">
              {result.plan.tasks.map((task) => {
                const quality = qualityByTaskId.get(task.id);

                return (
                  <article class="token-forge-task" key={task.id}>
                    <div class="token-forge-task-meta">
                      <div class="token-forge-task-badges">
                        <span class="token-forge-task-size">{task.size}</span>
                        {quality ? (
                          <span
                            class={`token-forge-quality-badge token-forge-quality-badge--${quality.status}`}
                          >
                            规则评分 {quality.score}/100 ·{" "}
                            {quality.status === "ready"
                              ? "可执行"
                              : "需人工修改"}
                          </span>
                        ) : null}
                      </div>
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
                    {quality ? (
                      <details class="token-forge-task-quality">
                        <summary>查看评分与排序依据</summary>
                        <ul>
                          {quality.rules.map((item) => (
                            <li key={item.rule_id} data-status={item.status}>
                              <code>{item.rule_id}</code>
                              <strong>
                                {item.status === "pass" ? "通过" : "需改"} ·{" "}
                                {item.points}/{item.max_points}
                              </strong>
                              <span>{item.message}</span>
                            </li>
                          ))}
                        </ul>
                        <p>
                          <code>{quality.order.rule_id}</code>{" "}
                          {quality.order.message}
                        </p>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          {editorSession ? (
            <section
              id="forge-editing"
              class="token-forge-result-section"
              aria-label="本地编辑"
            >
              <TokenForgePlanEditor
                session={editorSession}
                onSessionChange={applyEditorSession}
                onRestore={restoreGeneratedResult}
                onError={(message) =>
                  setStatus({
                    tone: "warning",
                    title: "本地修改未应用",
                    message,
                  })
                }
              />
            </section>
          ) : null}

          <section
            id="forge-evidence"
            class="token-forge-result-section"
            aria-labelledby="forge-evidence-title"
          >
            <div class="token-forge-section-heading">
              <p class="section-kicker">EVIDENCE · DETERMINISTIC</p>
              <h3 id="forge-evidence-title">规则证据与降级说明</h3>
            </div>
            <div class="evidence-grid token-forge-evidence">
              <EvidenceCard
                kind={result.quality.status === "ready" ? "rule" : "unknown"}
                title="确定性规则质量"
                value={`${result.quality.score}/100 · ${
                  result.quality.review_task_count === 0
                    ? "全部可执行"
                    : `${result.quality.review_task_count} 项需人工修改`
                }`}
              >
                <p>
                  评分只使用标题、范围、验收、Prompt、预算和依赖六类规则；低于
                  80 分或同时独占超过 70% Token
                  与工时的任务会明确标记，不会被隐藏。
                </p>
                <p>
                  <code>{result.quality.evidence.rule_id}</code>{" "}
                  {result.quality.evidence.message}
                </p>
              </EvidenceCard>
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
                value={
                  result.ai.status === "ai-assisted"
                    ? "ai-assisted · revalidated"
                    : "template · deterministic"
                }
              >
                <p>
                  {result.ai.status === "ai-assisted"
                    ? "AI 只负责候选计划；最终结果由本地规则重新验证和安全后处理。"
                    : "使用 P1-002 固定模板，并重新通过 Token Forge v1 合同。"}
                </p>
              </EvidenceCard>
              <EvidenceCard
                kind={
                  result.repository.status === "fallback" ? "unknown" : "input"
                }
                title="公开仓库覆盖"
                value={
                  result.repository.status === "summarized"
                    ? `${result.repository.coverage.read_files} 读取 · ${result.repository.coverage.ignored_files} 忽略 · ${result.repository.coverage.truncated_sections} 截断 · ${result.repository.unknowns.length} 未知`
                    : result.repository.status === "fallback"
                      ? "已降级到模板"
                      : "未提供 · 未读取"
                }
              >
                {result.repository.status === "summarized" ? (
                  <>
                    <ul
                      class="token-forge-coverage"
                      aria-label="公开仓库摘要覆盖计数"
                    >
                      <li>
                        <strong>
                          {result.repository.coverage.tree_entries_seen}
                        </strong>
                        <span>检查目录项</span>
                      </li>
                      <li>
                        <strong>{result.repository.coverage.read_files}</strong>
                        <span>读取文件</span>
                      </li>
                      <li>
                        <strong>
                          {result.repository.coverage.ignored_files}
                        </strong>
                        <span>忽略文件</span>
                      </li>
                      <li>
                        <strong>
                          {result.repository.coverage.truncated_sections}
                        </strong>
                        <span>截断标记</span>
                      </li>
                    </ul>
                    <p>
                      技术信号：
                      {result.repository.tech_signals.join("、") || "未识别"}。
                      读取上限 {result.repository.limits.max_files} 个文件 /{" "}
                      {Math.round(
                        result.repository.limits.max_total_bytes / 1024,
                      )}{" "}
                      KiB。
                    </p>
                    <p>
                      跳过明细：疑似秘密{" "}
                      {result.repository.coverage.skipped_secret}
                      ，二进制或生成文件{" "}
                      {result.repository.coverage.skipped_binary_or_generated}
                      ，过大 {result.repository.coverage.skipped_too_large}
                      ，读取失败{" "}
                      {result.repository.coverage.skipped_fetch_errors}
                      ，采样上限{" "}
                      {result.repository.coverage.skipped_by_sampling_limit}。
                    </p>
                    <ul class="token-forge-unknowns">
                      {result.repository.unknowns.map((unknown) => (
                        <li key={unknown}>{unknown}</li>
                      ))}
                    </ul>
                  </>
                ) : result.repository.status === "fallback" ? (
                  <p>
                    {result.repository.message}
                    仓库内容没有进入结果，模板计划与导出保持可用。
                  </p>
                ) : (
                  <p>仓库地址留空，本次只依据表单生成模板，没有网络请求。</p>
                )}
              </EvidenceCard>
              <EvidenceCard
                kind="ai"
                title="模型调用"
                value={
                  result.ai.status === "ai-assisted"
                    ? `${result.ai.gateway.usage.total_tokens.toLocaleString()} Token（Provider 报告）· ${result.ai.gateway.attempt_count} 次`
                    : result.ai.status === "template-fallback"
                      ? `已降级 · ${result.ai.gateway.attempt_count} 次`
                      : "未调用"
                }
              >
                <p>
                  {result.ai.status === "ai-assisted"
                    ? "服务端固定模型已返回有效结构；Provider 报告用量仅供观察，不用于本地额度结算。API Key、模型配置和原始 Provider 错误均未进入浏览器。"
                    : result.ai.status === "template-fallback"
                      ? "AI 增强未通过完整边界，页面没有采用模型候选结果。"
                      : "你选择了本地模板路径，没有把目标或仓库摘要发送给模型。"}
                </p>
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
          </section>

          <section
            id="forge-exports"
            class="token-forge-result-section"
            aria-labelledby="forge-exports-title"
          >
            <div class="token-forge-section-heading">
              <p class="section-kicker">STEP 3 · EXPORT</p>
              <h3 id="forge-exports-title">复制或下载</h3>
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
              <section>
                <h3>Coding Agent 执行包</h3>
                <p>按依赖分阶段执行、验收和交接，不绑定具体模型或工具。</p>
                <ExportActions
                  content={result.agent_package.artifact.content}
                  fileName={result.agent_package.artifact.file_name}
                  label="Agent 执行包"
                  onExport={() => track("export")}
                />
              </section>
            </div>
          </section>

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
      ) : (
        <section
          id="forge-result"
          class={`token-forge-empty token-forge-empty--${
            status.tone === "error" ? "error" : isLoading ? "loading" : "idle"
          }`}
          aria-labelledby="forge-empty-title"
        >
          <p class="section-kicker">
            {status.tone === "error"
              ? "RECOVER · KEEP CONTROL"
              : isLoading
                ? "STEP 2 · GENERATING"
                : "STEP 2 · READY WHEN YOU ARE"}
          </p>
          <h2 id="forge-empty-title">
            {status.tone === "error"
              ? "这次没有生成结果"
              : isLoading
                ? "正在生成第一份计划"
                : "还没有计划结果"}
          </h2>
          <p>
            {status.tone === "error"
              ? "原表单仍在当前标签页。你可以回到输入修改，或使用完全本地的 6K 样例重新开始。"
              : isLoading
                ? "请保留当前标签页；公开仓库或 AI 失败时会自动返回可导出的模板。"
                : "选择上方任一档样例可一键生成模板，也可以修改表单后选择本地模板或 AI 增强。"}
          </p>
          <div class="token-forge-empty-actions">
            {status.tone === "error" ? (
              <button
                class="button button--primary"
                type="button"
                disabled={isLoading}
                onClick={() => runFirstUseSample("quick-local")}
              >
                恢复 6K 安全样例
              </button>
            ) : (
              <a class="button button--primary" href="#token-forge-samples">
                选择三档样例
              </a>
            )}
            <button
              class="button button--secondary"
              type="button"
              disabled={isLoading}
              onClick={focusFirstField}
            >
              回到输入修改
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

import { useMemo, useState } from "preact/hooks";

import type { InterviewBoundaryProjection } from "../lib/interview-contracts";
import type {
  InterviewRecord,
  InterviewRecordResponseStatus,
  InterviewRecordUnknownReason,
} from "../lib/interview-recording";
import type { InterviewConclusion } from "../lib/interview-recording";
import {
  type InterviewSyntheticLoopRun,
  type InterviewSyntheticRole,
  type InterviewSyntheticStage,
  buildInterviewSafeExport,
  renderInterviewSafeExportMarkdown,
} from "../lib/interview-synthetic";
import { buildInterviewConclusion } from "../lib/interview-recording";
import { validateInterviewRecord } from "../lib/interview-recording";
import { ExportActions } from "./ui/ExportActions";
import { StatusNotice, type StatusTone } from "./ui/StatusNotice";

type InterviewWorkbenchProps = {
  initialRun: InterviewSyntheticLoopRun;
  aiBoundary: InterviewBoundaryProjection;
  articleUrl?: string;
  sourceUrl: string;
};

type InterviewStep = 1 | 2 | 3;
type AiAction = "match" | "plan" | "conclusion";

type WorkbenchStatus = {
  tone: StatusTone;
  title: string;
  message: string;
};

type AiNotice = {
  state: "idle" | "loading" | "ready" | "error";
  title: string;
  message: string;
};

const safeguards = {
  unknown_is_not_negative: true,
  protected_attribute_inference: false,
  automatic_decision: false,
} as const;

const operationByAction: Record<
  AiAction,
  { endpoint: string; operation: string; label: string }
> = {
  match: {
    endpoint: "/api/interview-workbench/match",
    operation: "interview-workbench.match-v1",
    label: "AI 匹配复核",
  },
  plan: {
    endpoint: "/api/interview-workbench/plan",
    operation: "interview-workbench.plan-v1",
    label: "AI 计划建议",
  },
  conclusion: {
    endpoint: "/api/interview-workbench/conclusion",
    operation: "interview-workbench.conclusion-v1",
    label: "AI 结论草稿",
  },
};

const roleLabels: Record<InterviewSyntheticRole, string> = {
  interviewer: "面试官",
  candidate: "面试者",
};

const stepLabels: Record<InterviewStep, { title: string; short: string }> = {
  1: { title: "岗位匹配", short: "匹配" },
  2: { title: "面试计划", short: "计划" },
  3: { title: "记录与结论", short: "记录" },
};

const matchStatusLabels: Record<string, string> = {
  direct: "明确支持",
  partial: "部分支持",
  conflict: "存在冲突",
  unknown: "暂无证据",
  not_applicable: "不适用",
};

const matchBandLabels: Record<string, string> = {
  strong_match: "强匹配信号",
  partial_match: "部分匹配信号",
  insufficient_evidence: "证据不足",
  conflicted: "存在冲突",
};

const responseStatusLabels: Record<InterviewRecordResponseStatus, string> = {
  answered: "已回答",
  partially_answered: "部分回答",
  not_asked: "未提问",
  declined: "拒绝回答",
  unknown: "未知",
};

const unknownReasonLabels: Record<InterviewRecordUnknownReason, string> = {
  not_asked: "尚未提问",
  no_answer: "没有得到回答",
  not_verified: "尚未核验",
  not_applicable: "不适用",
};

const initialStatus: WorkbenchStatus = {
  tone: "info",
  title: "合成样例已就绪",
  message:
    "三步流程完全在当前标签页运行。可以先切换角色、查看匹配和计划，再编辑一条本地记录；不会上传样例原文。",
};

const initialAiNotice = (): AiNotice => ({
  state: "idle",
  title: "AI 可选",
  message: "当前结果由确定性内核生成；需要时可以显式请求一次受限 AI 复核。",
});

const makeRequestInput = (
  action: AiAction,
  run: InterviewSyntheticLoopRun,
  role: InterviewSyntheticRole,
  boundary: InterviewBoundaryProjection,
): Record<string, unknown> => {
  const stage = run.roles[role];
  if (action === "match") {
    return {
      schema_version: "1.0",
      boundary,
      safeguards,
    };
  }
  if (action === "plan") {
    return {
      schema_version: "1.0",
      boundary,
      match: run.match,
      mode: stage.plan.mode,
      duration_minutes: stage.plan.duration_minutes,
      early_gate_requirement_ids: [...stage.plan.early_gate.requirement_ids],
      safeguards,
    };
  }
  return {
    schema_version: "1.0",
    plan_projection: {
      plan_id: stage.plan.plan_id,
      mode: stage.plan.mode,
      duration_minutes: stage.plan.duration_minutes,
      questions: stage.plan.questions.map(
        ({ question_id, requirement_ids }) => ({
          question_id,
          requirement_ids: [...requirement_ids],
        }),
      ),
    },
    record_projection: {
      record_id: stage.record.record_id,
      plan_id: stage.record.plan_id,
      mode: stage.record.mode,
      duration_minutes: stage.record.duration_minutes,
      status: stage.record.status,
      entries: stage.record.entries.map((entry) => ({
        entry_id: entry.entry_id,
        question_id: entry.question_id,
        requirement_ids: [...entry.requirement_ids],
        response_status: entry.response_status,
        fact_ids: entry.facts.map(({ fact_id }) => fact_id),
        counterevidence_ids: entry.counterevidence.map(
          ({ counterevidence_id }) => counterevidence_id,
        ),
        unknown_reason: entry.unknown_reason,
      })),
    },
    safeguards,
  };
};

const summarizeAiResult = (action: AiAction, result: unknown): string => {
  if (typeof result !== "object" || result === null) {
    throw new Error("invalid-result");
  }
  const value = result as Record<string, unknown>;
  if (action === "match") {
    const overall = value.overall;
    if (typeof overall !== "object" || overall === null) {
      throw new Error("invalid-match-result");
    }
    const data = overall as Record<string, unknown>;
    if (typeof data.match_band !== "string") {
      throw new Error("invalid-match-band");
    }
    return `AI 返回“${matchBandLabels[data.match_band] ?? "结构化匹配信号"}”；规则结果仍作为当前页面主结果。`;
  }
  if (action === "plan") {
    const questions = value.questions;
    const duration = value.duration_minutes;
    if (!Array.isArray(questions) || typeof duration !== "number") {
      throw new Error("invalid-plan-result");
    }
    return `AI 返回 ${duration} 分钟、${questions.length} 个问题的建议；请人工确认后再采用。`;
  }
  const overall = value.overall;
  if (typeof overall !== "object" || overall === null) {
    throw new Error("invalid-conclusion-result");
  }
  const data = overall as Record<string, unknown>;
  if (typeof data.status !== "string") {
    throw new Error("invalid-conclusion-result");
  }
  return `AI 返回“${data.status}”结论草稿；它不会改变本地记录，也不会产生录用或淘汰决定。`;
};

const nextRunWithRecord = (
  run: InterviewSyntheticLoopRun,
  role: InterviewSyntheticRole,
  candidate: InterviewRecord,
): InterviewSyntheticLoopRun => {
  const stage = run.roles[role];
  const record = validateInterviewRecord(candidate, stage.plan);
  const conclusion = buildInterviewConclusion(
    record,
    stage.plan,
    stage.conclusion.conclusion_id,
  );
  const exportData = buildInterviewSafeExport(
    run.loop.loop_id,
    role,
    run.match,
    stage.plan,
    record,
    conclusion,
    stage.export.export_id,
  );
  const nextStage: InterviewSyntheticStage = {
    ...stage,
    record,
    conclusion,
    export: exportData,
  };
  return {
    ...run,
    roles: {
      ...run.roles,
      [role]: nextStage,
    },
  };
};

const factKindForRole = (
  role: InterviewSyntheticRole,
): "candidate_statement" | "interviewer_observation" =>
  role === "candidate" ? "candidate_statement" : "interviewer_observation";

const recordEntry = (
  record: InterviewRecord,
  entryId: string,
): InterviewRecord["entries"][number] => {
  const entry = record.entries.find(({ entry_id }) => entry_id === entryId);
  if (!entry) {
    throw new Error("entry-not-found");
  }
  return entry;
};

export default function InterviewWorkbench({
  initialRun,
  aiBoundary,
  articleUrl,
  sourceUrl,
}: InterviewWorkbenchProps) {
  const [run, setRun] = useState(initialRun);
  const [role, setRole] = useState<InterviewSyntheticRole>("interviewer");
  const [step, setStep] = useState<InterviewStep>(1);
  const [status, setStatus] = useState<WorkbenchStatus>(initialStatus);
  const [aiNotices, setAiNotices] = useState<Record<AiAction, AiNotice>>({
    match: initialAiNotice(),
    plan: initialAiNotice(),
    conclusion: initialAiNotice(),
  });
  const [aiBusy, setAiBusy] = useState<AiAction | null>(null);

  const stage = run.roles[role];
  const requirementLabels = useMemo(
    () =>
      new Map(
        aiBoundary.job.requirement_signals.map(({ requirement_id }) => [
          requirement_id,
          requirement_id.replace(/^requirement-/, ""),
        ]),
      ),
    [aiBoundary],
  );

  const setWorkbenchStatus = (
    tone: StatusTone,
    title: string,
    message: string,
  ): void => setStatus({ tone, title, message });

  const changeRole = (nextRole: InterviewSyntheticRole): void => {
    setRole(nextRole);
    setStep(1);
    setWorkbenchStatus(
      "info",
      `${roleLabels[nextRole]}视角已切换`,
      "匹配结果共享，计划、记录和结论草稿分别保留；本地编辑不会跨角色写入。",
    );
  };

  const restoreSample = (): void => {
    setRun(initialRun);
    setRole("interviewer");
    setStep(1);
    setAiNotices({
      match: initialAiNotice(),
      plan: initialAiNotice(),
      conclusion: initialAiNotice(),
    });
    setWorkbenchStatus(
      "ready",
      "已恢复合成样例",
      "本地记录、确认勾选和 AI 状态已经清除；原始确定性结果保持不变。",
    );
  };

  const updateRecord = (
    entryId: string,
    updater: (
      entry: InterviewRecord["entries"][number],
    ) => InterviewRecord["entries"][number],
  ): void => {
    try {
      const current = recordEntry(stage.record, entryId);
      const candidate: InterviewRecord = {
        ...stage.record,
        entries: stage.record.entries.map((entry) =>
          entry.entry_id === entryId ? updater(current) : entry,
        ),
      };
      setRun(nextRunWithRecord(run, role, candidate));
      setWorkbenchStatus(
        "ready",
        "本地记录已验证",
        "记录、结论草稿和安全摘要已重新通过确定性引用校验。",
      );
    } catch {
      setWorkbenchStatus(
        "error",
        "本地修改未应用",
        "这次修改会破坏事实、反证、未知项或问题引用，上一版记录保持不变。",
      );
    }
  };

  const updateEntryText = (
    entryId: string,
    kind: "fact" | "counterevidence",
    text: string,
  ): void => {
    updateRecord(entryId, (entry) => {
      if (kind === "fact") {
        const facts =
          entry.facts.length > 0
            ? entry.facts.map((fact, index) =>
                index === 0 ? { ...fact, text } : fact,
              )
            : text.trim().length > 0
              ? [
                  {
                    fact_id: `${entry.entry_id}-fact-user`,
                    kind: factKindForRole(role),
                    text,
                  },
                ]
              : [];
        return { ...entry, facts };
      }
      const counterevidence =
        entry.counterevidence.length > 0
          ? entry.counterevidence.map((counter, index) =>
              index === 0 ? { ...counter, text } : counter,
            )
          : text.trim().length > 0
            ? [
                {
                  counterevidence_id: `${entry.entry_id}-counter-user`,
                  text,
                },
              ]
            : [];
      return { ...entry, counterevidence };
    });
  };

  const updateEntryStatus = (
    entryId: string,
    responseStatus: InterviewRecordResponseStatus,
  ): void => {
    updateRecord(entryId, (entry) => ({
      ...entry,
      response_status: responseStatus,
      unknown_reason:
        responseStatus === "answered" || responseStatus === "partially_answered"
          ? null
          : (entry.unknown_reason ?? "not_verified"),
    }));
  };

  const updateUnknownReason = (
    entryId: string,
    unknownReason: InterviewRecordUnknownReason,
  ): void =>
    updateRecord(entryId, (entry) => ({
      ...entry,
      unknown_reason: unknownReason,
    }));

  const updateConfirmation = (entryId: string, confirmed: boolean): void =>
    updateRecord(entryId, (entry) => ({ ...entry, user_confirmed: confirmed }));

  const requestAi = async (action: AiAction): Promise<void> => {
    if (aiBusy) {
      return;
    }
    const config = operationByAction[action];
    setAiBusy(action);
    setAiNotices((current) => ({
      ...current,
      [action]: {
        state: "loading",
        title: `${config.label}进行中`,
        message:
          "只发送版本化、脱敏的结构化投影；不会发送简历/JD 原文或记录事实文本。",
      },
    }));
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "1.0",
          request_id: crypto.randomUUID(),
          lab_id: "interview-workbench",
          operation: config.operation,
          input: makeRequestInput(action, run, role, aiBoundary),
        }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.status !== "ok") {
        throw new Error("gateway-failure");
      }
      const message = summarizeAiResult(action, payload.result);
      setAiNotices((current) => ({
        ...current,
        [action]: { state: "ready", title: "AI 结果已安全返回", message },
      }));
      setWorkbenchStatus(
        "ready",
        `${config.label}完成`,
        "AI 结果只作为可审阅建议显示；确定性内核、人工确认和安全导出边界保持不变。",
      );
    } catch {
      setAiNotices((current) => ({
        ...current,
        [action]: {
          state: "error",
          title: "AI 不可用，已保留本地结果",
          message:
            "网络、限流、超时或输出合同失败不会阻断三步流程；请继续使用当前确定性结果。",
        },
      }));
      setWorkbenchStatus(
        "warning",
        "AI 已安全降级",
        "当前页面仍保留完整匹配、面试计划、记录、结论草稿和安全摘要。",
      );
    } finally {
      setAiBusy(null);
    }
  };

  const renderAiNotice = (action: AiAction) => {
    const notice = aiNotices[action];
    return (
      <div class={`interview-ai-card interview-ai-card--${notice.state}`}>
        <div>
          <p class="interview-ai-label">AI OPTIONAL</p>
          <strong>{notice.title}</strong>
          <p>{notice.message}</p>
        </div>
        <button
          class="button button--secondary button--compact"
          type="button"
          disabled={aiBusy !== null}
          onClick={() => void requestAi(action)}
        >
          {aiBusy === action ? "请求中…" : operationByAction[action].label}
        </button>
      </div>
    );
  };

  const renderMatch = () => (
    <section
      class="interview-step"
      id="interview-match"
      aria-labelledby="interview-match-title"
    >
      <div class="interview-section-heading">
        <div>
          <p class="section-kicker">STEP 01 · EVIDENCE MAP</p>
          <h2 id="interview-match-title">岗位匹配：先看证据，再看区间</h2>
        </div>
        <p>unknown 不等于不匹配；冲突必须进入人工复核。</p>
      </div>
      <div class="interview-summary-grid">
        <article>
          <span>总体信号</span>
          <strong>{matchBandLabels[run.match.overall.match_band]}</strong>
          <small>
            {run.match.overall.score ?? "—"} / 100（仅作结构化信号）
          </small>
        </article>
        <article>
          <span>已有支持</span>
          <strong>{run.match.overall.known_requirement_count}</strong>
          <small>明确或部分支持</small>
        </article>
        <article>
          <span>未知 / 冲突</span>
          <strong>
            {run.match.overall.unknown_requirement_count} /{" "}
            {run.match.overall.conflict_requirement_count}
          </strong>
          <small>需要面试补证或人工核验</small>
        </article>
      </div>
      <div class="interview-requirement-list">
        {run.match.requirement_results.map((item) => (
          <article class="interview-requirement" key={item.requirement_id}>
            <div>
              <p class="interview-id">{item.requirement_id}</p>
              <h3>
                {requirementLabels.get(item.requirement_id) ??
                  item.requirement_id}
              </h3>
            </div>
            <span class={`interview-state interview-state--${item.status}`}>
              {matchStatusLabels[item.status]}
            </span>
            <p class="interview-requirement-basis">
              {item.basis === "no_evidence" || item.basis === "unknown_evidence"
                ? "未从当前材料得到足够证据。"
                : item.basis === "conflicting_evidence"
                  ? "已有材料存在需要核验的冲突。"
                  : "已有材料提供了可追溯的支持信号。"}
            </p>
            <p class="interview-evidence-ref">
              证据 ID：
              {item.evidence_ids.length > 0
                ? item.evidence_ids.join("、")
                : "未提供"}
            </p>
          </article>
        ))}
      </div>
      {renderAiNotice("match")}
    </section>
  );

  const renderPlan = () => (
    <section
      class="interview-step"
      id="interview-plan"
      aria-labelledby="interview-plan-title"
    >
      <div class="interview-section-heading">
        <div>
          <p class="section-kicker">STEP 02 · QUESTION DESIGN</p>
          <h2 id="interview-plan-title">{roleLabels[role]}面试计划</h2>
        </div>
        <p>
          {stage.plan.duration_minutes} 分钟 · {stage.plan.questions.length}{" "}
          个问题 · {stage.plan.segments.length} 个阶段
        </p>
      </div>
      <div class="interview-plan-contract">
        <span>真实证据优先</span>
        <span>未知项保留</span>
        <span>自动录用/淘汰：禁止</span>
        <span>
          提前门槛：{stage.plan.early_gate.enabled ? "用户选择" : "未启用"}
        </span>
      </div>
      <div class="interview-plan-list">
        {stage.plan.segments.map((segment) => (
          <section class="interview-plan-segment" key={segment.segment_id}>
            <header>
              <div>
                <p class="interview-id">{segment.segment_id}</p>
                <h3>
                  {segment.segment_id === "deep_dive"
                    ? "项目与技术深挖"
                    : segment.segment_id === "qualification"
                      ? "关键门槛确认"
                      : segment.segment_id === "behavioral"
                        ? "协作与复盘"
                        : segment.segment_id === "opening"
                          ? "开场与职责确认"
                          : "反向提问与收尾"}
                </h3>
              </div>
              <strong>{segment.minutes} 分钟</strong>
            </header>
            <div class="interview-question-list">
              {segment.question_ids.map((questionId) => {
                const question = stage.plan.questions.find(
                  ({ question_id }) => question_id === questionId,
                );
                if (!question) return null;
                return (
                  <article
                    class="interview-question"
                    key={question.question_id}
                  >
                    <div class="interview-question-meta">
                      <span>{question.minutes} 分钟</span>
                      <span>
                        {question.requirement_ids.join("、") || "开场/收尾"}
                      </span>
                    </div>
                    <h4>{question.prompt}</h4>
                    <p>追问：{question.follow_ups.join("；")}</p>
                    <dl>
                      <div>
                        <dt>证据目标</dt>
                        <dd>{question.evidence_goals.join("、")}</dd>
                      </div>
                      <div>
                        <dt>评分锚点</dt>
                        <dd>{question.scoring_anchor.meets}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {renderAiNotice("plan")}
    </section>
  );

  const renderRecordEntry = (entry: InterviewRecord["entries"][number]) => {
    const question = stage.plan.questions.find(
      ({ question_id }) => question_id === entry.question_id,
    );
    const factText = entry.facts[0]?.text ?? "";
    const counterevidenceText = entry.counterevidence[0]?.text ?? "";
    return (
      <fieldset class="interview-record-entry" key={entry.entry_id}>
        <legend>
          <span class="interview-id">{entry.entry_id}</span>
          {question?.prompt ?? entry.question_id}
        </legend>
        <div class="interview-record-controls">
          <label>
            回答状态
            <select
              aria-label={`${entry.entry_id}回答状态`}
              value={entry.response_status}
              onChange={(event) =>
                updateEntryStatus(
                  entry.entry_id,
                  (event.currentTarget as HTMLSelectElement)
                    .value as InterviewRecordResponseStatus,
                )
              }
            >
              {Object.entries(responseStatusLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {entry.response_status !== "answered" &&
          entry.response_status !== "partially_answered" ? (
            <label>
              未知原因
              <select
                aria-label={`${entry.entry_id}未知原因`}
                value={entry.unknown_reason ?? "not_verified"}
                onChange={(event) =>
                  updateUnknownReason(
                    entry.entry_id,
                    (event.currentTarget as HTMLSelectElement)
                      .value as InterviewRecordUnknownReason,
                  )
                }
              >
                {Object.entries(unknownReasonLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <label class="interview-text-field">
          <span>事实 / 回答摘要（只保存在本地）</span>
          <textarea
            aria-label={`${entry.entry_id}事实摘要`}
            value={factText}
            placeholder="补充可验证的回答、结果或观察"
            onInput={(event) =>
              updateEntryText(
                entry.entry_id,
                "fact",
                (event.currentTarget as HTMLTextAreaElement).value,
              )
            }
          />
        </label>
        <label class="interview-text-field">
          <span>反证 / 待核验材料（可选）</span>
          <textarea
            aria-label={`${entry.entry_id}反证摘要`}
            value={counterevidenceText}
            placeholder="记录冲突、缺失或需要人工核验的材料"
            onInput={(event) =>
              updateEntryText(
                entry.entry_id,
                "counterevidence",
                (event.currentTarget as HTMLTextAreaElement).value,
              )
            }
          />
        </label>
        <label class="interview-confirmation">
          <input
            type="checkbox"
            checked={entry.user_confirmed}
            onChange={(event) =>
              updateConfirmation(
                entry.entry_id,
                (event.currentTarget as HTMLInputElement).checked,
              )
            }
          />
          <span>我确认这条记录是事实/观察，而不是 AI 自动补全</span>
        </label>
      </fieldset>
    );
  };

  const renderConclusion = (conclusion: InterviewConclusion) => (
    <div class="interview-conclusion">
      <div class="interview-section-heading">
        <div>
          <p class="section-kicker">DRAFT CONCLUSION</p>
          <h3>结论草稿：{conclusion.overall.status}</h3>
        </div>
        <p>所有判断都保持 draft，最终决定由用户确认。</p>
      </div>
      <div class="interview-conclusion-grid">
        <article>
          <span>总体建议</span>
          <strong>{conclusion.overall.recommendation}</strong>
          <small>
            {conclusion.judgments.length} 条有记录判断，
            {conclusion.unassessed_requirement_ids.length} 条未覆盖
          </small>
        </article>
        <article>
          <span>未知项</span>
          <strong>{conclusion.unknown_requirement_ids.length}</strong>
          <small>不转化为负面判断</small>
        </article>
        <article>
          <span>冲突项</span>
          <strong>{conclusion.conflict_requirement_ids.length}</strong>
          <small>需要人工核验</small>
        </article>
      </div>
      <div class="interview-judgment-list">
        {conclusion.judgments.map((judgment) => (
          <article key={judgment.judgment_id}>
            <div>
              <p class="interview-id">{judgment.requirement_id}</p>
              <strong>{judgment.status}</strong>
            </div>
            <p>记录：{judgment.record_entry_ids.join("、") || "无"}</p>
            <p>
              事实：{judgment.fact_ids.join("、") || "无"} · 反证：
              {judgment.counterevidence_ids.join("、") || "无"}
            </p>
          </article>
        ))}
      </div>
    </div>
  );

  const renderRecord = () => (
    <section
      class="interview-step"
      id="interview-record"
      aria-labelledby="interview-record-title"
    >
      <div class="interview-section-heading">
        <div>
          <p class="section-kicker">STEP 03 · HUMAN REVIEW</p>
          <h2 id="interview-record-title">记录事实，再生成结论草稿</h2>
        </div>
        <p>每次编辑都会重新验证问题、事实、反证和 unknown 引用。</p>
      </div>
      <div class="interview-record-list">
        {stage.record.entries.map(renderRecordEntry)}
      </div>
      {renderConclusion(stage.conclusion)}
      {renderAiNotice("conclusion")}
      <div class="interview-export">
        <div>
          <p class="section-kicker">SAFE EXPORT</p>
          <h3>只导出结构化摘要</h3>
          <p>
            摘要不包含简历、JD、问题、事实、反证、个人标识或 Provider 元数据。
          </p>
        </div>
        <ExportActions
          content={renderInterviewSafeExportMarkdown(stage.export)}
          fileName={`interview-${role}-summary.md`}
        />
      </div>
    </section>
  );

  return (
    <div class="interview-shell">
      <div class="interview-toolbar">
        <div>
          <p class="section-kicker">SYNTHETIC FIRST · LOCAL ONLY</p>
          <h2>三步跑通一轮面试</h2>
        </div>
        <div
          class="interview-role-switch"
          role="group"
          aria-label="选择面试角色"
        >
          {(Object.keys(roleLabels) as InterviewSyntheticRole[]).map(
            (value) => (
              <button
                class={`button button--compact ${role === value ? "button--primary" : "button--secondary"}`}
                type="button"
                aria-pressed={role === value}
                onClick={() => changeRole(value)}
                key={value}
              >
                {roleLabels[value]}
              </button>
            ),
          )}
          <button
            class="button button--secondary button--compact"
            type="button"
            onClick={restoreSample}
          >
            恢复样例
          </button>
        </div>
      </div>
      <StatusNotice tone={status.tone} title={status.title}>
        <p>{status.message}</p>
      </StatusNotice>
      <div class="interview-privacy" role="note">
        <strong>隐私边界</strong>
        <span>当前是完全合成样例；真实文本尚未接入页面。</span>
        <span>AI 只接收版本化、脱敏 ID/状态投影。</span>
        <span>所有结论保持 draft，禁止自动录用或淘汰。</span>
      </div>
      <nav class="interview-stepper" aria-label="面试工作台步骤">
        {([1, 2, 3] as InterviewStep[]).map((value) => (
          <button
            type="button"
            class={step === value ? "is-active" : ""}
            aria-current={step === value ? "step" : undefined}
            onClick={() => setStep(value)}
            key={value}
          >
            <span>0{value}</span>
            <strong>{stepLabels[value].title}</strong>
            <small>{stepLabels[value].short}</small>
          </button>
        ))}
      </nav>
      {step === 1 ? renderMatch() : null}
      {step === 2 ? renderPlan() : null}
      {step === 3 ? renderRecord() : null}
      <div class="interview-step-actions">
        <button
          class="button button--secondary"
          type="button"
          disabled={step === 1}
          onClick={() => setStep(Math.max(1, step - 1) as InterviewStep)}
        >
          上一步
        </button>
        <button
          class="button button--primary"
          type="button"
          disabled={step === 3}
          onClick={() => setStep(Math.min(3, step + 1) as InterviewStep)}
        >
          下一步：
          {step < 3 ? stepLabels[(step + 1) as InterviewStep].title : "完成"}
        </button>
      </div>
      <div class="interview-links">
        {articleUrl ? <a href={articleUrl}>阅读相关方法文章</a> : null}
        <a href={sourceUrl}>查看 Lab 源码与 Schema</a>
      </div>
    </div>
  );
}

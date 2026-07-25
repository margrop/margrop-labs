import { useMemo, useState } from "preact/hooks";

import {
  type IncidentDetectiveAttempt,
  type IncidentDetectiveScenario,
  type IncidentEvidence,
  type IncidentSafetyAction,
} from "../lib/incident-detective-contracts";
import {
  type IncidentDetectiveHypothesisDraft,
  type IncidentDetectiveSession,
  IncidentDetectiveSessionError,
  buildIncidentDetectiveAttempt,
  createIncidentDetectiveSession,
  getIncidentEvidenceStates,
  getVisibleIncidentTimeline,
  selectIncidentEvidence,
} from "../lib/incident-detective-session";
import {
  type IncidentDetectiveScoreFinding,
  type IncidentDetectiveScoreResult,
  type IncidentDetectiveScoringRules,
  IncidentDetectiveScoringError,
  scoreIncidentDetectiveAttempt,
} from "../lib/incident-detective-scoring";
import {
  createIncidentDetectiveShareCard,
  incidentDetectiveShareCardFileName,
  renderIncidentDetectiveShareCardSvg,
} from "../lib/incident-detective-share-card";
import { StatusNotice, type StatusTone } from "./ui/StatusNotice";

type IncidentDetectiveWorkbenchProps = {
  scenario: IncidentDetectiveScenario;
  scoringRules: IncidentDetectiveScoringRules;
  articleUrl: string;
  sourceUrl: string;
};

type WorkbenchStatus = {
  tone: StatusTone;
  title: string;
  message: string;
};

const sourceLabels: Record<IncidentEvidence["source"], string> = {
  prometheus: "Prometheus",
  loki: "Loki",
  mysql: "MySQL",
  runbook: "Runbook",
  topology: "Topology",
};

const categoryLabels = {
  change: "变化",
  symptom: "症状",
  observation: "观察",
  recovery: "恢复",
} as const;

const scoreBandLabels: Record<IncidentDetectiveScoreResult["band"], string> = {
  "needs-evidence": "证据不足",
  developing: "正在形成",
  "evidence-led": "证据驱动",
  excellent: "完整闭环",
};

const scoreFindingLabels: Record<
  IncidentDetectiveScoreFinding["status"],
  string
> = {
  met: "达成",
  missed: "待补",
  penalty: "扣分",
  avoided: "已规避",
};

const safetyChoices: Array<{
  value: IncidentSafetyAction;
  label: string;
  risk: "safe" | "approval";
}> = [
  { value: "read_only_first", label: "只读优先", risk: "safe" },
  { value: "preserve_evidence", label: "保留原始证据", risk: "safe" },
  { value: "least_privilege", label: "使用最低权限", risk: "safe" },
  { value: "request_approval", label: "生产操作前请求审批", risk: "safe" },
  { value: "restart_service", label: "立即重启服务", risk: "approval" },
  {
    value: "production_write",
    label: "直接修改生产数据或配置",
    risk: "approval",
  },
  { value: "delete_data", label: "删除生产数据", risk: "approval" },
];

const initialStatus: WorkbenchStatus = {
  tone: "info",
  title: "合成事故已载入",
  message:
    "先选择证据再写结论。全部计算都在当前页面完成，不连接任何真实监控或数据库。",
};

const emptyDraft = (): IncidentDetectiveHypothesisDraft => ({
  summary: "",
  suspected_service_ids: [],
  supporting_evidence_ids: [],
  contradicting_evidence_ids: [],
  confidence: "medium",
  next_action: "",
  safety_actions: [],
});

const formatTime = (timestamp: string): string =>
  `${timestamp.slice(11, 16)} UTC`;

const renderMetricEvidence = (
  evidence: IncidentEvidence & { data: { kind: "metric" } },
) => (
  <div class="incident-metric-grid">
    {evidence.data.series.map((series) => (
      <section class="incident-metric-series" key={series.label}>
        <h4>{series.label}</h4>
        <p>
          {Object.entries(series.labels)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")}
        </p>
        <div
          class="incident-table-scroll"
          tabIndex={0}
          aria-label={`${series.label} 时间序列表格`}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">数值 ({evidence.data.unit})</th>
              </tr>
            </thead>
            <tbody>
              {series.points.map((point) => (
                <tr key={point.timestamp}>
                  <td>{formatTime(point.timestamp)}</td>
                  <td>{point.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ))}
  </div>
);

const renderEvidenceData = (evidence: IncidentEvidence) => {
  if (evidence.data.kind === "metric") {
    return renderMetricEvidence(
      evidence as IncidentEvidence & { data: { kind: "metric" } },
    );
  }

  if (evidence.data.kind === "log") {
    return (
      <div class="incident-log-view" aria-label="合成日志">
        <p>
          Stream: <code>{evidence.data.stream}</code>
        </p>
        <ol>
          {evidence.data.entries.map((entry) => (
            <li key={`${entry.timestamp}-${entry.message}`}>
              <time dateTime={entry.timestamp}>
                {formatTime(entry.timestamp)}
              </time>
              <span
                class={`incident-log-level incident-log-level--${entry.level}`}
              >
                {entry.level}
              </span>
              <code>{entry.message}</code>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (evidence.data.kind === "table") {
    return (
      <div>
        <p class="incident-query">
          只读查询：<code>{evidence.data.query}</code>
        </p>
        <div
          class="incident-table-scroll"
          tabIndex={0}
          aria-label={`${evidence.title} 查询结果`}
        >
          <table>
            <thead>
              <tr>
                {evidence.data.columns.map((column) => (
                  <th scope="col" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evidence.data.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      {cell === null ? "null" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (evidence.data.kind === "document") {
    return (
      <div class="incident-document">
        {evidence.data.sections.map((section) => (
          <section key={section.heading}>
            <h4>{section.heading}</h4>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div class="incident-topology">
      <div>
        <h4>服务节点</h4>
        <ul>
          {evidence.data.nodes.map((node) => (
            <li key={node.service_id}>
              <code>{node.service_id}</code> · {node.label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>调用关系</h4>
        <ul>
          {evidence.data.edges.map((edge) => (
            <li key={`${edge.from}-${edge.to}-${edge.label}`}>
              <code>{edge.from}</code> → <code>{edge.to}</code>
              <span>{edge.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default function IncidentDetectiveWorkbench({
  scenario,
  scoringRules,
  articleUrl,
  sourceUrl,
}: IncidentDetectiveWorkbenchProps) {
  const [session, setSession] = useState<IncidentDetectiveSession>(() =>
    createIncidentDetectiveSession(scenario),
  );
  const [draft, setDraft] =
    useState<IncidentDetectiveHypothesisDraft>(emptyDraft);
  const [attempt, setAttempt] = useState<IncidentDetectiveAttempt | null>(null);
  const [score, setScore] = useState<IncidentDetectiveScoreResult | null>(null);
  const [status, setStatus] = useState<WorkbenchStatus>(initialStatus);

  const evidenceStates = useMemo(
    () => getIncidentEvidenceStates(scenario, session),
    [scenario, session],
  );
  const visibleTimeline = useMemo(
    () => getVisibleIncidentTimeline(scenario, session),
    [scenario, session],
  );
  const evidenceTitles = useMemo(
    () =>
      new Map(
        scenario.evidence.map((evidence) => [evidence.id, evidence.title]),
      ),
    [scenario],
  );
  const remainingBudget = scenario.evidence_budget - session.spent_budget;

  const clearEvaluation = (): void => {
    setAttempt(null);
    setScore(null);
  };

  const acquireEvidence = (evidenceId: string): void => {
    try {
      const nextSession = selectIncidentEvidence(scenario, session, evidenceId);
      const title = evidenceTitles.get(evidenceId) ?? "证据";
      setSession(nextSession);
      clearEvaluation();
      setStatus({
        tone: "ready",
        title: "证据已获取",
        message: `${title} 已加入本局；预算不会退款，新时间线观察已按发生时间揭示。`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        title: "无法获取证据",
        message:
          error instanceof IncidentDetectiveSessionError
            ? error.message
            : "本地证据合同没有通过，请重新开始本局。",
      });
    }
  };

  const resetSession = (): void => {
    setSession(createIncidentDetectiveSession(scenario));
    setDraft(emptyDraft());
    clearEvaluation();
    setStatus(initialStatus);
  };

  const toggleDraftList = (
    field:
      | "suspected_service_ids"
      | "supporting_evidence_ids"
      | "contradicting_evidence_ids"
      | "safety_actions",
    value: string,
    checked: boolean,
  ): void => {
    clearEvaluation();
    setDraft((current) => {
      const currentValues = current[field] as string[];
      const nextValues = checked
        ? [...currentValues, value]
        : currentValues.filter((candidate) => candidate !== value);
      const next = { ...current, [field]: nextValues };

      if (checked && field === "supporting_evidence_ids") {
        next.contradicting_evidence_ids =
          current.contradicting_evidence_ids.filter(
            (candidate) => candidate !== value,
          );
      }
      if (checked && field === "contradicting_evidence_ids") {
        next.supporting_evidence_ids = current.supporting_evidence_ids.filter(
          (candidate) => candidate !== value,
        );
      }

      return next;
    });
  };

  const submitAttempt = (event: SubmitEvent): void => {
    event.preventDefault();

    try {
      const validatedAttempt = buildIncidentDetectiveAttempt(
        scenario,
        session,
        draft,
      );
      const scoreResult = scoreIncidentDetectiveAttempt(
        scenario,
        validatedAttempt,
        scoringRules,
      );
      setAttempt(validatedAttempt);
      setScore(scoreResult);
      setStatus({
        tone: "ready",
        title: "本地评分已完成",
        message:
          "Attempt v1 已通过合同并按固定规则评分；结果未保存、未上传，也没有调用 AI。",
      });
    } catch (error) {
      clearEvaluation();
      setStatus({
        tone: "error",
        title: "推理尚未完成",
        message:
          error instanceof IncidentDetectiveSessionError
            ? error.message
            : error instanceof IncidentDetectiveScoringError
              ? "本地评分合同没有通过，请重新开始本局。"
              : "请检查推理表单后重试。",
      });
    }
  };

  const downloadShareCard = (): void => {
    if (!score) {
      return;
    }

    try {
      const card = createIncidentDetectiveShareCard(score);
      const svg = renderIncidentDetectiveShareCardSvg(card);
      const url = URL.createObjectURL(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = incidentDetectiveShareCardFileName(card);
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus({
        tone: "ready",
        title: "分享卡已生成",
        message:
          "SVG 只包含案例 ID、总分、等级和维度分数；没有事故原文、答案、证据或你的假设。",
      });
    } catch {
      setStatus({
        tone: "error",
        title: "无法生成分享卡",
        message: "本地分享合同没有通过，请重新提交本局评分。",
      });
    }
  };

  return (
    <div class="incident-shell">
      <section
        class="incident-briefing"
        aria-labelledby="incident-briefing-title"
      >
        <div>
          <p class="section-kicker">SYNTHETIC INCIDENT · INTERMEDIATE</p>
          <h2 id="incident-briefing-title">{scenario.title}</h2>
          <p>{scenario.summary}</p>
        </div>
        <div class="incident-budget" aria-label="证据预算">
          <div>
            <span>已使用 {session.spent_budget}</span>
            <strong>剩余 {remainingBudget}</strong>
          </div>
          <progress max={scenario.evidence_budget} value={session.spent_budget}>
            已使用 {session.spent_budget} / {scenario.evidence_budget}
          </progress>
          <small>
            总预算 {scenario.evidence_budget} 点；已获取证据不可退款。
          </small>
        </div>
      </section>

      <StatusNotice tone={status.tone} title={status.title}>
        <p>{status.message}</p>
      </StatusNotice>

      <section
        class="incident-objectives"
        aria-labelledby="incident-objectives-title"
      >
        <div>
          <h3 id="incident-objectives-title">本局目标</h3>
          <ul>
            {scenario.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>安全边界</h3>
          <ul>
            {scenario.safety_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </section>

      <section
        class="incident-evidence-section"
        aria-labelledby="incident-evidence-title"
      >
        <div class="incident-section-heading">
          <div>
            <p class="section-kicker">EVIDENCE MENU</p>
            <h3 id="incident-evidence-title">选择下一份证据</h3>
          </div>
          <p>
            {session.selected_evidence_ids.length} / {scenario.evidence.length}{" "}
            已获取
          </p>
        </div>

        <div class="incident-evidence-list">
          {evidenceStates.map(
            ({
              evidence,
              status: evidenceStatus,
              missing_prerequisite_ids: missingPrerequisites,
            }) => {
              const stateMessageId = `${evidence.id}-state`;
              const statusMessage =
                evidenceStatus === "locked"
                  ? `需先获取：${missingPrerequisites
                      .map((id) => evidenceTitles.get(id) ?? id)
                      .join("、")}`
                  : evidenceStatus === "insufficient_budget"
                    ? `剩余 ${remainingBudget} 点，获取需要 ${evidence.acquisition_cost} 点`
                    : evidenceStatus === "selected"
                      ? "已获取并计入预算"
                      : "前置条件和预算均满足";

              return (
                <article
                  class={`incident-evidence incident-evidence--${evidenceStatus}`}
                  key={evidence.id}
                >
                  <header>
                    <div>
                      <span>{sourceLabels[evidence.source]}</span>
                      <code>{evidence.id}</code>
                    </div>
                    <strong>{evidence.acquisition_cost} 点</strong>
                  </header>
                  <h4>{evidence.title}</h4>
                  <p>{evidence.purpose}</p>
                  <div class="incident-evidence-action">
                    <span id={stateMessageId}>{statusMessage}</span>
                    <button
                      class="button button--secondary button--compact"
                      type="button"
                      disabled={evidenceStatus !== "available"}
                      aria-describedby={stateMessageId}
                      onClick={() => acquireEvidence(evidence.id)}
                    >
                      {evidenceStatus === "selected" ? "已取证" : "获取证据"}
                    </button>
                  </div>
                  {evidenceStatus === "selected" ? (
                    <div class="incident-evidence-data">
                      <p class="incident-evidence-data-label">
                        已揭示的合成事实
                      </p>
                      {renderEvidenceData(evidence)}
                    </div>
                  ) : null}
                </article>
              );
            },
          )}
        </div>
      </section>

      <section
        class="incident-timeline-section"
        aria-labelledby="incident-timeline-title"
      >
        <div class="incident-section-heading">
          <div>
            <p class="section-kicker">EVIDENCE-REVEALED TIMELINE</p>
            <h3 id="incident-timeline-title">当前可见时间线</h3>
          </div>
          <p>{visibleTimeline.length} 个事件</p>
        </div>
        <ol class="incident-timeline">
          {visibleTimeline.map((timelineEvent) => (
            <li key={timelineEvent.id}>
              <time dateTime={timelineEvent.occurred_at}>
                {formatTime(timelineEvent.occurred_at)}
              </time>
              <div>
                <span>{categoryLabels[timelineEvent.category]}</span>
                <p>{timelineEvent.summary}</p>
                {timelineEvent.evidence_id ? (
                  <small>
                    来自 {evidenceTitles.get(timelineEvent.evidence_id)}
                  </small>
                ) : (
                  <small>初始简报</small>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <form class="incident-hypothesis" onSubmit={submitAttempt}>
        <div class="incident-section-heading">
          <div>
            <p class="section-kicker">YOUR HYPOTHESIS</p>
            <h3>提交可审计推理</h3>
          </div>
          <p>确定性规则评分 · 无 AI</p>
        </div>

        <label class="incident-text-field">
          <span>根因假设</span>
          <small>至少 20 字；说明机制，不要只写时间上的先后。</small>
          <textarea
            name="hypothesis_summary"
            rows={5}
            minLength={20}
            maxLength={1000}
            value={draft.summary}
            onInput={(event) => {
              setDraft((current) => ({
                ...current,
                summary: event.currentTarget.value,
              }));
              clearEvaluation();
            }}
          />
        </label>

        <fieldset>
          <legend>怀疑服务（至少一项）</legend>
          <div class="incident-choice-grid">
            {scenario.services.map((service) => (
              <label key={service.id}>
                <input
                  type="checkbox"
                  name="suspected_services"
                  value={service.id}
                  checked={draft.suspected_service_ids.includes(service.id)}
                  onChange={(event) =>
                    toggleDraftList(
                      "suspected_service_ids",
                      service.id,
                      event.currentTarget.checked,
                    )
                  }
                />
                <span>{service.label}</span>
                <small>{service.kind}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>证据角色（支持至少一项，支持与反证不可重叠）</legend>
          {session.selected_evidence_ids.length === 0 ? (
            <p class="incident-empty-state">
              先获取证据，才能引用它支持或反驳假设。
            </p>
          ) : (
            <div class="incident-evidence-roles">
              {session.selected_evidence_ids.map((evidenceId) => (
                <div key={evidenceId}>
                  <span>{evidenceTitles.get(evidenceId)}</span>
                  <label>
                    <input
                      type="checkbox"
                      name="supporting_evidence"
                      value={evidenceId}
                      checked={draft.supporting_evidence_ids.includes(
                        evidenceId,
                      )}
                      onChange={(event) =>
                        toggleDraftList(
                          "supporting_evidence_ids",
                          evidenceId,
                          event.currentTarget.checked,
                        )
                      }
                    />
                    支持
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="contradicting_evidence"
                      value={evidenceId}
                      checked={draft.contradicting_evidence_ids.includes(
                        evidenceId,
                      )}
                      onChange={(event) =>
                        toggleDraftList(
                          "contradicting_evidence_ids",
                          evidenceId,
                          event.currentTarget.checked,
                        )
                      }
                    />
                    反证
                  </label>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <div class="incident-hypothesis-grid">
          <label class="incident-text-field">
            <span>信心级别</span>
            <small>信心不等于评分，应与证据强度匹配。</small>
            <select
              name="confidence"
              value={draft.confidence}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  confidence: event.currentTarget
                    .value as IncidentDetectiveHypothesisDraft["confidence"],
                }));
                clearEvaluation();
              }}
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>

          <label class="incident-text-field">
            <span>下一步</span>
            <small>至少 10 字；说明如何安全验证或推进。</small>
            <textarea
              name="next_action"
              rows={4}
              minLength={10}
              maxLength={500}
              value={draft.next_action}
              onInput={(event) => {
                setDraft((current) => ({
                  ...current,
                  next_action: event.currentTarget.value,
                }));
                clearEvaluation();
              }}
            />
          </label>
        </div>

        <fieldset>
          <legend>你会采取哪些安全动作？</legend>
          <div class="incident-safety-grid">
            {safetyChoices.map((choice) => (
              <label
                class={`incident-safety-choice incident-safety-choice--${choice.risk}`}
                key={choice.value}
              >
                <input
                  type="checkbox"
                  name="safety_actions"
                  value={choice.value}
                  checked={draft.safety_actions.includes(choice.value)}
                  onChange={(event) =>
                    toggleDraftList(
                      "safety_actions",
                      choice.value,
                      event.currentTarget.checked,
                    )
                  }
                />
                <span>{choice.label}</span>
                <small>
                  {choice.risk === "safe" ? "安全实践" : "生产风险 / 需审批"}
                </small>
              </label>
            ))}
          </div>
        </fieldset>

        <div class="incident-form-actions">
          <button class="button button--primary" type="submit">
            验证并评分
          </button>
          <button
            class="button button--secondary"
            type="button"
            onClick={resetSession}
          >
            重新开始本局
          </button>
        </div>
      </form>

      {attempt && score ? (
        <section
          class="incident-attempt-result"
          aria-labelledby="incident-attempt-title"
        >
          <div class="incident-section-heading">
            <div>
              <p class="section-kicker">DETERMINISTIC SCORE V1</p>
              <h3 id="incident-attempt-title">本局证据评分</h3>
            </div>
            <p>未保存 · 未上传 · 无 AI</p>
          </div>
          <div class="incident-score-summary">
            <div>
              <strong class="incident-score-number">
                {score.total_score}
                <span>/{score.max_score}</span>
              </strong>
              <p class="incident-score-band">{scoreBandLabels[score.band]}</p>
            </div>
            <p>
              评分只检查你选择了哪些证据、取证顺序、结构化结论、反证与安全动作；
              不判断自由文本语义，也不展示标准答案。
            </p>
          </div>

          <div class="incident-score-dimensions" aria-label="评分维度">
            {score.dimensions.map((dimension) => (
              <section key={dimension.id}>
                <div>
                  <h4>{dimension.label}</h4>
                  <strong>
                    {dimension.score}/{dimension.max_score}
                  </strong>
                </div>
                <progress max={dimension.max_score} value={dimension.score}>
                  {dimension.score} / {dimension.max_score}
                </progress>
                <details>
                  <summary>查看判定明细</summary>
                  <ul class="incident-score-findings">
                    {dimension.findings.map((finding) => (
                      <li
                        class={`incident-score-finding incident-score-finding--${finding.status}`}
                        key={finding.rule_id}
                      >
                        <span>{scoreFindingLabels[finding.status]}</span>
                        <p>{finding.message}</p>
                        <strong>
                          {finding.points_awarded > 0 ? "+" : ""}
                          {finding.points_awarded}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            ))}
          </div>

          <div class="incident-score-feedback">
            <section>
              <h4>做得好的部分</h4>
              {score.strengths.length > 0 ? (
                <ul>
                  {score.strengths.map((strength) => (
                    <li key={strength}>{strength}</li>
                  ))}
                </ul>
              ) : (
                <p>本局还没有命中正向规则，先从关键症状证据开始。</p>
              )}
            </section>
            <section>
              <h4>下一局优先改进</h4>
              {score.improvements.length > 0 ? (
                <ul>
                  {score.improvements.map((improvement) => (
                    <li key={improvement}>{improvement}</li>
                  ))}
                </ul>
              ) : (
                <p>五个评分维度均已闭环，可以尝试更少预算的路径。</p>
              )}
            </section>
          </div>

          <div class="incident-share-actions">
            <div>
              <h4>分享结构化结果</h4>
              <p>
                下载本地 SVG；只含案例 ID
                和分数，不含事故原文、证据、答案或你的输入。
              </p>
            </div>
            <button
              class="button button--secondary"
              type="button"
              onClick={downloadShareCard}
            >
              下载隐私分享卡
            </button>
          </div>

          <dl class="incident-attempt-facts">
            <div>
              <dt>证据</dt>
              <dd>{attempt.selected_evidence_ids.length} 份</dd>
            </div>
            <div>
              <dt>预算</dt>
              <dd>
                {attempt.spent_budget} / {scenario.evidence_budget}
              </dd>
            </div>
            <div>
              <dt>时间线</dt>
              <dd>{attempt.ordered_timeline_event_ids.length} 个事件</dd>
            </div>
            <div>
              <dt>信心</dt>
              <dd>{attempt.hypothesis.confidence}</dd>
            </div>
          </dl>
          <details>
            <summary>查看本地生成的 Attempt JSON</summary>
            <pre>{JSON.stringify(attempt, null, 2)}</pre>
          </details>
        </section>
      ) : null}

      <nav class="incident-next-links" aria-label="案例相关链接">
        <a class="button button--secondary" href={articleUrl}>
          阅读相关文章
        </a>
        <a class="button button--secondary" href={sourceUrl}>
          查看公开场景源码
        </a>
      </nav>
    </div>
  );
}

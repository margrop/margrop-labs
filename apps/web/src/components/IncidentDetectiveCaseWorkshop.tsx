import { useMemo, useState } from "preact/hooks";

import { requestIncidentDetectiveCaseProposal } from "../lib/incident-detective-ai-client";
import {
  type IncidentDetectiveCaseGenerationInput,
  type IncidentDetectiveCaseProposal,
  type IncidentDetectiveCaseReview,
  reviewIncidentDetectiveCaseProposal,
} from "../lib/incident-detective-case-generation";
import type { IncidentDetectiveScenario } from "../lib/incident-detective-contracts";
import { StatusNotice, type StatusTone } from "./ui/StatusNotice";

type Props = { scenario: IncidentDetectiveScenario };

type WorkshopStatus = {
  tone: StatusTone;
  title: string;
  message: string;
};

const sources = [
  ["prometheus", "Prometheus"],
  ["loki", "Loki"],
  ["mysql", "MySQL"],
  ["runbook", "Runbook"],
  ["topology", "Topology"],
] as const;

const checklistLabels: Record<
  keyof IncidentDetectiveCaseReview["checklist"],
  string
> = {
  synthetic_data_confirmed: "已确认全部数据为合成数据",
  answer_separation_confirmed: "已确认答案与公开场景分离",
  read_only_confirmed: "已确认全部证据访问只读",
  counterevidence_confirmed: "已确认包含合理反证",
  budget_path_confirmed: "已确认预算内存在闭合路径",
  privacy_confirmed: "已确认没有敏感或真实基础设施标识",
  scoring_independence_confirmed: "已确认评分规则独立于 Proposal",
};

const emptyChecklist = (): IncidentDetectiveCaseReview["checklist"] => ({
  synthetic_data_confirmed: false,
  answer_separation_confirmed: false,
  read_only_confirmed: false,
  counterevidence_confirmed: false,
  budget_path_confirmed: false,
  privacy_confirmed: false,
  scoring_independence_confirmed: false,
});

const createInitialInput = (
  scenario: IncidentDetectiveScenario,
): IncidentDetectiveCaseGenerationInput => ({
  schema_version: "1.0",
  proposal_id: "checkout-cache-stampede",
  base_case_id: scenario.id,
  difficulty: "intermediate",
  theme: "cache-behavior",
  target_sources: ["topology", "prometheus", "loki", "mysql", "runbook"],
  evidence_budget: 8,
  learning_objectives: [
    "先用时间窗口和依赖拓扑缩小范围，再检查缓存与数据库之间的关联。",
    "明确记录反证与未知项，避免把缓存未命中率上升直接当成根因。",
    "所有数据库检查保持只读，并在任何生产变更前请求人工审批。",
  ],
});

export default function IncidentDetectiveCaseWorkshop({ scenario }: Props) {
  const [input, setInput] = useState(() => createInitialInput(scenario));
  const [objectivesText, setObjectivesText] = useState(() =>
    createInitialInput(scenario).learning_objectives.join("\n"),
  );
  const [proposal, setProposal] =
    useState<IncidentDetectiveCaseProposal | null>(null);
  const [pending, setPending] = useState(false);
  const [decision, setDecision] =
    useState<IncidentDetectiveCaseReview["decision"]>("changes_requested");
  const [checklist, setChecklist] = useState(emptyChecklist);
  const [reviewNotes, setReviewNotes] = useState("");
  const [requiredChanges, setRequiredChanges] = useState("");
  const [reviewResult, setReviewResult] = useState<ReturnType<
    typeof reviewIncidentDetectiveCaseProposal
  > | null>(null);
  const [status, setStatus] = useState<WorkshopStatus>({
    tone: "info",
    title: "审核型 AI 工坊",
    message:
      "生成的是内部 Proposal，不是公开场景。即使人工批准，也不会自动发布或写入仓库。",
  });

  const totalEvidenceCost = useMemo(
    () =>
      proposal?.evidence_outline.reduce(
        (total, evidence) => total + evidence.acquisition_cost,
        0,
      ) ?? 0,
    [proposal],
  );

  const resetReview = (): void => {
    setChecklist(emptyChecklist());
    setDecision("changes_requested");
    setReviewNotes("");
    setRequiredChanges("");
    setReviewResult(null);
  };

  const generateProposal = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setProposal(null);
    resetReview();
    const learningObjectives = objectivesText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const candidate = { ...input, learning_objectives: learningObjectives };
    try {
      const result = await requestIncidentDetectiveCaseProposal(
        candidate,
        scenario,
      );
      if (result.status === "review-required") {
        setInput(candidate);
        setProposal(result.proposal);
        setStatus({
          tone: "ready",
          title: "Proposal 已通过确定性后处理",
          message:
            "证据 DAG、预算取舍、反证、只读和隐私边界已验证；仍需逐项人工审核。",
        });
      } else {
        setStatus({
          tone: "error",
          title: "没有生成 Proposal",
          message: `服务端安全失败：${result.failure_reason}。未创建伪造降级结果。`,
        });
      }
    } finally {
      setPending(false);
    }
  };

  const submitReview = (event: SubmitEvent): void => {
    event.preventDefault();
    if (!proposal) return;
    try {
      const review: IncidentDetectiveCaseReview = {
        schema_version: "1.0",
        proposal_id: proposal.proposal_id,
        decision,
        checklist,
        review_notes: reviewNotes
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        required_changes: requiredChanges
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      };
      const result = reviewIncidentDetectiveCaseProposal(proposal, review);
      setReviewResult(result);
      setStatus({
        tone: "ready",
        title: "人工审核已记录",
        message: `决定为 ${result.status}；publishable 仍固定为 false，只能下载本地审核包。`,
      });
    } catch {
      setReviewResult(null);
      setStatus({
        tone: "error",
        title: "审核合同未通过",
        message:
          "批准需要七项全部确认且无待修改项；请求修改必须至少填写一条具体变化。",
      });
    }
  };

  const downloadReviewPackage = (): void => {
    if (!reviewResult) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(reviewResult, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `incident-detective-${reviewResult.proposal.proposal_id}-review.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section class="incident-workshop" aria-labelledby="case-workshop-title">
      <div class="incident-section-heading">
        <div>
          <p class="section-kicker">AI CASE PROPOSAL · HUMAN REVIEW</p>
          <h2 id="case-workshop-title">安全场景变体工坊</h2>
        </div>
        <p>不写仓库 · 不自动发布 · 不连接真实监控</p>
      </div>

      <StatusNotice tone={status.tone} title={status.title}>
        {status.message}
      </StatusNotice>

      <form class="incident-workshop-form" onSubmit={generateProposal}>
        <div class="incident-hypothesis-grid">
          <label class="incident-text-field">
            <span>Proposal ID</span>
            <input
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              maxLength={80}
              value={input.proposal_id}
              onInput={(event) =>
                setInput((current) => ({
                  ...current,
                  proposal_id: event.currentTarget.value,
                }))
              }
            />
          </label>
          <label class="incident-text-field">
            <span>难度</span>
            <select
              value={input.difficulty}
              onChange={(event) =>
                setInput((current) => ({
                  ...current,
                  difficulty: event.currentTarget
                    .value as IncidentDetectiveCaseGenerationInput["difficulty"],
                }))
              }
            >
              <option value="beginner">入门</option>
              <option value="intermediate">中级</option>
              <option value="advanced">高级</option>
            </select>
          </label>
          <label class="incident-text-field">
            <span>主题</span>
            <select
              value={input.theme}
              onChange={(event) =>
                setInput((current) => ({
                  ...current,
                  theme: event.currentTarget
                    .value as IncidentDetectiveCaseGenerationInput["theme"],
                }))
              }
            >
              <option value="query-regression">查询回退</option>
              <option value="dependency-latency">依赖延迟</option>
              <option value="capacity-pressure">容量压力</option>
              <option value="cache-behavior">缓存行为</option>
              <option value="release-regression">发布回退</option>
              <option value="observability-gap">可观测性缺口</option>
            </select>
          </label>
          <label class="incident-text-field">
            <span>证据预算</span>
            <input
              type="number"
              min={4}
              max={16}
              value={input.evidence_budget}
              onInput={(event) =>
                setInput((current) => ({
                  ...current,
                  evidence_budget: Number(event.currentTarget.value),
                }))
              }
            />
          </label>
        </div>

        <fieldset>
          <legend>允许的证据来源（3–5 项）</legend>
          <div class="incident-choice-grid">
            {sources.map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={input.target_sources.includes(value)}
                  onChange={(event) =>
                    setInput((current) => ({
                      ...current,
                      target_sources: event.currentTarget.checked
                        ? [...current.target_sources, value]
                        : current.target_sources.filter(
                            (source) => source !== value,
                          ),
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <label class="incident-text-field">
          <span>学习目标（每行一条，共 2–4 条）</span>
          <textarea
            rows={4}
            value={objectivesText}
            onInput={(event) => setObjectivesText(event.currentTarget.value)}
          />
        </label>

        <div class="incident-form-actions">
          <button
            class="button button--primary"
            type="submit"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "正在生成…" : "生成待审核 Proposal"}
          </button>
        </div>
      </form>

      {proposal ? (
        <div class="incident-proposal-result">
          <header>
            <div>
              <p class="section-kicker">REVIEW REQUIRED</p>
              <h3>{proposal.title}</h3>
              <p>{proposal.summary}</p>
            </div>
            <dl>
              <div>
                <dt>预算</dt>
                <dd>{proposal.evidence_budget}</dd>
              </div>
              <div>
                <dt>总成本</dt>
                <dd>{totalEvidenceCost}</dd>
              </div>
              <div>
                <dt>证据</dt>
                <dd>{proposal.evidence_outline.length}</dd>
              </div>
            </dl>
          </header>

          <div class="incident-proposal-evidence">
            {proposal.evidence_outline.map((evidence) => (
              <article key={evidence.id}>
                <span>
                  {evidence.source} · {evidence.role}
                </span>
                <h4>{evidence.title}</h4>
                <p>{evidence.purpose}</p>
                <small>
                  成本 {evidence.acquisition_cost} · {evidence.access} · 前置{" "}
                  {evidence.unlocks_after.join(", ") || "无"}
                </small>
              </article>
            ))}
          </div>

          <details>
            <summary>查看完整 Proposal JSON</summary>
            <pre>{JSON.stringify(proposal, null, 2)}</pre>
          </details>

          <form class="incident-review-form" onSubmit={submitReview}>
            <fieldset>
              <legend>人工审核清单</legend>
              <div class="incident-review-checklist">
                {Object.entries(checklistLabels).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={checklist[key as keyof typeof checklist]}
                      onChange={(event) =>
                        setChecklist((current) => ({
                          ...current,
                          [key]: event.currentTarget.checked,
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div class="incident-hypothesis-grid">
              <label class="incident-text-field">
                <span>审核决定</span>
                <select
                  value={decision}
                  onChange={(event) =>
                    setDecision(
                      event.currentTarget
                        .value as IncidentDetectiveCaseReview["decision"],
                    )
                  }
                >
                  <option value="approved">批准进入人工制作</option>
                  <option value="changes_requested">请求修改</option>
                  <option value="rejected">拒绝</option>
                </select>
              </label>
              <label class="incident-text-field">
                <span>审核备注（必填，每行至少 10 字）</span>
                <textarea
                  required
                  minLength={10}
                  rows={4}
                  value={reviewNotes}
                  onInput={(event) => setReviewNotes(event.currentTarget.value)}
                />
              </label>
              <label class="incident-text-field">
                <span>待修改项（请求修改时必填，每行至少 10 字）</span>
                <textarea
                  rows={4}
                  value={requiredChanges}
                  onInput={(event) =>
                    setRequiredChanges(event.currentTarget.value)
                  }
                />
              </label>
            </div>
            <div class="incident-form-actions">
              <button class="button button--secondary" type="submit">
                验证人工审核
              </button>
              {reviewResult ? (
                <button
                  class="button button--secondary"
                  type="button"
                  onClick={downloadReviewPackage}
                >
                  下载本地审核包
                </button>
              ) : null}
            </div>
            {reviewResult ? (
              <p class="incident-review-result" role="status">
                decision={reviewResult.status} · publishable=false
              </p>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}

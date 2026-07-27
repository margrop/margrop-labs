import { useEffect, useState } from "preact/hooks";

import {
  type TokenForgeEditorSession,
  type TokenForgeTaskEditValues,
  TokenForgeEditorError,
  autoOrderTokenForgeEditorSession,
  deleteTokenForgeEditorTask,
  moveTokenForgeEditorTask,
  setTokenForgeEditorTaskLock,
  updateTokenForgeEditorBudget,
  updateTokenForgeEditorTask,
} from "../lib/token-forge-editor";

type EditorNotice = {
  title: string;
  message: string;
  ordering_mode?: "quality" | "manual";
};

type TokenForgePlanEditorProps = {
  session: TokenForgeEditorSession;
  onSessionChange: (
    session: TokenForgeEditorSession,
    notice: EditorNotice,
  ) => void;
  onRestore: () => void;
  onError: (message: string) => void;
};

const taskValues = (
  session: TokenForgeEditorSession,
): Record<string, TokenForgeTaskEditValues> =>
  Object.fromEntries(
    session.plan.tasks.map((task) => [
      task.id,
      {
        size: task.size,
        title: task.title,
        estimated_tokens: String(task.estimated_tokens),
        estimated_hours: String(task.estimated_hours),
        included: task.scope.included.join("\n"),
        excluded: task.scope.excluded.join("\n"),
        prompt: task.prompt,
        acceptance_criteria: task.acceptance_criteria.join("\n"),
      },
    ]),
  );

const editorErrorMessage = (error: unknown): string =>
  error instanceof TokenForgeEditorError
    ? error.message
    : "本地修改没有通过确定性验证，原计划保持不变。";

export function TokenForgePlanEditor({
  session,
  onSessionChange,
  onRestore,
  onError,
}: TokenForgePlanEditorProps) {
  const [drafts, setDrafts] = useState(() => taskValues(session));
  const [tokenBudget, setTokenBudget] = useState(
    String(session.input.token_budget),
  );
  const [availableHours, setAvailableHours] = useState(
    String(session.input.available_hours),
  );

  useEffect(() => {
    setDrafts(taskValues(session));
    setTokenBudget(String(session.input.token_budget));
    setAvailableHours(String(session.input.available_hours));
  }, [session]);

  const run = (
    operation: () => TokenForgeEditorSession,
    notice: EditorNotice,
  ): void => {
    try {
      onSessionChange(operation(), notice);
    } catch (error) {
      onError(editorErrorMessage(error));
    }
  };

  const updateDraft = <K extends keyof TokenForgeTaskEditValues>(
    taskId: string,
    field: K,
    value: TokenForgeTaskEditValues[K],
  ): void => {
    setDrafts((current) => {
      const draft = current[taskId];
      if (!draft) {
        return current;
      }

      return {
        ...current,
        [taskId]: {
          ...draft,
          [field]: value,
        },
      };
    });
  };

  const locked = new Set(session.locked_task_ids);

  return (
    <section
      class="token-forge-editor"
      aria-labelledby="token-forge-editor-title"
    >
      <header class="token-forge-editor-heading">
        <div>
          <p class="section-kicker">LOCAL EDIT · NO STORAGE</p>
          <h3 id="token-forge-editor-title">本地调整这份计划</h3>
          <p>修改只保留在当前标签页；每次应用都会重新验证合同、质量与导出。</p>
        </div>
        <p>
          修订 {session.revision} · 锁定 {session.locked_task_ids.length}
        </p>
      </header>

      <div class="token-forge-editor-toolbar">
        <label>
          <span>计划 Token 上限</span>
          <input
            type="number"
            min="2000"
            max="60000"
            step="1000"
            inputMode="numeric"
            value={tokenBudget}
            onInput={(event) => setTokenBudget(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>计划工时上限</span>
          <input
            type="number"
            min="1"
            max="80"
            step="0.5"
            inputMode="decimal"
            value={availableHours}
            onInput={(event) => setAvailableHours(event.currentTarget.value)}
          />
        </label>
        <div class="token-forge-editor-toolbar-actions">
          <button
            class="button button--secondary"
            type="button"
            onClick={() =>
              run(
                () =>
                  updateTokenForgeEditorBudget(session, {
                    token_budget: tokenBudget,
                    available_hours: availableHours,
                  }),
                {
                  title: "预算已重新验证",
                  message:
                    "当前任务仍在新的 Token 与工时上限内；质量和导出已同步更新。",
                },
              )
            }
          >
            应用预算
          </button>
          <button
            class="button button--secondary"
            type="button"
            disabled={session.locked_task_ids.length > 0}
            onClick={() =>
              run(() => autoOrderTokenForgeEditorSession(session), {
                title: "已按规则重新规划顺序",
                message:
                  "只调整了依赖已满足的未锁定计划顺序；任务内容与预算没有改变。",
                ordering_mode: "quality",
              })
            }
          >
            按质量重新排序
          </button>
          <button
            class="button button--secondary"
            type="button"
            onClick={onRestore}
          >
            恢复生成结果
          </button>
        </div>
      </div>

      {session.locked_task_ids.length > 0 ? (
        <p class="token-forge-editor-note">
          有锁定任务时不会自动重新排序，避免移动已经确认的任务。仍可先解锁后排序。
        </p>
      ) : null}

      <div class="token-forge-editor-list">
        {session.plan.tasks.map((task, index) => {
          const draft = drafts[task.id];
          const isLocked = locked.has(task.id);
          const previousTask = session.plan.tasks[index - 1];
          const nextTask = session.plan.tasks[index + 1];

          if (!draft) {
            return null;
          }

          return (
            <details class="token-forge-editor-task" key={task.id}>
              <summary>
                <span>
                  {index + 1}. {task.title}
                </span>
                <strong>{isLocked ? "已锁定" : "可编辑"}</strong>
              </summary>

              <div class="token-forge-editor-task-actions">
                <button
                  class="button button--secondary"
                  type="button"
                  onClick={() =>
                    run(
                      () =>
                        setTokenForgeEditorTaskLock(
                          session,
                          task.id,
                          !isLocked,
                        ),
                      {
                        title: isLocked ? "任务已解锁" : "任务已锁定",
                        message: isLocked
                          ? "该任务现在可以修改、删除或移动。"
                          : "该任务内容和位置受到保护，直到你主动解锁。",
                      },
                    )
                  }
                >
                  {isLocked ? "解锁任务" : "锁定任务"}
                </button>
                <button
                  class="button button--secondary"
                  type="button"
                  disabled={
                    isLocked ||
                    previousTask === undefined ||
                    locked.has(previousTask.id)
                  }
                  onClick={() =>
                    run(
                      () => moveTokenForgeEditorTask(session, task.id, "up"),
                      {
                        title: "任务顺序已更新",
                        message:
                          "新顺序已通过依赖检查，并重新生成质量与导出结果。",
                      },
                    )
                  }
                >
                  上移
                </button>
                <button
                  class="button button--secondary"
                  type="button"
                  disabled={
                    isLocked ||
                    nextTask === undefined ||
                    locked.has(nextTask.id)
                  }
                  onClick={() =>
                    run(
                      () => moveTokenForgeEditorTask(session, task.id, "down"),
                      {
                        title: "任务顺序已更新",
                        message:
                          "新顺序已通过依赖检查，并重新生成质量与导出结果。",
                      },
                    )
                  }
                >
                  下移
                </button>
                <button
                  class="button button--secondary"
                  type="button"
                  disabled={isLocked || session.plan.tasks.length === 1}
                  onClick={() =>
                    run(() => deleteTokenForgeEditorTask(session, task.id), {
                      title: "任务已从本地计划移除",
                      message:
                        "剩余依赖、预算、质量和导出已重新验证；生成结果本身没有被覆盖。",
                    })
                  }
                >
                  删除
                </button>
              </div>

              <div class="token-forge-editor-fields" aria-disabled={isLocked}>
                <label>
                  <span>标题</span>
                  <input
                    type="text"
                    minLength={5}
                    maxLength={100}
                    disabled={isLocked}
                    value={draft.title}
                    onInput={(event) =>
                      updateDraft(task.id, "title", event.currentTarget.value)
                    }
                  />
                </label>
                <label>
                  <span>规模</span>
                  <select
                    disabled={isLocked}
                    value={draft.size}
                    onChange={(event) =>
                      updateDraft(
                        task.id,
                        "size",
                        event.currentTarget
                          .value as TokenForgeTaskEditValues["size"],
                      )
                    }
                  >
                    <option value="S">S · 2,000–7,999 Token</option>
                    <option value="M">M · 8,000–24,999 Token</option>
                    <option value="L">L · 25,000–60,000 Token</option>
                  </select>
                </label>
                <label>
                  <span>预计 Token</span>
                  <input
                    type="number"
                    min="2000"
                    max="60000"
                    step="1000"
                    inputMode="numeric"
                    disabled={isLocked}
                    value={draft.estimated_tokens}
                    onInput={(event) =>
                      updateDraft(
                        task.id,
                        "estimated_tokens",
                        event.currentTarget.value,
                      )
                    }
                  />
                </label>
                <label>
                  <span>预计工时</span>
                  <input
                    type="number"
                    min="0.5"
                    max="80"
                    step="0.5"
                    inputMode="decimal"
                    disabled={isLocked}
                    value={draft.estimated_hours}
                    onInput={(event) =>
                      updateDraft(
                        task.id,
                        "estimated_hours",
                        event.currentTarget.value,
                      )
                    }
                  />
                </label>
                <label class="token-forge-editor-field-wide">
                  <span>包含范围（每行一项）</span>
                  <textarea
                    rows={4}
                    disabled={isLocked}
                    value={draft.included}
                    onInput={(event) =>
                      updateDraft(
                        task.id,
                        "included",
                        event.currentTarget.value,
                      )
                    }
                  />
                </label>
                <label class="token-forge-editor-field-wide">
                  <span>非目标（每行一项）</span>
                  <textarea
                    rows={3}
                    disabled={isLocked}
                    value={draft.excluded}
                    onInput={(event) =>
                      updateDraft(
                        task.id,
                        "excluded",
                        event.currentTarget.value,
                      )
                    }
                  />
                </label>
                <label class="token-forge-editor-field-wide">
                  <span>验收标准（每行一项）</span>
                  <textarea
                    rows={4}
                    disabled={isLocked}
                    value={draft.acceptance_criteria}
                    onInput={(event) =>
                      updateDraft(
                        task.id,
                        "acceptance_criteria",
                        event.currentTarget.value,
                      )
                    }
                  />
                </label>
                <label class="token-forge-editor-field-wide">
                  <span>Agent Prompt</span>
                  <textarea
                    rows={7}
                    disabled={isLocked}
                    value={draft.prompt}
                    onInput={(event) =>
                      updateDraft(task.id, "prompt", event.currentTarget.value)
                    }
                  />
                </label>
              </div>

              <p class="token-forge-editor-dependencies">
                依赖：
                {task.dependencies.length > 0
                  ? task.dependencies.join("、")
                  : "无前置任务"}
              </p>
              <button
                class="button button--primary"
                type="button"
                disabled={isLocked}
                onClick={() =>
                  run(
                    () => updateTokenForgeEditorTask(session, task.id, draft),
                    {
                      title: "本地任务修改已应用",
                      message:
                        "任务已重新通过字段、依赖、预算、质量和导出检查。",
                    },
                  )
                }
              >
                应用此任务修改
              </button>
            </details>
          );
        })}
      </div>

      <p class="token-forge-editor-privacy">
        不写入浏览器存储或服务端；不要粘贴 Token、Cookie、Authorization
        或私有仓库内容。
      </p>
    </section>
  );
}

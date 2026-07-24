import type { ComponentChildren } from "preact";

export type StatusTone = "ready" | "info" | "warning" | "error";

type StatusNoticeProps = {
  tone: StatusTone;
  title: string;
  children: ComponentChildren;
};

const toneMetadata: Record<
  StatusTone,
  { icon: string; label: string; role: "status" | "alert" }
> = {
  ready: { icon: "✓", label: "状态", role: "status" },
  info: { icon: "i", label: "提示", role: "status" },
  warning: { icon: "!", label: "注意", role: "status" },
  error: { icon: "×", label: "错误", role: "alert" },
};

export function StatusNotice({ tone, title, children }: StatusNoticeProps) {
  const metadata = toneMetadata[tone];

  return (
    <div
      class={`status-notice status-notice--${tone}`}
      role={metadata.role}
      aria-atomic="true"
    >
      <span class="status-notice-icon" aria-hidden="true">
        {metadata.icon}
      </span>
      <div>
        <p class="status-notice-title">
          <span>{metadata.label}</span> · {title}
        </p>
        <div class="status-notice-copy">{children}</div>
      </div>
    </div>
  );
}

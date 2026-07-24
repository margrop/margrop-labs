import type { ComponentChildren } from "preact";

export type EvidenceKind = "input" | "rule" | "ai" | "unknown";

type EvidenceCardProps = {
  kind: EvidenceKind;
  title: string;
  value: string;
  children: ComponentChildren;
};

const evidenceLabels: Record<EvidenceKind, string> = {
  input: "输入证据",
  rule: "规则依据",
  ai: "AI 解释",
  unknown: "未知项",
};

export function EvidenceCard({
  kind,
  title,
  value,
  children,
}: EvidenceCardProps) {
  return (
    <article class={`evidence-card evidence-card--${kind}`}>
      <p class="evidence-kind">{evidenceLabels[kind]}</p>
      <h3>{title}</h3>
      <p class="evidence-value">{value}</p>
      <div class="evidence-copy">{children}</div>
    </article>
  );
}

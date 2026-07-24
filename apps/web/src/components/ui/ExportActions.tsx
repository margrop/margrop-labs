import { useState } from "preact/hooks";

type ExportActionsProps = {
  content: string;
  fileName: string;
};

const normalizeFileName = (fileName: string): string => {
  const normalized = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return normalized || "margrop-labs-export.md";
};

export function ExportActions({ content, fileName }: ExportActionsProps) {
  const [message, setMessage] = useState("导出只包含当前数值和可见规则结果。");

  const copyContent = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(content);
      setMessage("已复制 Markdown，可以粘贴到 Issue 或笔记中。");
    } catch {
      setMessage("复制失败，请改用下载 Markdown。");
    }
  };

  const downloadContent = () => {
    const blob = new Blob([content], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = normalizeFileName(fileName);
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Markdown 已生成并交给浏览器下载。");
  };

  return (
    <div class="export-panel">
      <div class="export-actions" aria-label="结果导出">
        <button
          class="button button--secondary button--compact"
          type="button"
          onClick={copyContent}
        >
          复制 Markdown
        </button>
        <button
          class="button button--secondary button--compact"
          type="button"
          onClick={downloadContent}
        >
          下载 Markdown
        </button>
      </div>
      <p class="export-status" role="status" aria-atomic="true">
        {message}
      </p>
    </div>
  );
}

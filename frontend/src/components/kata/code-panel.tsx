interface CodePanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  onRun: () => void;
  running: boolean;
  onLoadBroken: () => void;
  onLoadCorrect: () => void;
  activeView: "broken" | "correct" | "custom";
  maximized: boolean;
  onToggleMaximize: () => void;
}

export default function CodePanel(props: CodePanelProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      const newValue = value.substring(0, start) + "    " + value.substring(end);
      props.onCodeChange(newValue);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      props.onRun();
    }
  };

  const btnClass = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-md border transition-colors ${
      active ? "font-semibold" : ""
    }`;

  return (
    <div
      class="flex flex-col h-full"
      style={{ "background-color": "var(--bg-secondary)" }}
    >
      {/* Header */}
      <div
        class="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ "border-color": "var(--border)" }}
      >
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            Code
          </span>
          <button
            class={btnClass(props.activeView === "broken")}
            style={{
              "border-color": "var(--border)",
              color: props.activeView === "broken" ? "var(--error)" : "var(--text-muted)",
              "background-color": props.activeView === "broken" ? "var(--bg-tertiary)" : "transparent",
            }}
            onClick={props.onLoadBroken}
          >
            Broken
          </button>
          <button
            class={btnClass(props.activeView === "correct")}
            style={{
              "border-color": "var(--border)",
              color: props.activeView === "correct" ? "var(--success)" : "var(--text-muted)",
              "background-color": props.activeView === "correct" ? "var(--bg-tertiary)" : "transparent",
            }}
            onClick={props.onLoadCorrect}
          >
            Correct
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1 text-xs font-medium rounded-md text-white transition-colors"
            style={{
              "background-color": props.running ? "var(--text-muted)" : "var(--accent)",
            }}
            onClick={props.onRun}
            disabled={props.running}
          >
            {props.running ? "Running..." : "Run ▶"}
          </button>
          <button
            class="w-7 h-7 flex items-center justify-center rounded-md border text-xs"
            style={{
              "border-color": "var(--border)",
              color: "var(--text-muted)",
            }}
            onClick={props.onToggleMaximize}
            title={props.maximized ? "Restore" : "Maximize"}
          >
            {props.maximized ? "⊡" : "⊞"}
          </button>
        </div>
      </div>

      {/* Textarea */}
      <textarea
        class="flex-1 w-full resize-none p-4 outline-none border-none"
        style={{
          "background-color": "var(--bg-code)",
          color: "var(--text-primary)",
          "font-family": "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
          "font-size": "0.875rem",
          "line-height": "1.5",
          "tab-size": "4",
        }}
        value={props.code}
        onInput={(e) => props.onCodeChange(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        spellcheck={false}
      />
    </div>
  );
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  success: boolean;
  execution_time_ms: number;
  error?: string;
}

interface OutputPanelProps {
  result: ExecutionResult | null;
  running: boolean;
  maximized: boolean;
  onToggleMaximize: () => void;
}

export default function OutputPanel(props: OutputPanelProps) {
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
            Output
          </span>
          {props.result && (
            <span class="text-xs" style={{ color: "var(--text-muted)" }}>
              {props.result.execution_time_ms}ms
            </span>
          )}
        </div>
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

      {/* Output area */}
      <div
        class="flex-1 overflow-y-auto p-4"
        style={{
          "font-family": "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
          "font-size": "0.875rem",
          "line-height": "1.5",
          "background-color": "var(--bg-code)",
        }}
      >
        {props.running ? (
          <span style={{ color: "var(--text-muted)" }}>Running...</span>
        ) : props.result ? (
          <>
            {props.result.stdout && (
              <pre class="m-0 whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                {props.result.stdout}
              </pre>
            )}
            {props.result.stderr && (
              <pre class="m-0 whitespace-pre-wrap" style={{ color: "var(--error)" }}>
                {props.result.stderr}
              </pre>
            )}
            {props.result.error && (
              <pre class="m-0 whitespace-pre-wrap italic" style={{ color: "var(--error)" }}>
                {props.result.error}
              </pre>
            )}
            <div
              class="mt-3 pt-3 border-t text-xs"
              style={{
                "border-color": "var(--border)",
                color: props.result.success ? "var(--success)" : "var(--error)",
              }}
            >
              {props.result.success ? "Exited successfully" : "Exited with error"}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>
            Click Run or press Ctrl+Enter to execute your code.
          </span>
        )}
      </div>
    </div>
  );
}

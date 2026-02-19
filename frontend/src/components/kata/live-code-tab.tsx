import { createSignal, createEffect, Show } from "solid-js";
import CodePanel from "./code-panel";
import OutputPanel from "./output-panel";
import ResizeHandle from "./resize-handle";
import { apiPost } from "../../lib/api-client";

interface ExecutionResult {
  stdout: string;
  stderr: string;
  success: boolean;
  execution_time_ms: number;
  error?: string;
}

interface Kata {
  broken_code: string;
  correct_code: string;
  explanation: string;
  design_tradeoff: string;
}

interface LiveCodeTabProps {
  kata: Kata;
}

export default function LiveCodeTab(props: LiveCodeTabProps) {
  const [code, setCode] = createSignal("");
  const [result, setResult] = createSignal<ExecutionResult | null>(null);
  const [running, setRunning] = createSignal(false);
  const [activeView, setActiveView] = createSignal<"broken" | "correct" | "custom">("broken");
  const [maximized, setMaximized] = createSignal<"code" | "output" | null>(null);
  const [splitRatio, setSplitRatio] = createSignal(0.5);
  const [showExplanation, setShowExplanation] = createSignal(false);
  const [showTradeoff, setShowTradeoff] = createSignal(false);

  // Load broken code when kata changes
  createEffect(() => {
    const kata = props.kata;
    if (kata) {
      setCode(kata.broken_code);
      setActiveView("broken");
      setResult(null);
    }
  });

  const loadBroken = () => {
    setCode(props.kata.broken_code);
    setActiveView("broken");
  };

  const loadCorrect = () => {
    setCode(props.kata.correct_code);
    setActiveView("correct");
  };

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    if (activeView() !== "custom") setActiveView("custom");
  };

  const runCode = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await apiPost<ExecutionResult>("/playground/run", { code: code() });
      setResult(res);
    } catch {
      setResult({
        stdout: "",
        stderr: "",
        success: false,
        execution_time_ms: 0,
        error: "Failed to connect to the server.",
      });
    } finally {
      setRunning(false);
    }
  };

  // Resize logic
  let containerRef: HTMLDivElement | undefined;
  const handleMouseDown = () => {
    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div class="flex flex-col flex-1 overflow-hidden">
      {/* Panels */}
      <div class="flex flex-1 overflow-hidden" ref={containerRef}>
        <Show when={maximized() !== "output"}>
          <div
            class="overflow-hidden"
            style={{
              "flex-basis": maximized() === "code" ? "100%" : `${splitRatio() * 100}%`,
              "flex-grow": maximized() === "code" ? "1" : "0",
              "flex-shrink": "0",
            }}
          >
            <CodePanel
              code={code()}
              onCodeChange={handleCodeChange}
              onRun={runCode}
              running={running()}
              onLoadBroken={loadBroken}
              onLoadCorrect={loadCorrect}
              activeView={activeView()}
              maximized={maximized() === "code"}
              onToggleMaximize={() =>
                setMaximized((prev) => (prev === "code" ? null : "code"))
              }
            />
          </div>
        </Show>

        <Show when={!maximized()}>
          <ResizeHandle onMouseDown={handleMouseDown} />
        </Show>

        <Show when={maximized() !== "code"}>
          <div
            class="overflow-hidden flex-1"
            style={{
              "flex-basis": maximized() === "output" ? "100%" : undefined,
            }}
          >
            <OutputPanel
              result={result()}
              running={running()}
              maximized={maximized() === "output"}
              onToggleMaximize={() =>
                setMaximized((prev) => (prev === "output" ? null : "output"))
              }
            />
          </div>
        </Show>
      </div>

      {/* Spoiler sections */}
      <div
        class="border-t shrink-0 overflow-y-auto"
        style={{
          "border-color": "var(--border)",
          "background-color": "var(--bg-secondary)",
          "max-height": "200px",
        }}
      >
        <Show when={props.kata.explanation}>
          <div class="border-b" style={{ "border-color": "var(--border)" }}>
            <button
              class="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-left"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => setShowExplanation((p) => !p)}
            >
              <span
                class="transition-transform duration-150"
                style={{ transform: showExplanation() ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▶
              </span>
              Explanation
            </button>
            <Show when={showExplanation()}>
              <div
                class="px-4 pb-3 text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {props.kata.explanation}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={props.kata.design_tradeoff}>
          <div>
            <button
              class="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-left"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => setShowTradeoff((p) => !p)}
            >
              <span
                class="transition-transform duration-150"
                style={{ transform: showTradeoff() ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▶
              </span>
              Design Tradeoff
            </button>
            <Show when={showTradeoff()}>
              <div
                class="px-4 pb-3 text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {props.kata.design_tradeoff}
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

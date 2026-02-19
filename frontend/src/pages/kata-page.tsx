import { createResource, createSignal, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { apiGet } from "../lib/api-client";
import DescriptionPanel from "../components/kata/description-panel";
import LiveCodeTab from "../components/kata/live-code-tab";

interface Kata {
  id: string;
  phase: number;
  phase_title: string;
  sequence: number;
  title: string;
  description: string;
  broken_code: string;
  correct_code: string;
  explanation: string;
  design_tradeoff: string;
}

export default function KataPage() {
  const params = useParams();
  const [activeTab, setActiveTab] = createSignal<"description" | "code">("description");

  const [kata] = createResource(
    () => params.kataId,
    (id) => apiGet<Kata>(`/katas/${id}`)
  );

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      active ? "border-current" : "border-transparent"
    }`;

  return (
    <div class="flex flex-col flex-1 overflow-hidden">
      <Show when={kata.loading}>
        <div class="flex-1 flex items-center justify-center">
          <span style={{ color: "var(--text-muted)" }}>Loading kata...</span>
        </div>
      </Show>

      <Show when={kata.error}>
        <div class="flex-1 flex items-center justify-center">
          <span style={{ color: "var(--error)" }}>Failed to load kata.</span>
        </div>
      </Show>

      <Show when={kata()}>
        {(k) => (
          <>
            {/* Kata header with tabs */}
            <div
              class="flex items-center justify-between px-4 border-b shrink-0"
              style={{
                "border-color": "var(--border)",
                "background-color": "var(--bg-secondary)",
              }}
            >
              <div class="flex items-center gap-4">
                <span class="text-xs" style={{ color: "var(--text-muted)" }}>
                  Phase {k().phase}
                </span>
                <span
                  class="text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {k().sequence}. {k().title}
                </span>
              </div>
              <div class="flex">
                <button
                  class={tabClass(activeTab() === "description")}
                  style={{
                    color:
                      activeTab() === "description"
                        ? "var(--accent)"
                        : "var(--text-muted)",
                  }}
                  onClick={() => setActiveTab("description")}
                >
                  Description
                </button>
                <button
                  class={tabClass(activeTab() === "code")}
                  style={{
                    color:
                      activeTab() === "code"
                        ? "var(--accent)"
                        : "var(--text-muted)",
                  }}
                  onClick={() => setActiveTab("code")}
                >
                  Live Code
                </button>
              </div>
            </div>

            {/* Tab content */}
            <Show when={activeTab() === "description"}>
              <DescriptionPanel description={k().description} />
            </Show>

            <Show when={activeTab() === "code"}>
              <LiveCodeTab kata={k()} />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

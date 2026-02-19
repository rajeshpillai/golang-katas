import TrackCard from "../components/landing/track-card";
import ThemeToggle from "../components/layout/theme-toggle";

export default function Landing() {
  return (
    <div
      class="min-h-screen flex flex-col items-center justify-center p-8"
      style={{ "background-color": "var(--bg-primary)" }}
    >
      <div class="absolute top-6 right-6">
        <ThemeToggle />
      </div>

      <div class="text-center mb-12 max-w-xl">
        <h1
          class="text-4xl font-bold mb-3"
          style={{ color: "var(--text-primary)" }}
        >
          Golang Katas
        </h1>
        <p class="text-lg" style={{ color: "var(--text-secondary)" }}>
          A language of clarity, discipline, and concurrency.
          <br />
          Learn Go through deliberate practice.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl w-full">
        <TrackCard
          title="Katas"
          description="A structured learning sequence across 17 phases — from syntax basics to advanced systems patterns. Each kata includes explanations, broken code, and idiomatic solutions."
          status="active"
          href="/katas"
          icon="🥋"
        />
        <TrackCard
          title="Applications"
          description="Real-world Go applications and system projects. Build production-grade services using the patterns learned in the katas."
          status="coming-soon"
          icon="🚀"
        />
      </div>
    </div>
  );
}

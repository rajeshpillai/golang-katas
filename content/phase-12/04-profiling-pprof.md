---
id: profiling-pprof
phase: 12
phase_title: Memory, Performance & GC Awareness
sequence: 4
title: Profiling (pprof)
---

## Description

### Concept Overview

You cannot optimize what you cannot see. The most important rule of performance work in Go is: **measure first, then optimize.** Guessing where a program spends its time or its memory is almost always wrong — the real hot spot is rarely where intuition points. Go ships with first-class profiling tools, collectively known as **pprof**, that tell you exactly where the CPU cycles and the heap allocations are going.

There are two profiles you will reach for constantly: the **CPU profile**, which samples where your program spends execution time, and the **heap (memory) profile**, which records where allocations happen. Together they answer the two questions that drive almost all optimization: "what is slow?" and "what is allocating?" This kata covers the profiling *workflow* — how to collect, read, and act on these profiles — and shows how to inspect the same underlying runtime memory statistics programmatically.

### Technical Explanation

**How CPU profiling works.** When you enable a CPU profile, the Go runtime sets a timer that interrupts the program ~100 times per second. At each interrupt it records the current call stack of every running goroutine. After collection, pprof aggregates these samples: a function that appears in 30% of samples was, statistically, using ~30% of the CPU. This is *sampling*, not exhaustive tracing, so it has low overhead and is safe to run on real workloads — but it means very short or very rare functions may not show up.

**How heap profiling works.** The heap profile records a sample of allocation events along with the call stack that made them. By default it samples roughly one allocation per 512 KB allocated (controlled by `runtime.MemProfileRate`). It can report two things: `inuse_space`/`inuse_objects` (memory still live at the moment of the snapshot — good for finding leaks and bloat) and `alloc_space`/`alloc_objects` (cumulative allocation over the program's life — good for finding allocation churn that pressures the GC).

**Collecting profiles — two paths.**

The first path is via the **`runtime/pprof`** package, writing a profile to a file from inside `main`:

```go
f, _ := os.Create("cpu.prof")
pprof.StartCPUProfile(f)
defer pprof.StopCPUProfile()
// ... run the workload ...
```

For a heap profile you instead call `pprof.WriteHeapProfile(f)` after the workload.

The second path is via **`net/http/pprof`**, which you import for its side effects in a long-running server:

```go
import _ "net/http/pprof"
// then the server exposes /debug/pprof/ endpoints
```

This exposes live CPU and heap profiles over HTTP, ideal for profiling production services on demand.

**Analyzing profiles.** You feed a collected profile to the tool:

```text
go tool pprof cpu.prof
```

Inside the interactive prompt, the essential commands are:

- `top` — the functions consuming the most resource, sorted. Look at *flat* (time in the function itself) vs *cum* (time in it plus everything it calls).
- `list <FuncName>` — annotates the function's source line-by-line with cost, so you see the exact expensive line.
- `web` — renders a call graph (requires Graphviz), giving a visual map of where cost concentrates.
- `peek <Func>` — shows callers and callees of a function.

A typical workflow: run `top` to find the heaviest function, `list` it to find the heavy line, change the code, re-profile, and confirm the cost moved.

**Benchmark-driven profiling.** You rarely need to hand-write profiling code, because `go test` collects profiles from benchmarks directly:

```text
go test -bench=. -benchmem -cpuprofile cpu.prof -memprofile mem.prof
```

This runs your benchmarks, reports `ns/op`, `B/op`, and `allocs/op`, *and* writes profiles you can open with `go tool pprof`. This is the canonical Go optimization loop.

**Reading runtime stats programmatically.** Even without the `go tool` workflow, `runtime.ReadMemStats` exposes the same underlying accounting the heap profiler builds on — `Mallocs`, `Frees`, `HeapAlloc`, `TotalAlloc`, `NumGC` — letting you assert allocation behavior inside a program or a test.

### Design Rationale

Profiling is built into the Go toolchain and standard library, not bolted on as a third-party add-on. That is a deliberate statement of values: the Go team considers performance measurement a *core, everyday activity*, not an expert-only ritual. Compare this with ecosystems where profiling requires commercial tools, agent installs, or complex setup; in Go, `go test -cpuprofile` and `go tool pprof` are always available, on every machine, for free.

The choice of **sampling** over exhaustive instrumentation is also principled. A sampling CPU profiler adds only a few percent overhead, so you can profile realistic — even production — workloads without distorting them. Exhaustive tracing would give perfect data but slow the program so much that the measurement no longer reflects reality. Go optimizes for *representative* data at low cost, which is almost always what you actually want.

Exposing profiles over HTTP via `net/http/pprof` reflects Go's server-first heritage. Long-running services are the bread and butter of Go, and being able to point `go tool pprof` at a live production endpoint — `/debug/pprof/profile` for CPU, `/debug/pprof/heap` for memory — without redeploying is enormously valuable for diagnosing real incidents. The design assumes you will need to understand a running system, not just a benchmark.

Most of all, pprof exists to enforce the cultural rule "measure, don't guess." By making measurement frictionless, Go removes every excuse for optimizing blind. The language's whole performance philosophy — write simple code, profile, optimize only the proven hot spot — depends on the tooling being so easy that profiling is the default first step, not a last resort.

### Common Mistakes

- **Optimizing before profiling.** The cardinal sin. You spend days speeding up a function that was 2% of runtime while the real 60% bottleneck sits untouched. Always profile *first* to find where the cost actually is.

- **Profiling a workload that does not represent production.** A profile of a toy input, or a benchmark that does not exercise the real code path, points you at the wrong functions. Profile something that looks like your actual load, with realistic data sizes.

- **Confusing `flat` with `cum` in `top` output.** `flat` is time spent *in* the function itself; `cum` includes everything it calls. A function with huge `cum` but tiny `flat` is just a caller — the real cost is deeper. Drilling into the wrong column sends you chasing the wrong code.

- **Confusing `inuse` with `alloc` in heap profiles.** `inuse_space` finds what is *currently* holding memory (leaks, bloat). `alloc_space` finds *cumulative* churn (GC pressure). Using the wrong one means you optimize the wrong problem — e.g., chasing churn when you have a retention leak.

- **Trusting a single noisy run.** CPU profiles are statistical. One short run can be dominated by scheduling noise or a cold cache. Run long enough to gather many samples, and re-run to confirm a result before acting on it.

### Key Takeaways

- **Measure first, optimize second** — the real hot spot is almost never where you guess.
- The **CPU profile** (sampled stacks) answers "what is slow"; the **heap profile** answers "what allocates," with `inuse_*` for leaks and `alloc_*` for churn.
- Collect profiles via `runtime/pprof` (files), `net/http/pprof` (live servers), or — most commonly — `go test -cpuprofile/-memprofile`.
- Analyze with `go tool pprof`: `top` to rank, `list` to find the costly line, `web` for the call graph; mind `flat` vs `cum`.
- `runtime.ReadMemStats` exposes the same allocation accounting programmatically, letting you assert behavior in code and tests.
- Profiling is built into the toolchain on purpose — it makes "don't guess" the cheap, default path.

---

## Broken Code

```go
// broken: "optimizing" by guesswork, with no measurement at all.
// The author assumed string concatenation in `slow` was the bottleneck
// and hand-tuned it, but never profiled — so they cannot even tell which
// function dominates, nor whether their change helped.
package main

import (
	"fmt"
	"strings"
)

// Guessed to be the hot spot — but is it? Nobody measured.
func slow(n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += strings.Repeat("x", 8) // O(n^2) churn, but is it the bottleneck?
	}
	return out
}

func main() {
	// No profiling enabled, no benchmark, no MemStats. The developer will
	// "optimize" blind and have no evidence about where time actually goes.
	s := slow(20000)
	fmt.Println("length:", len(s))
}
```

---

## Correct Code

```go
// correct: measure allocations with runtime.MemStats, then act on evidence.
// We instrument two implementations of the same task and compare their
// allocation cost directly, demonstrating the measure-first workflow that
// pprof formalizes. (In real projects, prefer `go test -bench -benchmem
// -cpuprofile -memprofile` plus `go tool pprof`.)
package main

import (
	"fmt"
	"runtime"
	"strings"
)

// measure runs fn and reports allocations and bytes it caused.
func measure(label string, fn func()) {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)

	fn()

	runtime.ReadMemStats(&after)
	fmt.Printf("%-18s allocs=%-8d bytes=%d KB\n",
		label, after.Mallocs-before.Mallocs, (after.TotalAlloc-before.TotalAlloc)/1024)
}

// naive: repeated string concatenation reallocates the whole string each time.
func naive(n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += "xxxxxxxx"
	}
	return out
}

// tuned: a strings.Builder grows one backing buffer amortized, far fewer allocs.
func tuned(n int) string {
	var b strings.Builder
	b.Grow(n * 8) // preallocate the expected final size
	for i := 0; i < n; i++ {
		b.WriteString("xxxxxxxx")
	}
	return b.String()
}

func main() {
	const n = 20000

	var s1, s2 string
	measure("naive concat", func() { s1 = naive(n) })
	measure("strings.Builder", func() { s2 = tuned(n) })

	fmt.Println("\nsame result:", len(s1) == len(s2), "length:", len(s1))
	fmt.Println("\nWorkflow: profile -> find hot line -> fix -> re-measure.")
	fmt.Println("Real loop: go test -bench=. -benchmem -cpuprofile cpu.prof")
	fmt.Println("           go tool pprof cpu.prof   (then: top, list, web)")
}
```

---

## Explanation

The broken version is the anti-pattern this kata exists to prevent: optimization by guessing. The author *assumed* the string building in `slow` was the bottleneck and rewrote it, but enabled no profiling, wrote no benchmark, and read no stats. They have no evidence about where time actually goes, no baseline to compare against, and no way to know whether their change helped, hurt, or did nothing. They are optimizing blind.

The correct version models the measure-first workflow. The `measure` helper brackets a function with `runtime.ReadMemStats`, reporting the exact allocation count and bytes that function caused — the same accounting the heap profiler is built on. Running it against `naive` (repeated `+=` concatenation, which reallocates and copies the entire growing string each iteration) versus `tuned` (a `strings.Builder` with `Grow` preallocating the final size) produces hard numbers: the builder version shows a dramatically lower `allocs` and `bytes` figure for identical output. Now the decision rests on evidence, not intuition.

The comments make explicit that in a real project you would reach for the full pprof loop — `go test -bench=. -benchmem -cpuprofile cpu.prof -memprofile mem.prof`, then `go tool pprof` with `top`, `list`, and `web` to locate the precise hot line in the call graph. This kata uses `MemStats` because it runs self-contained and quickly, but the *workflow* is identical: establish a baseline, find the real hot spot, change one thing, and re-measure to confirm the win.

---

## Design Tradeoff

Profiling has a cost — sampling adds a few percent of overhead, profiles take time to collect and read, and acting on them means slowing down to gather evidence before touching code. The temptation is always to skip it and just "fix the obvious slow part." But that shortcut trades a few minutes of measurement for hours of optimizing the wrong thing, which is the worse deal almost every time. Go makes the measurement so cheap and built-in that the trade overwhelmingly favors profiling first.

The deeper tradeoff is *representativeness versus precision*. Sampling profilers give you statistically representative data at low overhead, but they will miss very short or very rare functions, and a single noisy run can mislead. The discipline is to profile realistic workloads, run long enough to gather many samples, read `flat` versus `cum` and `inuse` versus `alloc` correctly, and confirm a result before committing to it. Done that way, pprof turns performance work from guesswork into engineering — which is exactly the culture Go's built-in tooling is designed to create.

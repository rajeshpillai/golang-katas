---
id: benchmarks
phase: 8
phase_title: Testing & Tooling
sequence: 4
title: Benchmarks
---

## Description

### Concept Overview

A benchmark measures how fast a piece of code runs and how much memory it allocates. In Go, benchmarks live in the same `_test.go` files as your tests, use the same `go test` command, and follow a signature that mirrors tests almost exactly: `func BenchmarkXxx(b *testing.B)`. The single most important rule is that your benchmarked operation must run inside a loop that iterates `b.N` times. The framework — not you — chooses `b.N`, increasing it until the measurement is statistically stable, and then reports nanoseconds per operation.

Benchmarks turn performance from a guess into a measurement. Instead of reasoning about which implementation "feels faster," you write both, benchmark both, and read the numbers. Combined with `-benchmem`, a benchmark also reports allocations per operation, which is often the real story behind Go performance: allocations create garbage-collector pressure, and reducing them is frequently a bigger win than shaving CPU cycles.

### Technical Explanation

A benchmark has this signature, and its body must drive the operation `b.N` times:

```go
func BenchmarkJoin(b *testing.B) {
    parts := []string{"a", "b", "c", "d", "e"}
    for i := 0; i < b.N; i++ {
        _ = strings.Join(parts, ",")
    }
}
```

The control flow is the crux. `b.N` starts small (often 1) and the framework re-runs the benchmark with ever-larger `b.N` until the run lasts long enough (by default about one second) to produce a stable per-operation time. You never set `b.N` yourself; you only loop over it. If you ignore `b.N` and run the operation once, the framework cannot calibrate and your number is meaningless.

Critical methods and patterns on `*testing.B`:

- **`b.ResetTimer()`** — discards everything timed so far. Use it after expensive setup that should not count toward the measurement: build your input, then call `b.ResetTimer()` immediately before the `for i := 0; i < b.N; i++` loop.
- **`b.StopTimer()` / `b.StartTimer()`** — pause and resume the clock around per-iteration setup you do not want measured. Use sparingly; frequent stop/start adds overhead and noise.
- **`b.ReportAllocs()`** — forces allocation reporting for this benchmark even without the `-benchmem` flag.
- **`b.Run(name, fn)`** — sub-benchmarks, the benchmark analogue of `t.Run`, ideal for benchmarking the same operation across input sizes.
- **`b.Helper()`** — like `t.Helper()`, marks a helper so failure locations point at the caller.

You run benchmarks with `go test -bench=.` (the `-bench` flag takes a regexp; `.` matches all). Tests still run too unless you add `-run=^$` to skip them. Add `-benchmem` to see allocations:

```
go test -bench=. -benchmem
BenchmarkJoin-8    20000000    65.4 ns/op    16 B/op    1 allocs/op
```

Reading that line: `-8` is `GOMAXPROCS`; `20000000` is the final `b.N`; `65.4 ns/op` is nanoseconds per operation; `16 B/op` is bytes allocated per operation; `1 allocs/op` is the number of heap allocations per operation. Use `-benchtime=5s` or `-benchtime=100000x` to control duration or iteration count, and `-count=5` to run multiple rounds for variance analysis (feed the output to `benchstat` for a statistical comparison between two implementations).

One subtle but essential trap: the compiler may delete code whose result you never use ("dead-code elimination"), making a benchmark measure nothing. Assign the result to a package-level variable (a "sink") to keep the work alive:

```go
var sink string

func BenchmarkJoin(b *testing.B) {
    parts := []string{"a", "b", "c"}
    var s string
    for i := 0; i < b.N; i++ {
        s = strings.Join(parts, ",")
    }
    sink = s // prevent the optimizer from eliding the work
}
```

### Design Rationale

Go folds benchmarking into the same toolchain as testing for the same reason it folds in testing: performance work should be routine, reproducible, and require no extra dependency. In many ecosystems, microbenchmarking needs a separate framework — JMH for Java (with its own annotations, warmup phases, and runner), `pytest-benchmark` or `timeit` for Python, criterion for Rust. Go gives you `func BenchmarkXxx(b *testing.B)` next to your tests and one flag, `-bench`. The `b.N` design specifically solves the calibration problem that ad-hoc timing code gets wrong: a naive "start clock, run once, stop clock" measures a single noisy sample dominated by warmup and scheduling jitter. By letting the framework scale `b.N` until the run is long enough, Go produces a stable per-operation figure automatically, the same way JMH's iteration counts do but without the ceremony.

Reporting allocations alongside time reflects a Go-specific priority. Because Go is garbage-collected, allocation count is often the lever that matters most for latency and throughput — fewer allocations mean less GC work and less pause. Surfacing `B/op` and `allocs/op` as first-class output nudges you to optimize the thing that usually counts, not just raw CPU time. And by making benchmarks ordinary functions in ordinary files, Go keeps them under version control next to the code they measure, so a performance regression is something a teammate can rerun and a CI pipeline (via `benchstat`) can flag.

### Common Mistakes

**Not looping over `b.N`.** Running the operation once (or a fixed number of times) defeats the framework's calibration. The reported `ns/op` becomes nonsense because the framework divides total time by an iteration count your code did not actually honor. Every benchmark must contain `for i := 0; i < b.N; i++`.

**Letting the optimizer delete the work.** If the benchmarked expression's result is never used, the compiler may eliminate it entirely, and you measure an empty loop reporting an implausible sub-nanosecond time. Store the result in a package-level sink variable (or otherwise consume it) so the work cannot be elided.

**Timing the setup.** Building a large input inside the function but before the loop counts that one-time cost in some measurements and skews small benchmarks. Do setup first, then call `b.ResetTimer()` immediately before the `b.N` loop so only the operation under test is timed.

**Overusing `b.StopTimer`/`b.StartTimer` inside the hot loop.** Pausing the timer every iteration for per-iteration setup adds measurable overhead and noise, and can dominate fast operations. Prefer precomputing inputs outside the loop; reach for stop/start only when per-iteration setup is unavoidable.

**Trusting a single run.** One benchmark run is one noisy sample. Background load, CPU frequency scaling, and GC timing all perturb it. Run with `-count=5` (or more) and compare implementations with `benchstat`, which reports the mean and whether the difference is statistically significant rather than letting you fixate on a one-off number.

### Key Takeaways

- A benchmark is `func BenchmarkXxx(b *testing.B)` and must run the operation inside `for i := 0; i < b.N; i++` — the framework chooses `b.N`, you only loop over it.
- Run with `go test -bench=.`; add `-benchmem` to see `B/op` and `allocs/op`, which often matter more than raw time in garbage-collected Go.
- Call `b.ResetTimer()` after setup so one-time costs are not measured.
- Store results in a package-level sink to stop the compiler from eliminating the very work you are timing.
- Use sub-benchmarks (`b.Run`) to sweep input sizes, and `-count` plus `benchstat` to get statistically meaningful comparisons.
- A single run is a noisy sample — repeat and compare rather than trusting one number.

---

## Broken Code

```go
// broken: this benchmark ignores b.N and discards its result
package strx

import (
    "strings"
    "testing"
)

func BenchmarkJoin(b *testing.B) {
    parts := []string{"a", "b", "c", "d", "e"}

    // Bug 1: runs the operation exactly once instead of looping b.N times,
    // so the framework cannot calibrate and ns/op is meaningless.
    // Bug 2: the result is thrown away, so the compiler may delete the call
    // entirely (dead-code elimination), measuring nothing.
    _ = strings.Join(parts, ",")
}

// Bug 3: building a big input INSIDE the (missing) measured region would also
// time the setup. Even here, there is no b.ResetTimer to exclude setup cost.
func BenchmarkJoinBig(b *testing.B) {
    parts := make([]string, 10000)
    for i := range parts {
        parts[i] = "x"
    }
    // setup above is untimed only by luck; with a real b.N loop it must be
    // separated with b.ResetTimer() before the loop.
    _ = strings.Join(parts, ",")
}
```

---

## Correct Code

```go
// correct: runnable demonstration of the b.N looping discipline and a sink.
// NOTE: run with `go run`. A real benchmark uses *testing.B and `go test
// -bench`; here we mimic the b.N loop and a sink, and time it ourselves to
// show the per-operation reasoning that testing.B automates.
package main

import (
    "fmt"
    "strings"
    "time"
)

// sink prevents the compiler from eliminating the work we are measuring,
// exactly as a package-level sink does in a real benchmark.
var sink string

// benchmarkJoin mimics func BenchmarkJoin(b *testing.B): it runs the operation
// n times (n plays the role of b.N) and returns nanoseconds per operation.
func benchmarkJoin(parts []string, n int) float64 {
    var s string
    start := time.Now()
    for i := 0; i < n; i++ { // the mandatory b.N-style loop
        s = strings.Join(parts, ",")
    }
    elapsed := time.Since(start)
    sink = s // consume the result so it cannot be optimized away
    return float64(elapsed.Nanoseconds()) / float64(n)
}

func main() {
    parts := []string{"a", "b", "c", "d", "e"}

    // testing.B grows b.N until the run is stable; we emulate that by trying
    // increasing iteration counts and watching ns/op settle.
    fmt.Println("emulating b.N calibration (ns/op should stabilize):")
    var last float64
    for _, n := range []int{1000, 100000, 1000000} {
        nsPerOp := benchmarkJoin(parts, n)
        fmt.Printf("  N=%-8d  %.2f ns/op\n", n, nsPerOp)
        last = nsPerOp
    }

    fmt.Println()
    // A crude sanity check: the per-op cost should be a small, positive number.
    // If the work had been optimized away, this would be implausibly ~0.
    if last > 0 && last < 100000 {
        fmt.Printf("PASS: measured a plausible %.2f ns/op (work was not elided)\n", last)
    } else {
        fmt.Printf("FAIL: implausible %.2f ns/op — check for dead-code elimination\n", last)
    }
    fmt.Printf("sink length kept alive: %d\n", len(sink))
}
```

---

## Explanation

The broken version makes the two classic benchmarking errors at once. It calls `strings.Join` a single time rather than looping over `b.N`, so the `testing` framework has nothing to calibrate — it cannot scale the iteration count to a stable measurement, and any `ns/op` it would print is divided by an iteration count the code never honored. On top of that, the result is assigned to the blank identifier and never used, which invites the compiler to delete the call outright as dead code, leaving the benchmark measuring an empty loop. The second function compounds the problem by mixing input setup with the (absent) measured region, with no `b.ResetTimer()` to keep one-time costs out of the timing.

The correct version, adapted to run under `go run`, preserves the disciplines that a real `*testing.B` benchmark depends on. The operation runs inside an `n`-iteration loop where `n` plays the role of `b.N`, and the result is written to a package-level `sink` so the optimizer cannot elide the work — without that sink, the whole measurement would be a lie. By trying increasing iteration counts and printing `ns/op` for each, the snippet mirrors what `testing.B` does internally when it grows `b.N` until the per-operation cost stabilizes.

In a genuine `_test.go` file you would not hand-roll the timing at all: you would write `func BenchmarkJoin(b *testing.B)`, loop `for i := 0; i < b.N; i++`, and let `go test -bench=. -benchmem` report `ns/op`, `B/op`, and `allocs/op`. The hand-timed version here exists only to make the mechanics visible — the loop over a framework-chosen iteration count, and the sink that keeps the work real.

---

## Design Tradeoff

Putting benchmarks in the toolchain with the `b.N` model trades a little conceptual overhead — you must understand why you loop over a count you do not set — for measurements that are stable and reproducible without a separate framework. Hand-rolled timing with `time.Now()` is simpler to grasp but notoriously misleading: it captures warmup, scheduler jitter, and GC timing in a single sample. The `b.N` approach amortizes those away by running enough iterations to converge, the same insight JMH and criterion encode, but delivered through one flag rather than a dependency and a set of annotations.

The cost is that benchmarks are easy to write *wrong* in ways that still produce a confident-looking number. A missing sink, a single un-looped call, or setup leaking into the timed region all yield plausible output that is quietly meaningless. Go's design surfaces the right primitives (`b.N`, `b.ResetTimer`, `b.ReportAllocs`, sub-benchmarks) but cannot stop you from misusing them, so the discipline shifts to the author: loop over `b.N`, consume your results, reset the timer after setup, and never trust a single run. The payoff for that discipline is performance work that lives in version control, reruns on demand, and compares rigorously via `benchstat` — performance as evidence rather than folklore.

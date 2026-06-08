---
id: garbage-collection-basics
phase: 12
phase_title: Memory, Performance & GC Awareness
sequence: 2
title: Garbage Collection Basics
---

## Description

### Concept Overview

Go is a garbage-collected language. When you allocate a value on the heap, you never free it explicitly — there is no `free`, no `delete`, no `Dispose`. Instead, a background process called the **garbage collector (GC)** periodically determines which heap values are still reachable from your running program and reclaims the memory of everything else. This is what lets you write `p := &Thing{}`, hand `p` around freely, and never worry about who owns it or when to release it.

The GC is not magic and it is not free. It runs concurrently with your program, using CPU and occasionally pausing goroutines for very short windows. Understanding *how* it works — and the one knob, `GOGC`, that controls how often it runs — turns the GC from a mysterious source of latency spikes into a predictable, tunable part of your system.

### Technical Explanation

Go uses a **concurrent, tri-color, mark-and-sweep** garbage collector. Let us unpack each word.

**Mark-and-sweep** is the core algorithm. In the *mark* phase, the GC starts from a set of *roots* — goroutine stacks, global variables, registers — and traverses every pointer it can reach, marking each live object. Anything not marked is, by definition, unreachable: no live part of the program can ever touch it again. In the *sweep* phase, the GC reclaims the memory of those unmarked objects, returning it to the allocator for reuse.

**Tri-color** describes how marking proceeds safely while the program runs. Objects are conceptually colored white (not yet examined), grey (reachable but its children not yet scanned), or black (reachable and fully scanned). The GC moves objects from white to grey to black until no grey objects remain; whatever stays white is garbage. A **write barrier** — a tiny piece of code the compiler inserts around pointer writes — ensures that if your program mutates pointers mid-collection, the GC does not miss a newly-reachable object.

**Concurrent** is the key to Go's low latency. The marking work happens *while your goroutines keep running*, on separate GC worker goroutines. Go does not use a long stop-the-world pause to trace the whole heap. Instead it briefly stops the world only to set up and finish a cycle — pauses that are typically well under a millisecond. This is a deliberate design goal: Go optimizes for **short pause times**, accepting somewhat higher CPU overhead and throughput cost in exchange.

**The GC pacer and `GOGC`.** The GC does not run on a timer; it runs based on *heap growth*. The `GOGC` environment variable (default `100`) sets the trade-off. `GOGC=100` means: let the heap grow to **100% larger** than the live heap size after the last collection before starting the next collection. So if 4 MB survived the last GC, the next cycle triggers around 8 MB of total heap. Setting `GOGC=200` lets the heap grow more between collections — fewer, less frequent GC cycles, lower CPU overhead, but higher peak memory. Setting `GOGC=50` collects more aggressively — more frequent cycles, lower peak memory, more CPU spent collecting. Setting `GOGC=off` disables the GC entirely (rarely a good idea).

You can set it at runtime:

```go
import "runtime/debug"
debug.SetGCPercent(200) // equivalent to GOGC=200
```

**Observing the GC.** The `runtime.MemStats` struct exposes the GC's behavior. Key fields:

- `NumGC` — total number of completed GC cycles.
- `HeapAlloc` — bytes of allocated, still-reachable heap objects.
- `TotalAlloc` — cumulative bytes ever allocated (only grows).
- `Mallocs` / `Frees` — cumulative count of objects allocated and freed.
- `PauseTotalNs` — cumulative stop-the-world pause time.
- `NextGC` — heap size target that will trigger the next collection.

You can also run with `GODEBUG=gctrace=1` to print a line per GC cycle showing pause times, heap sizes, and CPU usage.

**Forcing a collection.** `runtime.GC()` triggers a full collection synchronously and blocks until it completes. This is useful for tests and benchmarks to get a clean baseline, but you should almost never call it in production code — the pacer does a better job than manual triggering.

### Design Rationale

Why does Go have a garbage collector at all, when C and C++ prove you can ship fast software without one? Because manual memory management is the single largest source of security vulnerabilities and crashes in systems software: use-after-free, double-free, buffer overruns, and leaks. Go's designers wanted memory safety *and* a simple programming model, so they accepted a GC.

But Go's GC is tuned differently from older garbage collectors. **Java's** traditional collectors historically optimized for *throughput* — they would happily pause the application for tens or hundreds of milliseconds to do a generational collection efficiently, which is great for batch jobs but painful for latency-sensitive servers. Go made the opposite choice: optimize for **low, predictable pause times** even at the cost of some throughput. The result is sub-millisecond pauses that stay roughly constant as the heap grows, which is ideal for network servers and interactive systems where tail latency matters.

Go also deliberately keeps its GC **non-generational** and **non-compacting** (it does not move objects). Generational GCs assume "most objects die young" and segregate the heap by age; this adds complexity and write-barrier cost. Go's team found that escape analysis already keeps many short-lived values off the heap entirely, so a simpler non-generational design delivers excellent latency with far less machinery. Not moving objects also means pointers stay valid, which keeps interop with C (cgo) and the runtime simpler.

The single-knob design (`GOGC`) is itself a rationale: rather than expose dozens of tuning parameters, Go gives you one intuitive dial that trades memory for CPU. This matches Go's philosophy of simplicity — most programs never touch it, and the few that need tuning have one clear thing to adjust.

### Common Mistakes

- **Calling `runtime.GC()` in production to "free memory."** This forces a full, blocking collection and usually *hurts* — you pay the pause without the pacer's judgment about whether it was worth it. Let the pacer run the GC. Reserve `runtime.GC()` for tests and benchmarks.

- **Assuming a high `HeapAlloc` means a leak.** Go returns memory to the OS lazily and lets the heap grow up to the `GOGC` target. A heap that is twice the live set is *expected* at `GOGC=100`, not a bug. A true leak shows up as `HeapAlloc` (or live object count) growing without bound over time, not as a momentarily large heap.

- **Setting `GOGC` lower to "save memory" without measuring.** Lower `GOGC` means more frequent collections, which means more CPU burned on GC and potentially worse latency. You are trading memory for CPU, and that trade is only worth it if you have actually measured a memory problem.

- **Confusing GC pauses with goroutine scheduling delays.** Not every latency spike is the GC. Before blaming the collector, check `PauseTotalNs` and `GODEBUG=gctrace=1`. Often the real cause is lock contention or blocking syscalls, not GC.

- **Fighting the GC by pooling everything.** Aggressively reusing objects to reduce GC pressure (see `sync.Pool`) helps on proven hot paths but adds complexity and bug surface everywhere else. Most allocation is cheap and the GC handles it fine; only optimize where a profile says so.

### Key Takeaways

- Go's GC is **concurrent, tri-color, mark-and-sweep**, tuned for **short, predictable pause times** rather than maximum throughput.
- Collection is triggered by **heap growth**, governed by `GOGC` (default 100 = collect when heap doubles past the live set), adjustable via `debug.SetGCPercent`.
- A **write barrier** lets marking run concurrently with your program safely.
- Use `runtime.MemStats` (`NumGC`, `HeapAlloc`, `PauseTotalNs`, `Mallocs`/`Frees`) and `GODEBUG=gctrace=1` to observe GC behavior.
- A large heap is not a leak; a *continuously growing* live set is. Diagnose with trends, not snapshots.
- Tune `GOGC` to trade memory for CPU — but only after measuring, and almost never by calling `runtime.GC()` manually.

---

## Broken Code

```go
// broken: calling runtime.GC() on every iteration to "stay tidy".
// This forces a full, blocking collection constantly, wasting enormous
// CPU and adding latency the automatic pacer would never have incurred.
package main

import (
	"fmt"
	"runtime"
)

func main() {
	sink := make([][]byte, 0, 1000)

	for i := 0; i < 1000; i++ {
		// Allocate ~16 KB of garbage each round.
		buf := make([]byte, 16*1024)
		sink = append(sink, buf)

		// Misguided: manually forcing a full GC every single iteration.
		// The pacer already collects at the right time; this just burns CPU.
		runtime.GC()
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Println("forced GC cycles:", m.NumGC) // absurdly high
	fmt.Println("live retained slices:", len(sink))
}
```

---

## Correct Code

```go
// correct: let the pacer run the GC, and observe its behavior via MemStats.
// We allocate the same workload but never call runtime.GC() in the loop,
// then inspect how the automatic collector handled it.
package main

import (
	"fmt"
	"runtime"
	"runtime/debug"
)

func snapshot(label string) runtime.MemStats {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("[%s] NumGC=%d  HeapAlloc=%d KB  TotalAlloc=%d KB  Pauses=%d µs\n",
		label, m.NumGC, m.HeapAlloc/1024, m.TotalAlloc/1024, m.PauseTotalNs/1000)
	return m
}

func main() {
	// Show the current GC target percentage (default 100).
	prev := debug.SetGCPercent(100)
	fmt.Println("GOGC percent (restored):", prev)

	snapshot("start")

	// Allocate lots of short-lived garbage. We keep only a small rolling
	// window of recent buffers alive; everything older becomes unreachable
	// and turns into garbage the concurrent collector reclaims. The pacer —
	// not us — decides when each cycle runs.
	const window = 64
	recent := make([][]byte, window)
	total := 0
	for i := 0; i < 100_000; i++ {
		buf := make([]byte, 16*1024) // ~16 KB allocated on the heap
		buf[0] = byte(i)
		buf[len(buf)-1] = byte(i)
		total += int(buf[0]) + int(buf[len(buf)-1])

		// Overwrite the oldest slot: the buffer that was there becomes
		// unreachable here, so it is now garbage for the GC to collect.
		recent[i%window] = buf
		// No runtime.GC() call — collection happens concurrently as needed.
	}

	snapshot("after allocations")
	fmt.Println("checksum:", total)
	fmt.Println("live window buffers retained:", len(recent))
	fmt.Println()
	fmt.Println("Tip: run with GODEBUG=gctrace=1 to see per-cycle GC details.")
}
```

---

## Explanation

The broken version reflects a misunderstanding of what the GC needs from you: nothing. Calling `runtime.GC()` inside the loop forces a complete, stop-the-world-bracketed collection on *every* iteration. The collector blocks until done, so the program spends most of its time tracing the heap instead of doing work, and `NumGC` balloons to a thousand cycles for a workload the pacer would have handled in a handful. Manual collection here is pure waste — you pay all the cost of GC with none of the pacer's intelligence about *when* it is actually worthwhile.

The correct version simply allocates and lets Go's concurrent collector do its job. We never call `runtime.GC()` in the hot path. Instead we read `runtime.MemStats` before and after to *observe* what happened: how many cycles ran (`NumGC`), how much memory is currently live (`HeapAlloc`), how much was allocated in total over the run (`TotalAlloc`, which keeps climbing because it is cumulative), and how much total pause time accrued (`PauseTotalNs`). This is the right relationship with the GC — you measure and tune the *policy* (`GOGC`), you do not micromanage the *mechanism*.

Notice the use of `debug.SetGCPercent(100)`, which both shows the current target and demonstrates the one real knob you have. Increasing it to 200 would let the heap grow further between collections (fewer cycles, more peak memory); decreasing it to 50 would collect more often (less peak memory, more CPU). The point is that *one* parameter expresses the entire memory-versus-CPU trade.

---

## Design Tradeoff

Go's GC embodies a clear, opinionated trade: it sacrifices some throughput and accepts a few percent of CPU overhead in order to keep pause times tiny and roughly constant as the heap grows. For the servers, CLIs, and pipelines Go targets, predictable low latency is worth far more than squeezing out the last bit of raw throughput a pause-heavy collector might offer. The non-generational, non-moving design keeps the runtime simple and pointers stable, at the cost of doing slightly more work than a fancier generational compactor might.

For you as a programmer, the trade is *control for simplicity*. You give up manual `free` and the ability to place objects precisely, and in return you get memory safety and a single, intuitive `GOGC` dial. The danger is treating that dial — or `runtime.GC()` — as a fix for problems you have not measured. The disciplined approach is to let the pacer run, observe with `MemStats` and `gctrace`, and only reach for `GOGC` when a real, measured memory-versus-CPU trade demands it.

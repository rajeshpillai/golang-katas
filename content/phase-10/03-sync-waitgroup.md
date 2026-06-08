---
id: sync-waitgroup
phase: 10
phase_title: Synchronization & Coordination
sequence: 3
title: sync.WaitGroup
---

## Description

### Concept Overview

When you launch goroutines, the launching goroutine does not automatically wait for them. `go doWork()` returns immediately — it schedules the work and moves on. If `main` finishes while goroutines are still running, the program exits and those goroutines are killed mid-flight, their results lost. So the central question of structured concurrency is: *how does one goroutine wait for a group of others to finish?*

A `sync.WaitGroup` answers exactly that. It is a concurrency-safe counter. You add to it before launching work, each goroutine decrements it when done, and a waiter blocks until the counter reaches zero. It is the idiomatic way to say "fan out N goroutines, then wait for all of them" without inventing your own signaling.

The zero value of a `sync.WaitGroup` is a ready-to-use group with a count of zero. You declare it and use it — no constructor.

### Technical Explanation

**Three methods.** `wg.Add(delta)` increases the internal counter by `delta` (usually 1 per goroutine, but you can add N at once). `wg.Done()` decreases the counter by one — it is exactly `wg.Add(-1)`. `wg.Wait()` blocks the calling goroutine until the counter reaches zero. The canonical shape is:

```go
var wg sync.WaitGroup
for _, job := range jobs {
    wg.Add(1)          // (1) increment BEFORE launching
    go func(j Job) {
        defer wg.Done() // (2) decrement when this goroutine returns
        process(j)
    }(job)
}
wg.Wait()              // (3) block until all Done() calls land
```

**`Add` must happen before the goroutine might finish — and before `Wait` could return.** The counter is the synchronization point. If you call `Add(1)` *inside* the goroutine instead of before launching it, there is a window where the launcher reaches `Wait()` before the goroutine has run its `Add(1)`. `Wait()` then sees a counter of zero and returns immediately, and the program proceeds (or exits) while goroutines are still starting. Always call `Add` in the goroutine that launches, before the `go` statement.

**`defer wg.Done()` is the correct release pattern.** Putting `Done()` behind `defer` guarantees the counter is decremented even if the goroutine returns early or panics. Forgetting `Done()` on any path means the counter never reaches zero and `Wait()` blocks forever — a hang that looks like a deadlock.

**Memory model guarantee.** The Go memory model specifies that a call to `wg.Done()` (the decrement) happens-before the `wg.Wait()` it allows to return. This means that after `Wait()` returns, the waiter is guaranteed to see all the memory writes the worker goroutines made before calling `Done()`. So if each worker writes into its own slot of a slice and then calls `Done()`, the waiter reading that slice after `Wait()` sees every write — no extra mutex needed for that handoff.

**A WaitGroup is reusable but must reach zero between uses.** You can run a second wave of work on the same `WaitGroup`, but only after `Wait()` has returned (counter back at zero). Calling `Add` concurrently with a `Wait` that is draining the previous wave is a misuse and panics. In practice, declare a fresh `WaitGroup` per logical batch unless you have a clear reason to reuse one.

**Do not copy it.** A `WaitGroup` holds internal state (the counter and a semaphore). Copying it after first use breaks coordination, because the copy has its own counter. Pass it by pointer (`*sync.WaitGroup`) to any function that calls `Add`, `Done`, or `Wait`. `go vet` flags copies. The closure-capture pattern above sidesteps this by capturing the single `wg` directly.

**Negative counter panics.** If `Done()` is called more times than `Add`, the counter goes negative and the runtime panics with "negative WaitGroup counter." This usually means a double `Done()` or an `Add` that was skipped.

### Design Rationale

Go could have given goroutines a `join()` method like threads in some languages, where you hold a handle and wait on it individually. Instead it gives you a separate, composable counter. Why? Because goroutines are intentionally cheap and anonymous — you launch thousands without tracking individual handles. A `WaitGroup` lets you wait on a *group* by count, not by identity, which matches how goroutines are actually used: spawn a fan-out, wait for the whole fan-out.

`WaitGroup` deliberately does *not* collect results or propagate errors. It only counts. This keeps it tiny and orthogonal: you compose it with channels (to gather results), with a shared slice plus the memory-model guarantee (to write results in place), or with `errgroup` from `golang.org/x/sync` when you also need error propagation and cancellation. Go favors small primitives you combine over one large do-everything abstraction — the same reasoning behind shipping both mutexes and channels rather than a single coordination framework.

### Common Mistakes

**Calling `Add(1)` inside the goroutine.** This is the classic race. The launcher can reach `Wait()` before the goroutine runs its `Add`, so `Wait()` returns early and the program proceeds while work is still pending. Always `Add` before the `go` statement. (`go test -race` will often reveal the resulting race on the work the goroutine was supposed to do.)

**Forgetting `Done()` on some path.** An early `return`, a `continue` in a loop, or a panic that skips `Done()` leaves the counter above zero, so `Wait()` hangs forever. Use `defer wg.Done()` as the very first line of the goroutine.

**Calling `Done()` too many times.** A double `Done()` (for example, both a `defer` and an explicit call) drives the counter negative and panics. Pick one release point — the `defer`.

**Passing the WaitGroup by value.** A function `func worker(wg sync.WaitGroup)` receives a *copy*; its `Done()` decrements the copy, not the original, so the original `Wait()` never unblocks. Pass `*sync.WaitGroup`, or capture the `wg` in a closure as shown.

**Reusing a WaitGroup before the previous `Wait` returns.** Adding to a group that is still draining a prior wave is a misuse and panics. Wait for zero, or use a fresh group per batch.

### Key Takeaways

- A `sync.WaitGroup` lets one goroutine wait for a group of others to finish, via a concurrency-safe counter.
- Call `Add` in the launching goroutine *before* the `go` statement — never inside the goroutine — so `Wait` cannot return early.
- Make `defer wg.Done()` the first line of each goroutine so the counter always reaches zero, even on early return or panic.
- After `Wait()` returns, you are guaranteed to see all writes the workers made before their `Done()` — that happens-before edge is part of the memory model.
- Never copy a `WaitGroup`; pass it by pointer or capture it in a closure, and let `go vet` catch slips.
- `WaitGroup` only counts — combine it with channels, a shared slice, or `errgroup` when you need results or error handling.

---

## Broken Code

```go
// broken: Add(1) is called INSIDE each goroutine, after `go`. The launcher can
// reach Wait() before the goroutines have run their Add, so Wait() sees a zero
// counter and returns immediately. The program prints partial/empty results and
// exits while goroutines are still starting. `go run -race main.go` flags it.
package main

import (
	"fmt"
	"sync"
)

func main() {
	var wg sync.WaitGroup
	results := make([]int, 10)

	for i := 0; i < 10; i++ {
		go func(n int) {
			wg.Add(1) // WRONG: too late — Wait() may already have returned
			defer wg.Done()
			results[n] = n * n
		}(i)
	}

	wg.Wait() // may return before any goroutine incremented the counter
	fmt.Println("results:", results) // often all zeros
}
```

---

## Correct Code

```go
// correct: Add before launching, Done via defer, Wait for the whole fan-out.
// Each worker writes its own slot, so the slice needs no mutex — the
// WaitGroup's happens-before guarantee makes the writes visible after Wait().
// Runs cleanly under `go run -race main.go` and prints deterministic results.
package main

import (
	"fmt"
	"sync"
)

func main() {
	const n = 10

	var wg sync.WaitGroup
	results := make([]int, n)

	for i := 0; i < n; i++ {
		wg.Add(1) // increment BEFORE launching the goroutine
		go func(idx int) {
			defer wg.Done() // always decrement, even on panic/early return
			results[idx] = idx * idx
		}(i) // pass i as an argument to capture this iteration's value
	}

	wg.Wait() // block until all 10 Done() calls have landed

	// Safe to read results here: every worker's write happened-before its
	// Done(), which happened-before this Wait() returned.
	sum := 0
	for _, v := range results {
		sum += v
	}
	fmt.Printf("results: %v\n", results)
	fmt.Printf("sum of squares 0..%d: %d\n", n-1, sum) // 285
}
```

---

## Explanation

The broken version moves `wg.Add(1)` inside the goroutine. That creates a race between the launcher and the workers: nothing forces the goroutines to run their `Add(1)` before the launcher reaches `wg.Wait()`. If the scheduler has not started any goroutine yet, the counter is still zero, so `Wait()` returns instantly, `main` prints the still-empty `results` slice (often all zeros), and the program exits — abandoning goroutines that may not have run at all. The bug is intermittent, which makes it especially dangerous: it can pass tests and fail in production.

The correct version calls `wg.Add(1)` in the launching loop, *before* the `go` statement, so the counter is fully accounted for before `Wait()` can be reached. Each goroutine makes `defer wg.Done()` its first line, guaranteeing the counter is decremented on every exit path. `Wait()` then blocks until all ten workers have finished, and only then does `main` read the results — printing the squares and their sum, 285, deterministically every run.

Notice there is no mutex around `results`, yet there is no data race. Two things make this safe: each goroutine writes to a *distinct* index (`results[idx]`), so writes never overlap; and the `WaitGroup` provides the happens-before edge — each worker's write happens-before its `Done()`, which happens-before `Wait()` returns — so `main` is guaranteed to observe all the writes. This is a clean example of combining a `WaitGroup` with a pre-sized slice to gather results without extra locking.

---

## Design Tradeoff

A `WaitGroup` gives you waiting and memory visibility, but nothing else — by design. It does not return values, does not collect errors, and does not cancel work if one goroutine fails. That minimalism is the tradeoff: you get a tiny, fast, composable primitive, but you must bolt on result-gathering and error-handling yourself. For "do N independent things and wait," that is perfect. For "do N things, stop early if one fails, and propagate the error," you outgrow `WaitGroup` and reach for `errgroup.Group` (which wraps a `WaitGroup`, a context for cancellation, and an error slot).

The other tradeoff is the strict discipline the counter demands: `Add` before launch, exactly one `Done` per `Add`, no copies, no reuse mid-wave. Get the ordering wrong and you trade a guaranteed wait for a silent early return or a hang. Go accepts this sharp-edged simplicity because the alternative — a heavyweight, do-everything task framework — would obscure exactly what is being awaited. The `WaitGroup` keeps the coordination visible and explicit, and `go vet` plus `go test -race` guard the edges.

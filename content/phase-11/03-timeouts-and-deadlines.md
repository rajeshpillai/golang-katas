---
id: timeouts-and-deadlines
phase: 11
phase_title: Context & Lifecycles
sequence: 3
title: Timeouts and Deadlines
---

## Description

### Concept Overview

A timeout or deadline is a context that cancels *itself* when time runs out. Instead of waiting for some external code to call `cancel()`, you tell the context "stop no later than this moment," and the runtime fires the cancellation automatically. This is how Go bounds the duration of operations that might otherwise hang forever — a slow network peer, an unresponsive database, a stuck downstream service. With a deadline-bearing context, every blocking call has a built-in escape hatch.

There are two framings of the same idea. A **timeout** is *relative*: "give up 50 milliseconds from now." A **deadline** is *absolute*: "give up at 3:00:00.500 PM." `context.WithTimeout` is simply a convenience wrapper around `context.WithDeadline(parent, time.Now().Add(d))`. Both produce a context whose `Done()` channel closes — and whose `Err()` becomes `context.DeadlineExceeded` — the instant the clock crosses the deadline, *unless* the work finishes (or someone calls `cancel`) first.

### Technical Explanation

**`WithTimeout` and `WithDeadline`** both return a derived context and a `cancel` function:

```go
// Relative: 50ms from now.
ctx, cancel := context.WithTimeout(parent, 50*time.Millisecond)
defer cancel()

// Absolute: a specific wall-clock instant.
ctx, cancel := context.WithDeadline(parent, time.Now().Add(50*time.Millisecond))
defer cancel()
```

Internally, the runtime arms a timer. When the timer fires, it closes the context's `Done()` channel and sets `Err()` to `context.DeadlineExceeded`. If `cancel()` is called first (because the work completed), the timer is stopped and `Err()` becomes `context.Canceled`. **Whichever happens first wins**, and it is permanent.

**The `cancel` function is mandatory even with a timeout.** A common but wrong intuition is "the timer will fire anyway, so I do not need to call `cancel`." Not true: if the work finishes *before* the deadline, the armed timer is still pending. Calling `cancel()` stops that timer and releases its resources immediately, instead of letting it linger until the deadline passes. Skipping `cancel` leaks the timer (and the bookkeeping) for the remaining duration — `go vet` flags the omission. Always `defer cancel()`.

**Deadlines shrink as they inherit.** When you derive a timeout from a parent that already has a deadline, the child's effective deadline is the *earlier* of the two. `WithDeadline` will not extend a parent's deadline — a child cannot outlive its parent. If a request has 100ms left and you derive a 5-second timeout for a sub-call, that sub-call still cancels in 100ms. You can inspect the effective deadline via `ctx.Deadline()`, which returns the deadline and a boolean indicating whether one is set.

**`context.DeadlineExceeded` is the sentinel.** After a deadline fires, `ctx.Err()` returns `context.DeadlineExceeded`, which also satisfies `errors.Is(err, context.DeadlineExceeded)`. Notably, `context.DeadlineExceeded` implements `net.Error` with `Timeout() == true`, so timeout-aware networking code can treat it uniformly. Use `errors.Is` to distinguish a timeout (`DeadlineExceeded`) from an explicit abort (`Canceled`) — they mean different things to a caller deciding whether to retry.

**Honoring the deadline still requires a `select`.** A deadline does not preempt a running goroutine. As with all context cancellation, the timer closes `Done()`, but your code must be blocked in a `select` on `<-ctx.Done()` (or call a context-aware API like `http.NewRequestWithContext`) for the deadline to actually interrupt the work. A `time.Sleep` or a tight loop ignores the deadline entirely.

### Design Rationale

Go folds timeouts and deadlines into the *same* `context.Context` type that carries explicit cancellation, rather than offering a separate timeout mechanism, because to the code doing the work they are indistinguishable: in all cases, `Done()` closes and the operation must stop. A single uniform "stop signal" means a function that already honors cancellation gets timeout support for free — it does not care *why* the context ended, only *that* it ended. This is the payoff of "context defines when work should stop": the worker never needs to know whether the stop came from a user pressing cancel, a parent giving up, or a clock expiring.

Choosing absolute deadlines as the underlying primitive (with relative timeouts as sugar) is also deliberate. Deadlines compose correctly across a call tree: a request's single absolute deadline can be passed down through many layers, and each layer naturally inherits the time that actually remains. Relative timeouts, if used as the primitive, would drift — each layer adding its own "5 seconds" would let total latency balloon. By anchoring to an absolute instant and taking the minimum on each derivation, Go guarantees the whole tree of sub-operations respects one shared budget. That is exactly the property a server wants: bound the *total* time spent serving a request, not the time of each hop independently.

### Common Mistakes

**Forgetting `defer cancel()` because "the timeout fires anyway."** If the work completes before the deadline, the timer is still armed. Not calling `cancel` leaks it until the deadline passes. In a high-throughput server, thousands of pending timers accumulate. `defer cancel()` immediately after deriving the context is the rule, no exceptions.

**Using `time.Sleep` or a blocking call that ignores the context.** A deadline cannot interrupt code that is not watching for it. `time.Sleep(time.Hour)` runs the full hour regardless of any deadline. Replace such patterns with `select { case <-ctx.Done(): ... case <-time.After(d): ... }`, or use APIs that accept a context.

**Assuming a child timeout can extend a parent's deadline.** Deriving a 10-second timeout under a parent that has 1 second left does *not* give you 10 seconds. The child is capped at the parent's remaining time. Check `ctx.Deadline()` if you need to reason about the real budget.

**Treating `DeadlineExceeded` and `Canceled` as the same thing.** They carry different meaning: a timeout often warrants a retry or a fallback, while an explicit cancellation usually means the caller no longer wants the result at all. Branch on `errors.Is(err, context.DeadlineExceeded)` versus `errors.Is(err, context.Canceled)` rather than collapsing them.

**Setting a timeout but never plumbing the context into the slow call.** Deriving `ctx` with a deadline and then making the network/database call without passing that `ctx` means the deadline guards nothing. The slow call still has no bound. The timeout only works if the context reaches the operation it is meant to limit.

### Key Takeaways

- A timeout/deadline context cancels itself when the clock runs out — no external `cancel()` needed.
- `WithTimeout(parent, d)` is sugar for `WithDeadline(parent, time.Now().Add(d))`; deadlines are absolute, timeouts are relative.
- Always `defer cancel()`, even with a timeout — it stops the armed timer immediately when work finishes early.
- A child's effective deadline is the earlier of its own and its parent's; a child can never outlive its parent.
- On expiry, `ctx.Err()` is `context.DeadlineExceeded`; use `errors.Is` to tell it apart from `context.Canceled`.
- A deadline only interrupts code that selects on `<-ctx.Done()` or uses context-aware APIs — `time.Sleep` ignores it.

---

## Broken Code

```go
// broken: a timeout context that guards nothing and leaks its timer
package main

import (
	"context"
	"fmt"
	"time"
)

func slowCall() string {
	time.Sleep(2 * time.Second) // unbounded blocking work
	return "data"
}

func main() {
	// Bug 1: cancel is never called — the armed timer leaks.
	ctx, _ := context.WithTimeout(context.Background(), 50*time.Millisecond)

	// Bug 2: ctx is never passed into slowCall and never observed.
	// The 50ms deadline guards nothing; we block for the full 2 seconds.
	result := slowCall()

	// By now ctx is long expired, but it never affected anything.
	_ = ctx
	fmt.Println("got:", result)
}
```

---

## Correct Code

```go
// correct: the deadline actually bounds the slow operation
package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// slowCall simulates work that may take longer than we are willing to wait.
// It honors ctx: if the deadline fires first, it returns ctx.Err().
func slowCall(ctx context.Context, took time.Duration) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(took):
		return "data", nil
	}
}

func main() {
	// A 50ms budget for the whole operation.
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel() // stops the timer immediately if we finish early

	// Show the effective deadline.
	if dl, ok := ctx.Deadline(); ok {
		fmt.Println("deadline set; budget ~", time.Until(dl).Round(time.Millisecond))
	}

	// Case 1: work that takes 200ms loses the race — deadline wins.
	if _, err := slowCall(ctx, 200*time.Millisecond); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			fmt.Println("call 1: timed out (DeadlineExceeded) — would retry or fall back")
		} else {
			fmt.Println("call 1: failed:", err)
		}
	}

	// Case 2: a fresh, fast operation under its own short deadline.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel2()
	if result, err := slowCall(ctx2, 10*time.Millisecond); err == nil {
		fmt.Println("call 2: succeeded with", result)
	}

	// Demonstrate inheritance: a child cannot extend its parent's budget.
	parent, cancelP := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancelP()
	child, cancelC := context.WithTimeout(parent, 10*time.Second) // asks for 10s
	defer cancelC()
	if dl, ok := child.Deadline(); ok {
		fmt.Println("child capped to parent budget ~", time.Until(dl).Round(time.Millisecond))
	}
}
```

---

## Explanation

The broken version sets up a timeout that protects nothing. Two independent bugs combine. First, `context.WithTimeout` returns a `cancel` function that is discarded with `_`. Because the work below blocks for two full seconds, the armed 50ms timer sits pending the entire time, leaked — `go vet` would flag this missing `cancel`. Second, and more damaging, `slowCall()` neither accepts `ctx` nor observes it. The 50ms deadline expires harmlessly in the background while `slowCall` sleeps for two seconds, oblivious. The program demonstrates the cardinal rule: a deadline only bounds an operation if the context reaches that operation *and* the operation selects on `<-ctx.Done()`.

The correct version wires the deadline through. `slowCall` now takes `ctx` as its first parameter and blocks in a `select` that races the real work (`time.After(took)`) against `<-ctx.Done()`. In case 1, the work needs 200ms but the context's 50ms deadline fires first, so the `select` chooses `ctx.Done()` and `slowCall` returns `ctx.Err()` — which `errors.Is` confirms is `context.DeadlineExceeded`. The caller can then decide to retry or fall back, a decision that depends on knowing it was a *timeout* and not an explicit cancellation. Case 2 shows the happy path: a 10ms operation under a 50ms budget completes and returns its data before the deadline. Every derived context is paired with `defer cancel()`, so timers are released the moment each operation resolves.

The final block makes the inheritance rule concrete. A `parent` is given a 30ms budget; a `child` is then derived asking for a generous 10-second timeout. But `child.Deadline()` reports roughly 30ms remaining, not 10 seconds — `WithTimeout` capped the child at the parent's earlier deadline, because a child can never outlive its parent. The whole program finishes in a fraction of a second.

---

## Design Tradeoff

Unifying timeouts and explicit cancellation under one `context.Context` is a clean abstraction, but it pushes a subtle obligation onto every layer of code: the context must be threaded all the way down to the actual blocking operation, and that operation must be context-aware. A timeout set at the top of a handler does nothing if a function three layers down forgets to pass `ctx` along, or calls a library that ignores it. The signal exists, but it never reaches the place where stopping is possible. There is no compiler check for this — the failure mode is a request that hangs past its deadline, discovered only under load.

Anchoring on absolute deadlines rather than per-call relative timeouts is the other significant tradeoff. It composes beautifully for bounding *total* request latency — one budget, inherited and shrunk down the tree — but it can surprise developers who think locally. Asking for "10 seconds" in a sub-call and getting 30 milliseconds (because the parent was nearly out of time) feels counterintuitive until you internalize that the deadline belongs to the whole operation, not the individual hop. Go makes that choice on purpose: a server's job is to honor the caller's overall time budget, and absolute deadlines are the only way to guarantee that the sum of nested work respects a single bound.

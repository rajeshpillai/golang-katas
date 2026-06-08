---
id: context-context
phase: 11
phase_title: Context & Lifecycles
sequence: 1
title: context.Context
---

## Description

### Concept Overview

In Go, a `context.Context` is a value that carries cancellation signals, deadlines, and request-scoped values across API boundaries and between goroutines. It is the standard mechanism for answering one fundamental question: **"Should this work still be happening?"** When an HTTP request is cancelled, a timeout fires, or a parent operation gives up, that fact needs to travel — quickly and reliably — to every goroutine doing work on behalf of that operation. `context.Context` is how Go propagates that signal.

A context does not *do* the cancelling. It is a read-only handle that lets the code doing work *observe* whether it should stop. The decision to cancel lives with whoever created the context; the obligation to react to cancellation lives with whoever holds it. This separation is the heart of the design: `context.Context` defines **when work should stop**, not how the work is done.

Every long-running or blocking operation in idiomatic Go — network calls, database queries, channel reads — should accept a `context.Context` as its first parameter, conventionally named `ctx`. This makes the lifecycle of the operation explicit and composable.

### Technical Explanation

**The `context.Context` interface** has exactly four methods:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

- **`Done()`** returns a receive-only channel that is *closed* when the context is cancelled or times out. A closed channel never blocks on receive, so a `select` waiting on `<-ctx.Done()` becomes ready the instant cancellation happens. This is the primary cancellation signal.
- **`Err()`** returns `nil` while the context is still active. After `Done()` is closed, it returns a non-nil error — either `context.Canceled` (explicit cancellation) or `context.DeadlineExceeded` (a timeout or deadline passed).
- **`Deadline()`** reports when the context will be cancelled automatically, if a deadline is set.
- **`Value(key)`** retrieves a request-scoped value associated with `key`, or `nil` if none exists.

**Root contexts** come from two functions. `context.Background()` is the empty root context — never cancelled, no deadline, no values — used at the top of `main`, in initialization, and in tests. `context.TODO()` is identical at runtime but signals to readers that you have not yet decided which context to plumb through.

**Derived contexts** are created with the `With...` family, each returning a *child* context derived from a parent:

```go
ctx, cancel := context.WithCancel(parent)              // manual cancellation
ctx, cancel := context.WithTimeout(parent, 50*time.Millisecond) // relative deadline
ctx, cancel := context.WithDeadline(parent, t)         // absolute deadline
ctx := context.WithValue(parent, key, val)             // attach a value
```

`WithCancel`, `WithTimeout`, and `WithDeadline` each return a **`cancel` function**. Calling `cancel()` closes that context's `Done()` channel and releases the resources Go allocated to track it. You must always call `cancel`, typically via `defer cancel()`, even when a timeout will fire on its own — otherwise the context (and any timer goroutine behind it) leaks until the parent is cancelled.

**Cancellation propagates downward through the tree.** Contexts form a tree rooted at `Background()`. When a context is cancelled, every context derived from it is cancelled too, recursively. Cancelling a child, however, does *not* affect the parent. This lets a single root cancellation fan out across an entire call tree — every goroutine listening on its `Done()` channel wakes up at once.

```go
ctx := context.Background()
ctx1, cancel := context.WithCancel(ctx)
ctx2, _ := context.WithTimeout(ctx1, time.Second) // child of ctx1
cancel()        // cancels ctx1 AND ctx2, but not the Background root
```

Code that respects context typically blocks in a `select`, racing the real work against `<-ctx.Done()`. When `Done()` fires first, the function returns `ctx.Err()` so the caller learns *why* it stopped.

### Design Rationale

Go made context **explicit and first-positional** rather than ambient. In many languages, request-scoped cancellation or deadlines ride along invisibly — thread-local storage in Java, async-local contexts in .NET, or implicit task cancellation tokens that the runtime threads for you. That ambient approach hides the lifecycle: you cannot tell from a function signature whether it can be cancelled, and cancellation behavior changes depending on which thread happens to run the code.

Go rejects hidden state. Goroutines are not threads, do not have stable identities, and a single logical request may hop across many goroutines — so thread-local storage simply cannot model request scope correctly. By passing `ctx context.Context` as the explicit first argument, every function's signature advertises, "I participate in a cancellable lifecycle." The reader sees exactly how the cancellation signal flows: it is a value, passed by hand, down the call tree. This is the same philosophy as Go's explicit error returns — confront the lifecycle, do not let the runtime manage it behind your back.

The phrasing that captures it: **context defines when work should stop.** It is not a general-purpose dependency container, not a configuration object, and not a replacement for function parameters. It is a disciplined, narrow tool for propagating cancellation, deadlines, and a small set of truly request-scoped values across goroutine and API boundaries.

### Common Mistakes

**Storing a `Context` inside a struct.** It is tempting to stash `ctx` as a struct field so methods do not have to take it as a parameter. This breaks the lifecycle model: a context represents a single in-flight operation, but a struct often outlives any one operation and may be used concurrently by several. The Go team explicitly advises passing context as the first argument of each call instead. A stored context goes stale, gets reused across requests, and silently defeats per-request cancellation.

**Passing a `nil` context.** Functions that accept a context assume it is non-nil and will call `ctx.Done()` or `ctx.Err()` on it. Passing `nil` causes a panic. If you are unsure which context to use, pass `context.TODO()` — never `nil`.

**Ignoring cancellation entirely.** Accepting a `ctx` parameter and then never reading `<-ctx.Done()` (or never threading it into the calls you make) means cancellation has no effect. The signal arrives, but nobody is listening, so the work runs to completion anyway. Accepting a context is a *promise* to honor it.

**Leaking the `cancel` function.** Every `WithCancel`/`WithTimeout`/`WithDeadline` hands you a `cancel` you must call. Forgetting it — especially for `WithTimeout` where "the timer will fire anyway" feels reassuring — leaks the internal goroutine and resources until the parent context dies. `go vet` flags this. Always `defer cancel()`.

**Treating `Background()` as cancellable.** `context.Background()` never fires its `Done()` channel and never returns an error from `Err()`. Selecting on `context.Background().Done()` is a permanent block. Derive a cancellable context from it before relying on cancellation.

### Key Takeaways

- A `context.Context` carries cancellation signals, deadlines, and request-scoped values; it answers "should this work still happen?"
- `Done()` returns a channel closed on cancellation; `Err()` reports `context.Canceled` or `context.DeadlineExceeded` once it is closed.
- Start from `context.Background()` (or `TODO()`), then derive children with `WithCancel`, `WithTimeout`, `WithDeadline`, or `WithValue`.
- Cancellation propagates from a parent to all of its descendants, but never upward — one root cancel can stop an entire call tree.
- Always pass `ctx` as the explicit first parameter; never store it in a struct or pass `nil`.
- Always call the returned `cancel` function (usually `defer cancel()`) to release resources, even when a timeout would fire on its own.

---

## Broken Code

```go
// broken: accepts a context but never observes it, so cancellation does nothing
package main

import (
	"context"
	"fmt"
	"time"
)

// worker accepts a context but ignores ctx.Done() entirely.
// The cancellation signal arrives, but nobody is listening — the loop
// runs to completion regardless, leaking the goroutine past cancel().
func worker(ctx context.Context) {
	for i := 0; i < 10; i++ {
		// Bug: no select on <-ctx.Done(); the context is dead weight.
		time.Sleep(20 * time.Millisecond)
		fmt.Println("did work", i)
	}
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	go worker(ctx)

	time.Sleep(30 * time.Millisecond)
	cancel() // Bug: this has no effect — worker never checks the context.

	// Also a bug in spirit: cancel's resources matter, but worker keeps going.
	time.Sleep(300 * time.Millisecond)
	fmt.Println("main done — but worker ran the whole time")
}
```

---

## Correct Code

```go
// correct: the worker observes ctx.Done() and stops promptly on cancellation
package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// worker does repeated units of work, but races each unit against
// cancellation. The moment ctx.Done() fires, it returns ctx.Err()
// so the caller learns WHY it stopped.
func worker(ctx context.Context, done chan<- error) {
	for i := 0; i < 10; i++ {
		select {
		case <-ctx.Done():
			// Cancellation observed: stop immediately and report the reason.
			fmt.Println("worker: stopping, reason:", ctx.Err())
			done <- ctx.Err()
			return
		case <-time.After(20 * time.Millisecond):
			fmt.Println("worker: did work", i)
		}
	}
	done <- nil
}

func main() {
	// Derive a cancellable context from the empty root.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel() // always release resources, even on the happy path

	done := make(chan error, 1)
	go worker(ctx, done)

	// Let a little work happen, then cancel the operation.
	time.Sleep(50 * time.Millisecond)
	cancel()

	// Wait for the worker to acknowledge cancellation and exit cleanly.
	err := <-done
	if errors.Is(err, context.Canceled) {
		fmt.Println("main: worker was cancelled as expected")
	} else if err != nil {
		fmt.Println("main: worker failed:", err)
	} else {
		fmt.Println("main: worker finished all work")
	}

	// Demonstrate the four Context methods on a fresh, already-cancelled ctx.
	c2, cancel2 := context.WithCancel(context.Background())
	cancel2()
	<-c2.Done() // returns immediately: the channel is closed
	fmt.Println("c2.Err():", c2.Err())
}
```

---

## Explanation

The broken version captures the single most common context mistake: accepting a `ctx` parameter and then never observing it. The `worker` function takes a `context.Context`, which advertises to every reader that it can be cancelled — but inside the loop there is no `select` on `<-ctx.Done()` and no check of `ctx.Err()`. When `main` calls `cancel()`, the context's `Done()` channel is dutifully closed, but the worker is blocked in `time.Sleep`, not listening. The signal lands in an empty room. The goroutine runs all ten iterations and outlives the cancellation entirely. Accepting a context is a promise to honor it, and the broken code breaks that promise.

The correct version keeps the promise. Each iteration of the loop blocks in a `select` that races the real work (`time.After`) against cancellation (`ctx.Done()`). The instant `main` calls `cancel()`, the `Done()` channel closes, the `select` chooses that case, and the worker returns `ctx.Err()` — which is `context.Canceled`. The caller receives that error over the `done` channel and uses `errors.Is(err, context.Canceled)` to confirm the operation stopped because it was cancelled, not because it failed. The trailing demonstration shows the mechanics directly: cancelling a context closes its `Done()` channel (so `<-c2.Done()` returns immediately) and flips `Err()` from `nil` to `context.Canceled`.

Notice the discipline points that make this idiomatic: `ctx` is the first parameter, the context is derived from `context.Background()` rather than passed as `nil`, and `defer cancel()` guarantees resources are released on every exit path. The program terminates in well under a second because every blocking operation is bounded and every goroutine has a guaranteed path to exit.

---

## Design Tradeoff

Threading `ctx context.Context` as the first parameter of every cancellable function is undeniably verbose. It clutters signatures, must be passed by hand through every layer, and cannot be "skipped" for a quick prototype without leaving a `context.TODO()` breadcrumb. Languages that use thread-local or ambient cancellation tokens avoid this boilerplate — the runtime carries the signal for you, and call sites stay clean.

Go accepts the verbosity deliberately, because the alternative hides the lifecycle. In Go, a single request routinely fans out across many goroutines that have no stable identity, so thread-local storage cannot model request scope at all. More importantly, an explicit `ctx` parameter makes cancellability *visible*: you can tell from a function's signature whether it participates in a cancellable lifecycle, and you can trace exactly how the cancellation signal flows down the call tree. That visibility is worth the extra keystrokes. As with explicit error returns, Go chooses to make the failure-and-stop paths confront you in the code rather than manage them invisibly in the runtime — clarity over convenience.

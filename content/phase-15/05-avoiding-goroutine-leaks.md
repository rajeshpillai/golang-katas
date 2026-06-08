---
id: avoiding-goroutine-leaks
phase: 15
phase_title: Advanced Concurrency Patterns
sequence: 5
title: Avoiding Goroutine Leaks
---

## Description

### Concept Overview

A **goroutine leak** happens when a goroutine blocks forever and is never able to return. Unlike a memory leak you might eventually notice, a leaked goroutine is invisible to the type system and silent at runtime — the program keeps working, but each leak permanently consumes a stack, holds references that the garbage collector can never reclaim, and may keep a channel, file, or connection alive indefinitely. In a long-lived service, leaks accumulate one per request or per operation until memory is exhausted and the process dies.

The root cause is almost always the same: a goroutine is blocked on a channel send or receive that will never complete because the other side gave up. The most common scenario is an **early return** — a consumer stops reading from a channel before the producer is finished, so the producer's next send blocks forever. The fix is equally consistent: give every goroutine a guaranteed exit path, usually a `done` channel or a `context.Context`, that signals "stop, no one is listening anymore." A goroutine that can always be told to quit can never leak.

### Technical Explanation

The canonical leak is a producer that outlives its consumer.

```go
// LEAK: if the caller stops reading early, this goroutine blocks on send forever.
func generate() <-chan int {
    ch := make(chan int)
    go func() {
        for i := 0; ; i++ {
            ch <- i // blocks forever once nobody is receiving
        }
    }()
    return ch
}

func main() {
    ch := generate()
    fmt.Println(<-ch) // take one value...
    fmt.Println(<-ch) // ...and another, then return.
    // The generator goroutine is now blocked on `ch <- 2` FOREVER. Leak.
}
```

The generator runs an infinite loop sending on an unbuffered channel. The moment `main` stops receiving, the generator's next send has no receiver and blocks permanently. The goroutine, its stack, and the channel are leaked.

**The fix: a `done` channel.** Pass the goroutine a signal it can watch alongside its send, using `select`. When `done` is closed, the goroutine returns instead of blocking.

```go
func generate(done <-chan struct{}) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; ; i++ {
            select {
            case ch <- i:        // send if someone is receiving
            case <-done:         // OR exit if told to stop
                return
            }
        }
    }()
    return ch
}

func main() {
    done := make(chan struct{})
    defer close(done) // signals the generator to exit when main returns

    ch := generate(done)
    fmt.Println(<-ch)
    fmt.Println(<-ch)
    // close(done) (via defer) unblocks the generator's select -> it returns.
}
```

The `select` makes the goroutine's blocking *cancellable*: it is parked on either the send or the `done` receive, and whichever becomes ready wins. Closing `done` makes `<-done` immediately ready for every goroutine watching it, so they all unwind. A closed channel is the idiomatic broadcast: any number of goroutines can select on it and all observe the close.

**`context.Context` generalizes this.** A context carries cancellation (and optionally a deadline) through a call tree. `ctx.Done()` is exactly the `done` channel above, plumbed through your APIs by convention.

```go
func generate(ctx context.Context) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; ; i++ {
            select {
            case ch <- i:
            case <-ctx.Done(): // cancellation or timeout -> exit
                return
            }
        }
    }()
    return ch
}
```

The rule of thumb: **every long-running goroutine must answer the question "how does this stop?"** If the only answer is "when its channel operation completes," and that completion is not guaranteed, you have a latent leak. Wiring `ctx.Done()` (or a `done` channel) into every blocking `select` turns "blocks forever" into "blocks until cancelled."

Detecting leaks: `runtime.NumGoroutine()` lets you assert the count returns to baseline in tests, and the `net/http/pprof` goroutine profile shows where leaked goroutines are parked.

### Design Rationale

Most runtimes give threads a `Thread.interrupt()` or similar — an external, often unsafe, way to poke a blocked thread. Go deliberately offers no way to kill a goroutine from the outside. There is no `goroutine.Kill()`. This is a conscious design decision: forcibly stopping a goroutine could leave locks held, files half-written, and invariants broken. Instead, Go makes cancellation **cooperative**. A goroutine stops itself, at a safe point, when it observes a cancellation signal — and the idiomatic signal is a closed channel, exposed through `context.Context`.

This fits Go's foundational principle:

> Don't communicate by sharing memory; share memory by communicating.

Cancellation is *communicated* over a channel (`ctx.Done()`), not imposed by mutating shared state or interrupting a thread. Every goroutine cooperatively checks for that message in its `select` and unwinds cleanly, running its `defer`s, releasing its locks, closing its channels. Go chose cooperative cancellation because it is the only model that keeps shutdown *safe* — the goroutine decides when it is at a consistent point to quit. The cost is discipline: you must thread the `done`/context signal everywhere and select on it. The payoff is that shutdown never corrupts state.

### Common Mistakes

**Returning from the consumer without telling the producer to stop.** This is the textbook leak: you read a few values and return (or `break`, or hit an error), but the producer goroutine is still trying to send. Its next send blocks forever. Always signal the producer (close `done` / cancel the context) when you stop consuming — `defer close(done)` right after creating it is a reliable habit.

**Blocking on a send/receive with no cancellation case.** A bare `ch <- v` or `<-ch` inside a long-running goroutine, with no `select` on `done`, is uncancellable. If the counterpart ever stops cooperating, the goroutine is stuck. Long-running goroutines should select over their channel op *and* a cancellation signal.

**Forgetting to call the context's `cancel` function.** `context.WithCancel`, `WithTimeout`, and `WithDeadline` all return a `cancel` func that must be called (idiomatically `defer cancel()`) to release the context's resources and unblock anything waiting on `Done()`. Dropping it leaks both the context's internal goroutine/timer and any goroutine relying on it to stop.

**Busy-waiting as a substitute for blocking.** To avoid a blocking send, beginners sometimes spin: `for { select { case ch <- v: ... default: } }`, looping with no pause. This does not leak in the "blocked forever" sense, but it pins a CPU core spinning. The right answer is a blocking `select` over the send and `done` — it parks the goroutine for free and wakes it exactly when one case is ready.

**Assuming the goroutine dies when its channel is garbage-collected.** It does not. A goroutine blocked on a channel keeps that channel reachable (the goroutine references it), so the GC can never collect either. Leaked goroutines are not cleaned up automatically; only a return (triggered by cancellation or a completed operation) ends them.

### Key Takeaways

- A goroutine leak = a goroutine blocked forever on a channel op that will never complete; it is silent and accumulates until memory is exhausted.
- The classic cause is a **consumer returning early** while a producer keeps trying to send — give the producer a way to be told to stop.
- Go has **no way to kill a goroutine externally**; cancellation is cooperative, signalled over a channel.
- Use a `done` channel (or `ctx.Done()`) in a `select` alongside every long-running channel operation so the goroutine has a guaranteed exit path.
- `defer close(done)` / `defer cancel()` ensures the stop signal fires even on early return, panic, or error.
- Verify with `runtime.NumGoroutine()` in tests and the pprof goroutine profile; closing a `done` channel broadcasts cancellation to every goroutine selecting on it.

---

## Broken Code

```go
// broken: the consumer reads two values and returns, but the producer's
// infinite loop keeps trying to send. Its next send blocks forever -> the
// generator goroutine leaks (stack + channel held for the program's life).
package main

import "fmt"

func generate() <-chan int {
    ch := make(chan int)
    go func() {
        for i := 0; ; i++ {
            ch <- i // no cancellation case: blocks forever once nobody reads
        }
    }()
    return ch
}

func main() {
    ch := generate()
    fmt.Println(<-ch) // 0
    fmt.Println(<-ch) // 1
    // main returns here. The generator is now blocked on `ch <- 2` with no
    // receiver and no way to be told to stop. It leaks.
}
```

---

## Correct Code

```go
// correct: a cancellable generator. A `done` channel (closed via defer)
// gives the goroutine a guaranteed exit path, so it never leaks.
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

// generate emits an unbounded stream but selects on `done` for every send,
// so closing `done` lets the goroutine return cleanly instead of blocking.
func generate(done <-chan struct{}) <-chan int {
	ch := make(chan int)
	go func() {
		defer close(ch)
		for i := 0; ; i++ {
			select {
			case ch <- i: // send if a receiver is ready
			case <-done: // OR stop when told to
				return
			}
		}
	}()
	return ch
}

func main() {
	before := runtime.NumGoroutine()

	// A single owner closes `done` exactly once. Using sync.Once makes the
	// close idempotent, so a deferred safety-net close cannot double-close.
	done := make(chan struct{})
	var stopOnce sync.Once
	stop := func() { stopOnce.Do(func() { close(done) }) }
	defer stop() // safety net: fires on any return path, including panics

	ch := generate(done)

	// Consume only a few values, then deliberately stop early.
	total := 0
	for i := 0; i < 5; i++ {
		total += <-ch
	}
	fmt.Println("sum of first 5:", total)

	// Trigger cancellation now and give the generator a moment to unwind,
	// so we can observe that the goroutine count returns to baseline.
	stop()
	time.Sleep(5 * time.Millisecond) // let the generator observe `done`
	after := runtime.NumGoroutine()

	fmt.Printf("goroutines before=%d after=%d (leak-free if equal)\n", before, after)
}
```

---

## Explanation

The broken version is the textbook goroutine leak. `generate` launches a goroutine that loops forever, sending successive integers on an unbuffered channel. `main` receives just two values and then returns. At that point the generator is blocked on `ch <- 2`: there is no receiver, and the goroutine has no mechanism to learn that no one will ever read again. It stays parked on that send for the entire remaining life of the program, holding its stack and keeping the channel alive. In a one-shot program this is harmless because the process exits immediately — but in a long-lived service that calls `generate` per request, each call leaks a goroutine, and the count climbs without bound until the process is killed.

The correct version gives the goroutine an exit path. `generate` now takes a `done` channel and, for every value, uses `select` to wait on *either* the send `ch <- i` *or* the receive `<-done`. While `main` is consuming, the send case wins. The instant `done` is closed, `<-done` becomes ready and the goroutine returns, running `defer close(ch)` on the way out. Because a closed channel is permanently readable, this works as a broadcast: every goroutine watching `done` is released at once. The `defer close(done)` in `main` guarantees the signal fires even if `main` returns via an early path or a panic — the generator can never be stranded.

The example also shows leak *detection*: it records `runtime.NumGoroutine()` before starting work and after cancellation, then prints both. When the generator has properly exited, the count returns to its baseline, demonstrating concretely that no goroutine leaked. Note how the stop signal is owned: a `sync.Once`-wrapped `stop` closure closes `done` exactly once, so the explicit `stop()` after consuming and the deferred `stop()` safety net cannot double-close (which would panic). The lesson is that *some* single owner must always close the signal, and `sync.Once` makes that ownership robust against early returns and panics.

---

## Design Tradeoff

Cooperative cancellation trades **convenience for safety**. A language that let you forcibly kill a goroutine would make leak-prevention trivial in the simple cases — just kill the blocked goroutine — but it would do so at the cost of correctness: a goroutine killed mid-operation might hold a mutex, leave a file partially written, or abandon a half-updated data structure. Go refuses that bargain. By making cancellation a cooperative signal that the goroutine observes at a safe point in its own `select`, Go guarantees that shutdown runs `defer`s, releases locks, and closes channels cleanly. The price is discipline: you must thread a `done` channel or `context.Context` through every long-running goroutine and select on it, which is more wiring than a one-line kill.

In practice this discipline becomes a design constraint that pays for itself. Asking "how does this goroutine stop?" of every goroutine you spawn forces you to design clear ownership and lifecycle boundaries up front, which is exactly the thinking that prevents leaks in the first place. The tradeoff, then, is paying a small, consistent tax at every goroutine launch in exchange for never having to debug a corrupted-state crash caused by an unsafe forced stop — and in exchange for a system whose shutdown behavior is explicit and verifiable rather than abrupt and hidden.

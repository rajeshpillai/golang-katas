---
id: rate-limiting
phase: 15
phase_title: Advanced Concurrency Patterns
sequence: 4
title: Rate Limiting
---

## Description

### Concept Overview

**Rate limiting** controls *how often* an operation may happen over time — for example, "no more than 5 requests per second" to a downstream API. It is distinct from backpressure (which bounds *how much* work is in flight) and from worker pools (which bound *how many* operations run *simultaneously*). A worker pool of size 3 might still fire thousands of requests per second if each one is fast; a rate limiter caps the *frequency* regardless of how quickly each operation completes. You reach for rate limiting whenever you must respect an external quota, protect a fragile dependency, or smooth bursty traffic into a steady stream.

Go's standard library gives you the raw materials to build rate limiters out of time and channels. The two foundational techniques are the **ticker** (a channel that delivers a value at a fixed interval) and the **token bucket** (a buffer of permits that refills over time, allowing controlled bursts). Both are assembled from `time` and channel primitives you already know, which keeps the mechanism transparent rather than hidden behind a framework.

### Technical Explanation

**`time.Ticker` for steady-rate limiting.** A `time.Ticker` sends the current time on its channel `C` once per interval. To enforce a maximum rate, you receive from the ticker *before* each operation — the receive blocks until the next tick, pacing the loop to exactly one operation per interval.

```go
limiter := time.NewTicker(200 * time.Millisecond) // 5 ops/sec
defer limiter.Stop() // CRITICAL: release the ticker's resources

for _, req := range requests {
    <-limiter.C        // blocks until the next tick -> paces the loop
    handle(req)
}
```

Each iteration waits for a tick before proceeding, so operations happen no faster than one every 200ms. `limiter.Stop()` is mandatory: a ticker holds a runtime timer, and failing to stop it leaks that timer (the ticker's goroutine keeps firing) for the life of the program.

**Token bucket for bursty rate limiting.** A steady ticker forbids bursts entirely — even if you were idle for a minute, you still get only one op per interval. A *token bucket* allows short bursts up to a capacity while enforcing the average rate over time. Model the bucket as a buffered channel pre-filled with tokens; a background ticker refills it (without overflowing capacity), and each operation must take a token first.

```go
const burst = 3
bucket := make(chan struct{}, burst)
for i := 0; i < burst; i++ {
    bucket <- struct{}{} // start full -> an initial burst is allowed
}

refill := time.NewTicker(200 * time.Millisecond) // 5 tokens/sec
defer refill.Stop()
go func() {
    for range refill.C {
        select {
        case bucket <- struct{}{}: // add a token if there is room
        default:                   // bucket full -> drop the token
        }
    }
}()

for _, req := range requests {
    <-bucket // take a token; blocks if the bucket is empty
    handle(req)
}
```

When the bucket starts full, the first `burst` operations proceed immediately (the burst), then the loop is paced by the refill rate. The `select`/`default` in the refiller is important: it prevents the refill from blocking when the bucket is already full, capping the burst size at `burst`.

**Stopping cleanly.** Both designs depend on stopping the ticker. In a long-lived limiter, the refill goroutine should also exit on a `done` signal so it does not leak after the limiter is no longer used:

```go
go func() {
    for {
        select {
        case <-done:
            return
        case <-refill.C:
            select {
            case bucket <- struct{}{}:
            default:
            }
        }
    }
}()
```

This combines rate limiting with the leak-avoidance discipline of the next kata: every goroutine the limiter spawns has a guaranteed exit path.

### Design Rationale

In Java you would typically reach for a library — Guava's `RateLimiter`, or a `ScheduledExecutorService` with hand-rolled token accounting and synchronization. These work but encapsulate the timing logic inside objects with their own locking. Go takes the opposite stance: time is exposed as a *channel of events*. A `time.Ticker` is not a callback or a scheduled task; it is a channel you receive from, which means rate limiting composes with every other channel pattern. You can `select` over a ticker and a cancellation signal together; you can pipe ticks into a worker pool; you can combine a ticker-paced loop with a bounded buffer for backpressure.

This is Go's design ethos applied to time:

> Share memory by communicating.

A tick is communicated over a channel rather than scheduled behind a lock. Because the limiter is built from `time` plus channels, its behavior is fully visible in the code — you can read exactly when an operation is allowed and why. Go deliberately keeps the primitives small and composable instead of shipping a heavyweight rate-limiter object, trusting you to assemble precisely the policy (steady vs. bursty, with or without cancellation) your situation needs. (For production needs, `golang.org/x/time/rate` provides a polished token-bucket limiter — but understanding the channel-based mechanism is what makes it unmysterious.)

### Common Mistakes

**Forgetting `ticker.Stop()`.** A `time.Ticker` owns a runtime timer and an internal mechanism that keeps firing forever. If you create one without `defer ticker.Stop()`, you leak that timer for the program's lifetime; in code that creates limiters repeatedly, these leaks accumulate. Always pair `NewTicker` with `Stop`.

**Using `time.Sleep` in the loop instead of a ticker, and getting drift.** `for { do(); time.Sleep(d) }` makes the *interval between the end of one op and the start of the next* equal to `d`, so the effective period is `d + workDuration` — the rate drifts slower than intended as work time accumulates. A ticker fires on a fixed wall-clock cadence independent of how long each op takes, so the rate stays accurate.

**Busy-waiting on the clock.** Polling `time.Now()` in a tight loop until enough time has passed (`for time.Since(last) < d {}`) burns a CPU core doing nothing. Receiving from a ticker channel parks the goroutine and wakes it exactly when the tick arrives — no spinning.

**Letting the refill goroutine block or leak.** If the token-bucket refiller does a plain `bucket <- struct{}{}` and the bucket is full, the refiller blocks, stalling refills and possibly leaking. Use `select`/`default` so a full bucket simply drops the extra token. And give the refiller a `done`/context exit, or it outlives the limiter as a leaked goroutine.

**Confusing rate limiting with concurrency limiting.** A worker pool caps *simultaneous* operations, not their *frequency*. If each operation is fast, a 3-worker pool can still issue thousands of calls per second. When the constraint is "X per second," you need a ticker or token bucket — bounding concurrency alone will not satisfy a per-second quota.

### Key Takeaways

- Rate limiting bounds operations *per unit of time*; it is distinct from concurrency limits (simultaneous ops) and backpressure (in-flight work).
- A `time.Ticker` delivers ticks on a channel; receiving from it before each op paces a loop to a steady rate.
- Always `defer ticker.Stop()` — an unstopped ticker leaks a runtime timer for the program's lifetime.
- A **token bucket** (a buffered channel of permits refilled by a ticker) allows controlled bursts while enforcing the average rate.
- Use `select`/`default` when refilling so a full bucket drops extra tokens instead of blocking, and give refill goroutines a `done` exit to avoid leaks.
- Prefer ticker-based pacing over `time.Sleep`-in-loop, which drifts, and over busy-waiting, which burns CPU.

---

## Broken Code

```go
// broken: sleeps a fixed duration AFTER each call, so the real rate drifts
// (period = sleep + work time), and uses a ticker that is never stopped,
// leaking its runtime timer for the life of the program.
package main

import (
    "fmt"
    "time"
)

func handle(req int) {
    time.Sleep(120 * time.Millisecond) // the work itself takes time
    fmt.Println("handled", req)
}

func main() {
    // Bug 1: NewTicker is created but never Stop()'d -> leaked timer.
    _ = time.NewTicker(200 * time.Millisecond)

    requests := []int{1, 2, 3, 4, 5}
    for _, r := range requests {
        handle(r)
        // Bug 2: sleeping after the work means the effective interval is
        // 200ms + 120ms = 320ms, not the intended 200ms. The rate drifts
        // and depends on how long handle() happens to take.
        time.Sleep(200 * time.Millisecond)
    }
}
```

---

## Correct Code

```go
// correct: steady-rate pacing with a ticker, plus a token-bucket limiter
// that allows a small burst. Both are stopped cleanly; no goroutine leaks.
package main

import (
	"fmt"
	"time"
)

func main() {
	// --- Part 1: steady rate with time.Ticker (5 ops/sec) ---
	steady := time.NewTicker(20 * time.Millisecond)
	defer steady.Stop() // mandatory: release the runtime timer

	fmt.Println("steady-rate pass:")
	for i := 1; i <= 5; i++ {
		<-steady.C // block until the next tick -> paces the loop
		fmt.Printf("  op %d at +%v\n", i, time.Duration(i)*20*time.Millisecond)
	}

	// --- Part 2: token bucket allowing a burst of 3, then 1 per tick ---
	const burst = 3
	bucket := make(chan struct{}, burst)
	for i := 0; i < burst; i++ {
		bucket <- struct{}{} // start full so an initial burst is allowed
	}

	refill := time.NewTicker(15 * time.Millisecond)
	defer refill.Stop()

	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-done: // guaranteed exit -> no leaked goroutine
				return
			case <-refill.C:
				select {
				case bucket <- struct{}{}: // add a token if room
				default: // bucket full -> drop the token, cap the burst
				}
			}
		}
	}()

	fmt.Println("token-bucket pass (first 3 are an instant burst):")
	for i := 1; i <= 6; i++ {
		<-bucket // take a token; blocks once the burst is spent
		fmt.Printf("  request %d\n", i)
	}

	close(done) // stop the refill goroutine before returning
	fmt.Println("done")
}
```

---

## Explanation

The broken version gets the rate wrong in two ways. First, it creates a `time.Ticker` and never stops it; the ticker's underlying timer keeps running, leaking that resource for the rest of the program. Second, and more subtly, it paces the loop by sleeping a fixed 200ms *after* each call to `handle`. But `handle` itself takes 120ms, so the real interval between operations is 200ms + 120ms = 320ms. The intended rate of 5 ops/sec silently becomes about 3 ops/sec, and it drifts further whenever the work takes longer. Sleeping relative to the end of variable-length work cannot produce a stable rate.

The correct version uses a `time.Ticker`, which fires on a fixed wall-clock cadence regardless of how long each operation takes. Receiving `<-steady.C` before each operation blocks until the next tick, so the loop runs at exactly the ticker's interval — the rate is accurate and independent of work duration. Crucially, `defer steady.Stop()` releases the ticker's timer when the function returns.

The second part demonstrates a token bucket, which adds *burst* tolerance. The bucket is a buffered channel pre-filled with three tokens, so the first three requests proceed instantly — that is the allowed burst. After the burst is spent, each subsequent request must wait for the refill ticker to drop a new token into the bucket, pacing the steady-state rate. The refiller uses `select`/`default` so it never blocks when the bucket is full (capping the burst at three), and it listens on a `done` channel so that `close(done)` gives it a guaranteed exit. Combined with stopping both tickers, the program terminates with no leaked goroutines and no dangling timers.

---

## Design Tradeoff

The central tradeoff in rate limiting is **burst tolerance versus smoothness**. A pure ticker enforces a perfectly even cadence — exactly one operation per interval, never two close together — which is gentlest on a fragile downstream service but wastes allowance: if you were idle, you cannot "catch up" by going faster afterward. A token bucket trades some of that smoothness for the ability to absorb bursts: it lets a backlog of unused allowance accumulate (up to the bucket's capacity) and spend it in a quick burst, which improves latency for sporadic traffic but can briefly hit the downstream with `burst` operations at once. Choosing between them is choosing how much short-term spikiness the protected resource can tolerate.

There is also the question of **build versus borrow**. The channel-and-ticker construction shown here is transparent and composes naturally with cancellation and worker pools, which makes it ideal for learning and for bespoke policies. For production traffic shaping with well-defined burst and rate parameters, `golang.org/x/time/rate` offers a battle-tested token-bucket limiter with a cleaner API and better precision. The tradeoff is the usual one: the hand-rolled version is fully visible and dependency-free but requires you to get the stopping and leak-avoidance right yourself, while the library version hides those details behind a tested abstraction.

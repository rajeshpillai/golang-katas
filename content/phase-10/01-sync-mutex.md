---
id: sync-mutex
phase: 10
phase_title: Synchronization & Coordination
sequence: 1
title: sync.Mutex
---

## Description

### Concept Overview

When two or more goroutines access the same piece of memory at the same time, and at least one of them is writing, you have a **data race**. A data race is not a stylistic problem — it is undefined behavior. The result of a racy program is not merely "sometimes wrong"; it is unpredictable in a way the Go memory model explicitly refuses to define. The program might produce a wrong count, corrupt a data structure, or appear to work for a million runs and then fail in production.

A `sync.Mutex` (mutual exclusion lock) is Go's most basic tool for fixing this. A mutex guarantees that only one goroutine at a time can be inside the **critical section** — the region of code between `Lock()` and `Unlock()`. Every other goroutine that calls `Lock()` blocks until the holder calls `Unlock()`. This serializes access to shared state, turning a chaotic free-for-all into an orderly, one-at-a-time sequence.

The zero value of a `sync.Mutex` is an unlocked, ready-to-use mutex. You never call a constructor and you never initialize it. You simply declare it — typically as a field next to the data it protects — and use it.

### Technical Explanation

**The interface is two methods.** `mu.Lock()` acquires the lock; `mu.Unlock()` releases it. There is no "try with timeout" on the base type and no read/write distinction (that is `sync.RWMutex`, covered next). Between a successful `Lock()` and the matching `Unlock()`, the calling goroutine holds exclusive access. The Go runtime maintains a queue of waiting goroutines, and the scheduler parks blocked goroutines so they consume no CPU while waiting.

**A mutex protects data, not code.** This is the single most important mental model. A mutex does not magically know which variables are "shared." It only enforces that one goroutine runs the critical section at a time. *You* must ensure that every access to the shared data — every read and every write — happens while holding the same mutex. If even one goroutine touches the data without locking, the race is back and the mutex gave you false confidence.

```go
type Counter struct {
    mu    sync.Mutex
    value int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.value++ // safe: only one goroutine is ever here
}
```

**`defer c.mu.Unlock()` is the idiomatic release pattern.** It guarantees the lock is released even if the critical section returns early or panics. Without `defer`, an early `return` or a panic between `Lock` and `Unlock` leaves the mutex locked forever, and every other goroutine that touches it deadlocks. The small cost of a deferred call is almost always worth the safety.

**The Go memory model and happens-before.** Beyond mutual exclusion, a mutex provides a memory ordering guarantee. The Go memory model states: for a `sync.Mutex`, the n-th call to `Unlock()` *happens-before* the (n+1)-th call to `Lock()` returns. "Happens-before" is the formal relationship that guarantees one goroutine's writes are visible to another. Without such a relationship, a write in goroutine A might never become visible to goroutine B — modern CPUs and compilers freely reorder and cache memory operations. The mutex establishes the synchronization point that makes writes inside one critical section visible to the next goroutine that locks. This is why a mutex fixes not just "two writes colliding" but also "stale reads."

**Mutexes must not be copied after first use.** A `sync.Mutex` contains internal state (a lock flag and a wait queue). Copying it — by passing the containing struct by value, or assigning it — duplicates that state, producing two independent mutexes that no longer coordinate. `go vet` detects many of these cases. This is why methods that touch the mutex use **pointer receivers** (`func (c *Counter)`), and why you pass `*Counter`, never `Counter`, between goroutines.

**Detecting races.** Go ships with a race detector. Run `go run -race main.go` or `go test -race ./...`. It instruments memory accesses and reports, at runtime, any unsynchronized concurrent access along with the two stacks involved. It is the single most valuable tool in concurrent Go. The cost: roughly 2–10x slower and more memory, so it is used in testing and CI, not production.

### Design Rationale

Go is famous for the slogan "Don't communicate by sharing memory; share memory by communicating" — the channel/CSP style. Yet the standard library ships a full `sync` package with mutexes. Why both?

Because they solve different problems. Channels excel at **transferring ownership** of data and orchestrating the *flow* of work between goroutines — pipelines, fan-out, signaling. Mutexes excel at **protecting state that stays in place** — a shared counter, an in-memory cache, a connection pool's bookkeeping. Forcing a cache behind a channel-owning goroutine adds indirection, latency, and complexity for no benefit. The Go team's own guidance (in the wiki and standard library) is pragmatic: *use whichever is simpler and clearer for the problem.* A mutex around a map is often the most honest, readable solution.

This is why Go gives you both styles as first-class tools rather than picking a religion. The mutex is deliberately minimal — two methods, a useful zero value, no reentrancy — because a small, sharp tool is easier to reason about than a configurable one.

### Common Mistakes

**Copying a struct that contains a mutex.** Passing a `Counter` (value) instead of `*Counter` (pointer) to a goroutine copies the mutex. Each goroutine then locks its *own* copy, so no exclusion happens at all. `go vet` flags this with "passes lock by value." Always use pointer receivers and pass pointers.

**Forgetting to `Unlock()`** — or unlocking on only some paths. If a critical section has an early `return` or can panic before `Unlock()`, the lock is never released and the next `Lock()` blocks forever (a deadlock). Use `defer mu.Unlock()` immediately after `Lock()` so there is exactly one, unconditional release.

**Protecting only the writes, not the reads.** A mutex guarantees nothing if some goroutines read the shared variable without locking. Reading an `int` that another goroutine is writing is still a data race. *Every* access — read and write — must hold the lock.

**Holding the lock too long.** Doing slow work (I/O, network calls, channel sends) while holding the mutex serializes the whole system and can cause deadlocks if the slow work tries to acquire another lock. Lock, touch the shared state quickly, unlock, then do the slow work.

**Assuming the mutex is reentrant.** Go's `sync.Mutex` is *not* reentrant. If a goroutine that holds the lock calls another method that also calls `Lock()` on the same mutex, it deadlocks against itself. Structure code so a locked method never calls another locked method on the same mutex.

### Key Takeaways

- A data race is undefined behavior, not just a wrong answer — never reason about what a racy program "probably" does.
- A `sync.Mutex` serializes access to a critical section; its zero value is ready to use, so just declare it next to the data it protects.
- A mutex protects *data*, not code — every read and every write of the shared state must hold the same lock.
- Always pair `Lock()` with `defer Unlock()` so the lock is released on every path, including panics.
- Never copy a mutex; use pointer receivers and pass pointers so all goroutines share one lock.
- Beyond exclusion, a mutex establishes a happens-before relationship that makes one goroutine's writes visible to the next — and `go run -race` / `go test -race` will catch the cases where you forgot.

---

## Broken Code

```go
// broken: data race — many goroutines mutate `count` with no synchronization.
// Run with `go run -race main.go` and the race detector reports concurrent
// read/write on `count`. The final value is unpredictable and usually < 100000.
package main

import (
	"fmt"
	"sync"
)

func main() {
	var wg sync.WaitGroup
	count := 0

	for i := 0; i < 100000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			count++ // RACE: read-modify-write with no lock
		}()
	}

	wg.Wait()
	fmt.Println("final count:", count) // not reliably 100000
}
```

---

## Correct Code

```go
// correct: a Counter that protects its state with a sync.Mutex.
// Runs cleanly under `go run -race main.go` and always prints 100000.
package main

import (
	"fmt"
	"sync"
)

// Counter bundles the mutex with the data it guards. Methods use pointer
// receivers so every goroutine shares the same lock and the same value.
type Counter struct {
	mu    sync.Mutex
	value int
}

// Inc safely increments the counter. The critical section is tiny: lock,
// mutate, unlock. defer guarantees release even if something panics.
func (c *Counter) Inc() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value++
}

// Value safely reads the counter. Reads must lock too, otherwise a read
// concurrent with a write is still a data race.
func (c *Counter) Value() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.value
}

func main() {
	c := &Counter{} // pointer: all goroutines share this one Counter
	var wg sync.WaitGroup

	const goroutines = 100000
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.Inc()
		}()
	}

	wg.Wait()
	fmt.Printf("final count: %d (expected %d)\n", c.Value(), goroutines)
}
```

---

## Explanation

The broken version launches 100,000 goroutines that each run `count++`. That single line is deceptively three operations: read `count`, add one, write `count` back. With no synchronization, two goroutines can read the same value, both add one, and both write back the same result — losing an increment. Because the interleavings depend on the scheduler and the hardware, the final value varies run to run and is almost always less than 100,000. The race detector (`go run -race`) reports the conflicting read and write directly, pointing at the exact line.

The correct version wraps the shared `value` in a `Counter` struct that owns a `sync.Mutex`. Both `Inc()` and `Value()` acquire the lock before touching `value` and release it with `defer`. Because every access holds the *same* mutex, the runtime serializes them: the read-modify-write in `Inc()` is now atomic with respect to other goroutines, and the read in `Value()` never observes a half-finished write. Note the deliberate choices — pointer receivers, and constructing `&Counter{}` (a pointer) — so that all goroutines coordinate through one lock rather than copies.

Crucially, the mutex does more than prevent simultaneous execution. It establishes the happens-before ordering that the Go memory model requires for the writes in one critical section to be visible to the next goroutine that locks. That is why the final value is reliably exactly 100,000, every time, on every platform.

---

## Design Tradeoff

A mutex trades concurrency for correctness. Every increment now passes through a single lock, so the 100,000 goroutines proceed essentially one at a time through the critical section — there is no parallelism in the hot path. For a tiny critical section like `value++` this overhead is negligible and the simplicity is a huge win. But if the protected work were large, this serialization would become the bottleneck, and you would look at sharding the data, using `sync/atomic` for simple counters, or redesigning around channels and ownership.

The deeper tradeoff is between the two coordination styles Go offers. A mutex keeps the data in place and guards it — simple, direct, and obvious to a reader who sees the lock next to the field. Channels move the data and avoid shared state entirely, which can be cleaner for pipelines but heavier for a plain shared counter. Go deliberately ships both and refuses to declare a winner: choose the mutex when you are protecting stationary state, and reach for channels when you are coordinating the flow of work.

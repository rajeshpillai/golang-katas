---
id: sync-rwmutex
phase: 10
phase_title: Synchronization & Coordination
sequence: 2
title: sync.RWMutex
---

## Description

### Concept Overview

A plain `sync.Mutex` is pessimistic: it lets exactly one goroutine into the critical section, whether that goroutine is reading or writing. But many real workloads are **read-heavy** — a configuration map read thousands of times per second and written once a minute, an in-memory cache, a routing table. For those, serializing every read is wasteful. Two goroutines that both only *read* the same data cannot corrupt it; there is no reason to block one while the other reads.

A `sync.RWMutex` (reader/writer mutex) captures exactly this asymmetry. It offers two modes of locking. A **read lock** (`RLock`/`RUnlock`) can be held by *many* goroutines at once — concurrent readers run in parallel. A **write lock** (`Lock`/`Unlock`) is exclusive — while a writer holds it, no readers and no other writers may proceed. The invariant is simple: any number of readers, *or* a single writer, but never both.

Like `sync.Mutex`, the zero value of `sync.RWMutex` is ready to use. You declare it next to the data it protects and never construct it.

### Technical Explanation

**Four methods, two pairs.** `RLock()` / `RUnlock()` acquire and release a shared read lock. `Lock()` / `Unlock()` acquire and release an exclusive write lock. Each `RLock()` must be matched by exactly one `RUnlock()`, and each `Lock()` by one `Unlock()`. As with `sync.Mutex`, `defer` is the idiomatic way to guarantee the release:

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.data[key] // many readers may run this concurrently
    return v, ok
}

func (c *Cache) Set(key, val string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[key] = val // exclusive: no readers, no other writers
}
```

**The semantics in detail.** When a goroutine calls `RLock()` and no writer holds (or is waiting for) the lock, it proceeds immediately, and other readers can join. When a goroutine calls `Lock()`, it must wait for all current readers to call `RUnlock()`, and once it holds the write lock, all new `RLock()` and `Lock()` calls block until it calls `Unlock()`. Go's implementation also takes care to prevent **writer starvation**: once a writer is waiting, newly arriving readers are blocked behind it rather than continuously jumping ahead. Without this, a steady stream of readers could keep a writer waiting forever.

**Memory model guarantees.** The Go memory model gives `RWMutex` the same happens-before guarantees you need for visibility. For any call to `RLock`, there is a previous `Unlock` such that the writer's writes are visible to the reader, and a reader's `RUnlock` happens-before a subsequent `Lock` returns. In plain terms: a reader that takes the read lock sees all writes made by the last writer to hold the write lock. You get both mutual exclusion *and* memory visibility, just as with a plain mutex.

**Read locks are not reentrant, and mixing modes deadlocks.** You must not upgrade a read lock to a write lock by calling `Lock()` while holding `RLock()` — that deadlocks, because `Lock()` waits for all readers (including you) to release. You also must not recursively `RLock()` in a way that can interleave with a waiting writer. Keep each critical section to a single, clearly-scoped lock mode.

**Do not copy it.** Exactly like `sync.Mutex`, an `RWMutex` carries internal state and must never be copied after first use. Use pointer receivers and pass `*Cache`, not `Cache`. `go vet` flags lock-by-value mistakes.

**When the read path is genuinely tiny, prefer a plain Mutex.** `RWMutex` is heavier than `Mutex` — it tracks reader counts and writer intent, so each `RLock`/`RUnlock` does more bookkeeping than `Lock`/`Unlock`. It only pays off when reads are frequent, hold the lock long enough to overlap, and substantially outnumber writes. For a one-line read, a plain `Mutex` is often faster and simpler.

### Design Rationale

Why does Go offer a separate type instead of making `Mutex` "smart"? Because the read/write distinction is information only the programmer has. The lock cannot know whether a critical section will mutate the data; you assert that by choosing `RLock` (promise: I will only read) versus `Lock` (I may write). Keeping the two types separate makes that assertion explicit and auditable — a reader of the code sees `RLock` and immediately knows the section is read-only.

This fits Go's broader philosophy of small, sharp, explicit tools. Rather than one configurable lock with modes and options, Go gives you `Mutex` for the common case and `RWMutex` for the specific read-heavy case, each with a minimal surface. The choice between them is a deliberate, visible decision, not a hidden runtime heuristic. And as always, channels remain an alternative for cases where you would rather hand data to a single owning goroutine than guard shared state in place — Go expects you to pick the model that reads most clearly for the problem.

### Common Mistakes

**Using `Lock()` for reads.** If every method takes the exclusive `Lock()`, an `RWMutex` behaves exactly like a `Mutex` and you get none of the read concurrency you paid for. Read-only paths must use `RLock()`.

**Using `RLock()` for a write.** The opposite, and far worse: taking a read lock and then mutating the data lets multiple "readers" write concurrently. That is a data race, and the read lock gives you false confidence. Any path that modifies the data must take the exclusive `Lock()`.

**Trying to upgrade a read lock to a write lock.** Calling `Lock()` while still holding `RLock()` deadlocks, because the writer waits for all readers — including the one trying to upgrade — to release. Release the read lock first, then take the write lock (and re-validate, since the world may have changed in between).

**Mismatched lock/unlock pairs.** Pairing `RLock()` with `Unlock()` (or `Lock()` with `RUnlock()`) corrupts the lock's internal accounting and causes panics or deadlocks. Use `defer` and keep the pairs obviously matched.

**Copying the RWMutex.** Passing the containing struct by value copies the lock, so goroutines coordinate through different locks and the protection silently disappears. Always pass pointers; let `go vet` and `go test -race` catch the slips.

### Key Takeaways

- `sync.RWMutex` allows many concurrent readers *or* one exclusive writer — never both at once.
- Use `RLock`/`RUnlock` for read-only sections and `Lock`/`Unlock` for any section that mutates; the choice is your explicit promise about what the code does.
- Its zero value is ready to use; pair every lock with a `defer`-ed unlock, and never mismatch the read/write pairs.
- Never upgrade a read lock to a write lock in place — release first, then re-acquire, because `Lock` waits for all readers.
- `RWMutex` only beats a plain `Mutex` when reads are frequent, overlapping, and dominate writes; for tiny read paths a `Mutex` is simpler and often faster.
- Never copy the lock; use pointer receivers, and verify with `go test -race` and `go vet`.

---

## Broken Code

```go
// broken: uses RLock() for a write. Multiple "readers" mutate the map at once,
// which is a data race AND a concurrent map write that can crash the program.
// `go run -race main.go` reports the race; the runtime may also panic with
// "fatal error: concurrent map writes".
package main

import (
	"fmt"
	"sync"
)

type Cache struct {
	mu   sync.RWMutex
	data map[string]int
}

func (c *Cache) Set(key string, val int) {
	c.mu.RLock()         // WRONG: a read lock for a write
	defer c.mu.RUnlock() //        many goroutines mutate `data` concurrently
	c.data[key] = val
}

func main() {
	c := &Cache{data: map[string]int{}}
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			c.Set(fmt.Sprintf("k%d", n), n)
		}(i)
	}
	wg.Wait()
	fmt.Println("size:", len(c.data))
}
```

---

## Correct Code

```go
// correct: a read-heavy Cache guarded by an RWMutex.
// Reads share an RLock and run concurrently; writes take the exclusive Lock.
// Runs cleanly under `go run -race main.go` and prints a deterministic total.
package main

import (
	"fmt"
	"sync"
)

// Cache bundles the RWMutex with the map it protects. Pointer receivers ensure
// every goroutine shares the same lock and the same map.
type Cache struct {
	mu   sync.RWMutex
	data map[string]int
}

func NewCache() *Cache {
	return &Cache{data: make(map[string]int)}
}

// Get takes a shared read lock: many readers may run this at the same time.
func (c *Cache) Get(key string) (int, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	v, ok := c.data[key]
	return v, ok
}

// Set takes the exclusive write lock: no readers and no other writers run
// while the map is being mutated.
func (c *Cache) Set(key string, val int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data[key] = val
}

func main() {
	c := NewCache()
	var wg sync.WaitGroup

	// Writers: populate keys k0..k999 (exclusive locks).
	const n = 1000
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(k int) {
			defer wg.Done()
			c.Set(fmt.Sprintf("k%d", k), k)
		}(i)
	}
	wg.Wait()

	// Readers: many goroutines read concurrently (shared locks) and sum values.
	var sum int64
	var smu sync.Mutex
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(k int) {
			defer wg.Done()
			if v, ok := c.Get(fmt.Sprintf("k%d", k)); ok {
				smu.Lock()
				sum += int64(v)
				smu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	fmt.Printf("entries: %d, sum of values: %d (expected %d)\n",
		n, sum, int64(n*(n-1)/2))
}
```

---

## Explanation

The broken version makes the most dangerous `RWMutex` mistake: it guards a *write* with `RLock()`. A read lock is shared, so many goroutines hold it simultaneously — and they all execute `c.data[key] = val` at the same time. That is two failures at once. First, it is a data race on the map's internals, which the race detector reports. Second, Go's runtime actively detects concurrent map writes and may abort the whole program with `fatal error: concurrent map writes`. The read lock provided no protection because it was never meant to; the programmer's choice of `RLock` was a false promise that the section only reads.

The correct version assigns lock modes by what the code actually does. `Set()` mutates the map, so it takes the exclusive `Lock()` — while a writer holds it, no reader and no other writer can proceed, so the map is mutated safely. `Get()` only reads, so it takes the shared `RLock()`, allowing the thousand reader goroutines to run concurrently. The result is deterministic: every key from 0 to 999 is present, and the sum of the values is exactly `n*(n-1)/2`. The program runs cleanly under `-race` because every access uses the appropriate lock and the `RWMutex` supplies the happens-before ordering that makes the writers' updates visible to the readers.

(The small `smu` mutex in `main` simply protects the `sum` accumulator across reader goroutines — a reminder that *every* shared mutable value, not just the cache, needs its own synchronization.)

---

## Design Tradeoff

`RWMutex` trades a heavier lock for read parallelism. Each `RLock`/`RUnlock` does more bookkeeping than a plain `Mutex` — tracking the reader count and writer intent — so on a write-heavy or low-contention workload an `RWMutex` is actually *slower* than a `Mutex` while adding complexity. It only earns its keep when reads are frequent, hold the lock long enough to overlap, and dominate writes. The honest engineering move is to start with a plain `Mutex`, and switch to `RWMutex` only when profiling shows that read contention is a real bottleneck.

There is also a subtler tradeoff: the read/write distinction pushes correctness onto the programmer. The lock trusts your choice of `RLock` versus `Lock`; choose wrong and you either lose concurrency (using `Lock` everywhere) or lose safety (using `RLock` for writes). Go accepts that cost because the alternative — a lock that inspects the critical section to guess its intent — is impossible. Explicitness is the price of the optimization, and `go test -race` is the safety net that catches the mistakes.

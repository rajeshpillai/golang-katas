---
id: atomic-operations
phase: 10
phase_title: Synchronization & Coordination
sequence: 4
title: Atomic Operations
---

## Description

### Concept Overview

A mutex protects an arbitrary block of code. But sometimes the shared state is a single integer — a request counter, a flag, a sequence number — and all you need is to read it, modify it, and write it back without another goroutine interleaving. For that narrow case, locking a mutex is heavier than necessary. The `sync/atomic` package provides **atomic operations**: indivisible read-modify-write primitives that the CPU itself guarantees cannot be split apart.

"Atomic" means the operation happens as one indivisible step from the perspective of every other goroutine. An atomic `Add` reads the current value, adds, and stores the result with no observable intermediate state — no two goroutines can both read the same old value and lose an update the way they can with a plain `count++`. The hardware provides special instructions (compare-and-swap, atomic add) and `sync/atomic` exposes them in a portable, type-safe way.

### Technical Explanation

**The typed wrappers (Go 1.19+).** Modern Go provides atomic types — `atomic.Int64`, `atomic.Int32`, `atomic.Uint64`, `atomic.Bool`, `atomic.Pointer[T]`, and `atomic.Value` — whose methods are the only correct way to touch the underlying value. Prefer these over the older free functions, because the type makes it structurally impossible to accidentally access the value non-atomically.

```go
var counter atomic.Int64

counter.Add(1)        // atomic increment, returns the new value
n := counter.Load()   // atomic read
counter.Store(0)      // atomic write
swapped := counter.CompareAndSwap(5, 6) // CAS: set to 6 only if currently 5
```

**The four fundamental operations:**

- **Load** — atomically read the current value. Reading without `Load` while another goroutine writes is a data race.
- **Store** — atomically write a new value.
- **Add** — atomically add a delta and return the new value. This is the whole read-modify-write fused into one indivisible step, which is exactly what plain `count++` is *not*.
- **CompareAndSwap (CAS)** — atomically: if the value equals `old`, set it to `new` and report success; otherwise do nothing and report failure. CAS is the building block of lock-free algorithms — you read the current value, compute a new one, and CAS it in; if another goroutine changed it meanwhile, CAS fails and you retry.

**Why `count++` is not atomic.** The statement `count++` compiles to three machine steps: load `count` into a register, increment the register, store it back. Between any two of those steps another goroutine can run. Two goroutines can both load `5`, both increment to `6`, and both store `6` — one increment is lost. `counter.Add(1)` collapses those three steps into one instruction the hardware guarantees is indivisible, so no update can be lost.

**Memory model guarantees.** Atomic operations are not just indivisible; they also establish happens-before edges, just like mutexes. The Go memory model specifies that atomic operations on a given value are sequentially consistent with respect to each other. Concretely: a `Store` happens-before a `Load` that observes the stored value. So atomics give you both indivisibility *and* cross-goroutine visibility — a `Load` sees the latest `Store`, not a stale cached copy.

**All access must go through atomics.** This mirrors the mutex rule. An atomic operation only coordinates with *other atomic operations on the same variable*. If one goroutine does `counter.Add(1)` while another reads the raw underlying integer non-atomically, that is still a data race. With the typed wrappers, the unexported field makes raw access impossible, which is the main reason to prefer them.

**Don't copy atomic types.** `atomic.Int64` and friends carry a `noCopy` marker; copying one after use is flagged by `go vet`. Embed them in a struct and use pointer receivers, exactly as with mutexes.

### Design Rationale

Why offer atomics when mutexes already work? Two reasons: performance and expressiveness. For a single shared counter under high contention, an atomic `Add` is dramatically cheaper than locking and unlocking a mutex around `count++` — it is one CPU instruction versus a lock acquisition, a memory barrier, and a release. At scale (per-request metrics, hit counters) that difference is real.

But Go deliberately keeps atomics *narrow*. They operate on one word-sized value at a time. The moment your invariant spans two variables — "increment count and append to a slice together" — atomics cannot express it, and you need a mutex (or channels). This is intentional: atomics are a sharp, low-level tool for the single-value case, not a general replacement for locks. The Go team's guidance is explicit: reach for a mutex first; use atomics only when profiling shows a hot single-value counter or when you are implementing a known lock-free pattern with CAS. Cleverness with atomics is a frequent source of subtle bugs, so Go nudges you toward the boringly-correct mutex unless you have a measured reason not to.

### Common Mistakes

**Mixing atomic and non-atomic access.** Using `counter.Add(1)` in one place but reading the raw value (or the old free-function API on a plain `int64` that someone also reads directly) elsewhere reintroduces the race. Every access to the value must be atomic. The typed wrappers prevent this by hiding the field.

**Using atomics for multi-variable invariants.** Atomics make *each* operation indivisible, but a sequence of atomic operations is not collectively atomic. "If `a` is 0, set `b` to 1" across two separate atomic variables has a gap between the two operations where another goroutine can interleave. Multi-variable invariants need a mutex.

**Non-atomic read-modify-write built from separate Load and Store.** Writing `counter.Store(counter.Load() + 1)` is *not* atomic — it is a `Load`, then arithmetic, then a `Store`, with a gap in the middle exactly like `count++`. Use the fused `Add`, or a CAS-retry loop, never separate `Load`/`Store` for a read-modify-write.

**Forgetting that CAS can fail and needs a retry loop.** `CompareAndSwap` returns `false` when the value changed underneath you. Lock-free updates must loop: load, compute, CAS, and retry on failure. Ignoring the return value silently drops updates.

**Copying the atomic value.** Passing a struct that embeds an `atomic.Int64` by value copies the counter; the copy diverges from the original. Use pointers, and let `go vet` flag the copy.

### Key Takeaways

- Atomic operations are indivisible read-modify-write primitives for single word-sized values — the right tool when a mutex would be overkill for one shared number or flag.
- Prefer the typed wrappers (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`); they make non-atomic access structurally impossible.
- `count++` is three machine steps and is racy; `counter.Add(1)` fuses them into one indivisible step.
- Atomics provide happens-before visibility too — a `Load` sees the latest `Store` — so you avoid stale reads as well as lost updates.
- Atomics only coordinate among themselves; every access must be atomic, and they cannot express invariants that span multiple variables.
- Reach for a mutex first; use atomics only for a measured hot single-value counter or a deliberate CAS-based lock-free pattern, and verify with `go test -race`.

---

## Broken Code

```go
// broken: a non-atomic read-modify-write built from Load + Store. Even though
// each Load and each Store is individually atomic, the gap between them lets two
// goroutines read the same value and both store the same +1 result, losing
// updates. `go run -race main.go` does not flag this (each access IS atomic),
// which is what makes it insidious — the final count is just silently too low.
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

func main() {
	var counter atomic.Int64
	var wg sync.WaitGroup

	for i := 0; i < 100000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// WRONG: Load and Store are separate steps with a race window
			// between them. Use the fused Add instead.
			counter.Store(counter.Load() + 1)
		}()
	}

	wg.Wait()
	fmt.Println("final count:", counter.Load()) // not reliably 100000
}
```

---

## Correct Code

```go
// correct: atomic.Add fuses read-modify-write into one indivisible step, and a
// CAS-retry loop shows the lock-free "set max" pattern. Runs cleanly under
// `go run -race main.go` and always prints deterministic results.
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

func main() {
	const goroutines = 100000

	var counter atomic.Int64 // zero value: a ready-to-use atomic int, value 0
	var maxSeen atomic.Int64
	var wg sync.WaitGroup

	for i := 1; i <= goroutines; i++ {
		wg.Add(1)
		go func(n int64) {
			defer wg.Done()

			// Indivisible increment: no update can be lost.
			counter.Add(1)

			// Lock-free "record the maximum value seen" via a CAS loop.
			for {
				old := maxSeen.Load()
				if n <= old {
					break // someone already recorded a larger value
				}
				if maxSeen.CompareAndSwap(old, n) {
					break // we won the race; our value is in
				}
				// CAS failed: another goroutine changed maxSeen. Retry.
			}
		}(int64(i))
	}

	wg.Wait()

	fmt.Printf("final count: %d (expected %d)\n", counter.Load(), goroutines)
	fmt.Printf("max seen:    %d (expected %d)\n", maxSeen.Load(), goroutines)
}
```

---

## Explanation

The broken version looks atomic but is not. `counter.Store(counter.Load() + 1)` is three distinct steps — an atomic `Load`, an addition, and an atomic `Store` — with an unsynchronized gap in the middle. Two goroutines can both `Load` the value `5`, both compute `6`, and both `Store` `6`, losing one increment. The truly insidious part is that the race detector stays silent: *each individual* `Load` and `Store` is a legitimate atomic operation, so there is no low-level data race for it to flag. The only symptom is that the final count is quietly less than 100,000 — a correctness bug that no tool catches for you.

The correct version uses `counter.Add(1)`, which fuses the read, the increment, and the write into a single indivisible hardware operation. No goroutine can observe or interfere with an intermediate state, so every increment counts and the final value is exactly 100,000, every run. The second part demonstrates the canonical lock-free pattern with `CompareAndSwap`: to record the maximum value any goroutine has seen, each goroutine loads the current max, checks whether its value is larger, and tries to CAS its value in. If another goroutine changed `maxSeen` in between, the CAS returns `false` and the loop retries with the fresh value. This is how you build correct lock-free updates — you must handle CAS failure by retrying, never assume it succeeded.

Both counters use the `atomic.Int64` typed wrapper. Its zero value is a ready-to-use atomic with value 0, and because the underlying integer is unexported, there is no way to accidentally read or write it non-atomically — the type itself enforces the discipline.

---

## Design Tradeoff

Atomics trade generality for speed. An atomic `Add` is a single CPU instruction with no lock to acquire, so under heavy contention on one counter it can be several times faster than a mutex-guarded `count++`. The cost of that speed is a tiny scope: atomics work on exactly one word-sized value, and they make each operation indivisible but a *sequence* of operations is not. The moment your invariant spans two fields, atomics cannot express it and you are back to a mutex.

There is also a cognitive tradeoff. CAS-retry loops are genuinely subtle — easy to get wrong, easy to write a version that compiles and races silently (as the broken example shows, even the race detector may not save you). Go therefore steers you toward the mutex as the default: boring, obvious, and correct. Atomics are the specialist's tool — pull them out when a profiler points at a single hot counter, or when you are deliberately implementing a known lock-free algorithm, and reach for the typed wrappers and `go test -race` to keep yourself honest.

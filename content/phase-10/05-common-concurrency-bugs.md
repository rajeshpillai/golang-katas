---
id: common-concurrency-bugs
phase: 10
phase_title: Synchronization & Coordination
sequence: 5
title: Common Concurrency Bugs
---

## Description

### Concept Overview

You now have the synchronization toolkit: `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, and `sync/atomic`. Having the tools is not the same as using them correctly. Concurrency bugs are uniquely punishing because they are **non-deterministic** — they depend on scheduler timing, CPU count, and load, so they hide during development and surface in production. A program can be wrong and still pass a thousand test runs.

This kata is a tour of the bugs that bite real Go programs, the *why* behind each, and the discipline that prevents them. The recurring lesson: do not reason about whether a racy program "usually works." A data race is undefined behavior, and a deadlock is a permanent hang. Correctness here comes from a few firm rules plus relentless use of the race detector.

### Technical Explanation

**Bug 1 — The data race.** Two goroutines access the same memory, at least one writes, and there is no happens-before relationship between them. The result is undefined: lost updates, torn reads, corrupted structures. The fix is always to introduce synchronization — a mutex around every access, or an atomic, or channel ownership. Verify with `go run -race` / `go test -race`.

**Bug 2 — The loop-variable capture (pre-Go 1.22).** A classic source of races and wrong results:

```go
for _, v := range items {
    go func() {
        use(v) // in Go < 1.22, all goroutines share ONE v
    }()
}
```

Before Go 1.22, the loop variable `v` was reused across iterations, so every goroutine read whatever `v` held when it eventually ran — usually the last element, and concurrently with the loop updating it (a race). Go 1.22 changed loop semantics so each iteration gets a fresh `v`. But the portable, intention-revealing fix is to pass the value as an argument: `go func(v Item){ use(v) }(v)`. Be aware which Go version your code targets.

**Bug 3 — The deadlock.** A deadlock is a permanent block where goroutines wait on each other in a cycle. The classic shape is lock-ordering inversion: goroutine A locks `mu1` then waits for `mu2`, while goroutine B locks `mu2` then waits for `mu1`. Neither can proceed. The fix is a **global lock ordering** — every goroutine acquires locks in the same fixed order. Self-deadlock also happens with non-reentrant mutexes: a locked method calling another method that locks the same mutex. Go's runtime detects the special case where *all* goroutines are blocked and panics with "fatal error: all goroutines are asleep - deadlock!", but partial deadlocks (some goroutines stuck, others running) are not detected.

**Bug 4 — The goroutine leak.** A goroutine that blocks forever — on a channel that is never sent to, or a `WaitGroup` whose counter never reaches zero — never returns. It is not garbage collected because it is technically still "running." Leaked goroutines accumulate, holding memory and resources, until the process degrades or dies. Common cause: a goroutine sends on an unbuffered channel that no one will ever receive from (often because the receiver returned early). The fix is to ensure every goroutine has a guaranteed exit path — a `context` for cancellation, a buffered channel sized for all sends, or a `select` with a done channel.

**Bug 5 — The copied lock.** Passing a struct that embeds a `sync.Mutex` (or `RWMutex`, `WaitGroup`, atomic) by value copies the lock's internal state. Each copy coordinates independently, so the protection silently vanishes. `go vet` reports "passes lock by value." Always use pointer receivers and pass pointers.

**Bug 6 — WaitGroup misuse.** `Add` inside the goroutine (so `Wait` returns early), a forgotten `Done` (so `Wait` hangs), or a double `Done` (so the counter goes negative and the runtime panics). Covered in depth in the WaitGroup kata; it reappears constantly in real code.

**The tooling that finds these.** `go vet` catches copied locks and some misuse statically. The race detector — `go run -race`, `go test -race`, `go build -race` — instruments memory accesses and reports races at runtime with both stacks. Run your tests with `-race` in CI. It will not find deadlocks or leaks, but for races it is close to definitive: if `-race` is clean across representative runs, your races are almost certainly gone.

### Design Rationale

Go made concurrency cheap and easy — `go f()` spawns a goroutine in one keyword — which is exactly why these bugs are so common. Easy concurrency means programmers reach for it readily, and the hard part (correct synchronization) does not get easier just because spawning got easier. Go's response was not to hide concurrency behind a framework but to ship first-class *tools to catch the bugs*: a built-in race detector, `go vet` lock checks, and a runtime deadlock detector for the total-block case. The philosophy is "make concurrency accessible, then give you sharp tools to verify correctness," rather than "prevent all mistakes at compile time" (which would require a far more restrictive language).

This is also why Go offers both the share-memory style (mutexes, atomics) and the CSP style (channels). Many of these bugs — leaks, deadlocks on lock ordering — are reduced (though not eliminated) when you transfer ownership via channels instead of sharing state. But channels have their own failure modes (sending on a channel with no receiver is the leading cause of goroutine leaks). Go gives you both and expects you to choose the model that makes a given problem clearest, then verify with the tools.

### Common Mistakes

**Reasoning about racy programs as if they were correct "most of the time."** A data race is undefined behavior; "it passed my tests" proves nothing. Treat any unsynchronized shared access as a bug regardless of observed output.

**Inconsistent lock ordering.** Acquiring two locks in different orders in different goroutines is a latent deadlock that strikes under the right timing. Define and document one global order for all locks.

**Launching goroutines with no exit guarantee.** A goroutine blocked on a channel no one will service leaks forever. Every spawned goroutine needs a guaranteed way to finish — a `context`, a done channel, or a correctly sized buffer.

**Trusting that the deadlock detector will save you.** Go only detects the case where *every* goroutine is asleep. A partial deadlock, where a few goroutines hang while others run, produces a silent stall, not a panic.

**Skipping `-race` in CI.** The race detector is the single most effective tool for this class of bug, and it costs almost nothing to enable in tests. Not running it means shipping races you could have caught.

### Key Takeaways

- Concurrency bugs are non-deterministic — passing tests does not prove correctness; only synchronization plus the race detector does.
- Fix data races with a mutex on every access, an atomic, or channel ownership — never by hoping the timing works out.
- Prevent deadlocks with a single global lock ordering, and remember Go only detects the all-goroutines-asleep case.
- Every goroutine must have a guaranteed exit path or it leaks; an unreceived channel send is the most common cause.
- Never copy a lock or `WaitGroup`; use pointer receivers, and let `go vet` flag the slips.
- Run `go vet` and `go test -race` in CI — they catch copied locks and races, which is the bulk of real-world concurrency bugs.

---

## Broken Code

```go
// broken: a showcase of concurrency bugs.
// 1) lock-ordering deadlock: transfer(a,b) and transfer(b,a) acquire locks in
//    opposite orders, so concurrent calls can each hold one lock and wait for
//    the other forever.
// 2) data race: `total` is read and written with no synchronization.
// Run with `go run -race main.go` and you may see both a race report and a
// "fatal error: all goroutines are asleep - deadlock!" panic.
package main

import (
	"fmt"
	"sync"
)

type Account struct {
	mu      sync.Mutex
	balance int
}

func transfer(from, to *Account, amount int) {
	from.mu.Lock()        // BUG: locks acquired in caller-dependent order
	to.mu.Lock()          //      transfer(a,b) and transfer(b,a) invert it
	from.balance -= amount
	to.balance += amount
	to.mu.Unlock()
	from.mu.Unlock()
}

func main() {
	a := &Account{balance: 100}
	b := &Account{balance: 100}

	total := 0
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			transfer(a, b, 1)
			transfer(b, a, 1)
			total++ // BUG: data race on `total`
		}()
	}
	wg.Wait()
	fmt.Println("total ops:", total, "a:", a.balance, "b:", b.balance)
}
```

---

## Correct Code

```go
// correct: deadlock fixed with a global lock ordering (always lock the
// lower-id account first), and the shared counter made safe with an atomic.
// Runs cleanly under `go run -race main.go` and prints deterministic results.
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type Account struct {
	id      int
	mu      sync.Mutex
	balance int
}

// transfer enforces a GLOBAL lock ordering: whichever account has the smaller
// id is always locked first. Because every goroutine follows the same order,
// no cyclic wait can form, so no deadlock is possible.
func transfer(from, to *Account, amount int) {
	first, second := from, to
	if first.id > second.id {
		first, second = second, first
	}
	first.mu.Lock()
	defer first.mu.Unlock()
	second.mu.Lock()
	defer second.mu.Unlock()

	from.balance -= amount
	to.balance += amount
}

func main() {
	a := &Account{id: 1, balance: 100}
	b := &Account{id: 2, balance: 100}

	var ops atomic.Int64 // shared counter: atomic, so no data race
	var wg sync.WaitGroup

	const goroutines = 1000
	for i := 0; i < goroutines; i++ {
		wg.Add(1) // Add before launching
		go func() {
			defer wg.Done() // always decrement
			transfer(a, b, 1)
			transfer(b, a, 1)
			ops.Add(1) // indivisible increment
		}()
	}
	wg.Wait()

	// Each goroutine moves 1 to b and back, so balances return to 100 each.
	fmt.Printf("ops: %d (expected %d)\n", ops.Load(), goroutines)
	fmt.Printf("a.balance: %d, b.balance: %d (expected 100, 100)\n",
		a.balance, b.balance)
}
```

---

## Explanation

The broken version packs two textbook bugs into one short program. The first is a lock-ordering deadlock. `transfer(a, b, 1)` locks `a` then `b`; `transfer(b, a, 1)` locks `b` then `a`. Run concurrently, one goroutine can grab `a` and wait for `b` while another grabs `b` and waits for `a` — a cyclic wait that never resolves. When every goroutine ends up stuck this way, Go's runtime notices that no goroutine can make progress and aborts with "fatal error: all goroutines are asleep - deadlock!". The second bug is a plain data race: `total++` runs in a thousand goroutines with no synchronization, so increments are lost and `-race` flags the conflicting accesses.

The correct version fixes the deadlock with a **global lock ordering**. Each account carries an `id`, and `transfer` always locks the lower-id account first, regardless of the argument order. Because every goroutine acquires locks in the same total order, no cycle of "A waits for B waits for A" can ever form — the deadlock is structurally impossible, not merely unlikely. The `defer`-ed unlocks guarantee both locks are released on every path. The shared counter becomes an `atomic.Int64`, so `ops.Add(1)` is an indivisible increment with no lost updates. The program runs cleanly under `-race` and prints deterministic results: 1000 operations, and both balances back at 100 (each goroutine moves a unit to `b` and immediately back).

The broader point is method, not just these two fixes. Define one lock order and never deviate. Synchronize every shared access. Give every goroutine an exit path. Then run `go vet` and `go test -race` to verify — because in concurrent code, "it ran fine" is evidence of nothing.

---

## Design Tradeoff

Every fix here trades raw throughput or convenience for correctness. The global lock ordering means `transfer` sometimes locks accounts in an order that differs from the natural argument order, which is slightly less obvious to read — but that small awkwardness buys a guarantee that no deadlock can ever occur, which is worth far more than the lost clarity. Likewise, the atomic counter and the locking serialize work that would otherwise run fully parallel; you give up some concurrency to get a correct answer. In concurrent programming this is the standing tradeoff: unsynchronized code is faster and wronger, and the engineering skill is adding exactly enough coordination to be correct without strangling parallelism.

The deeper tradeoff is the one Go itself made. By making goroutines trivially cheap to launch, Go invited this entire class of bugs — and then chose to address them with runtime tooling (the race detector, `go vet`, the deadlock detector) rather than a restrictive type system that would prevent them at compile time. That keeps the language small and the concurrency model approachable, at the cost of putting the discipline on you: lock ordering, exit guarantees, and `-race` in CI are conventions you must uphold, not rules the compiler enforces. Go bets that sharp tools plus a few firm habits beat a heavyweight framework — and for most teams, with the race detector wired into CI, that bet pays off.

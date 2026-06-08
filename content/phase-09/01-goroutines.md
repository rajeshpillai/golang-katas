---
id: goroutines
phase: 9
phase_title: Concurrency Fundamentals
sequence: 1
title: Goroutines
---

## Description

### Concept Overview

A goroutine is a function executing concurrently with other goroutines in the same address space. You start one by writing the keyword `go` before a function call. That is the entire syntax. The function call returns immediately, and its body runs independently while the rest of your program continues.

The word "concurrently" is precise here. Concurrency is about *structure* — dealing with many things at once. It is not the same as parallelism, which is about *execution* — doing many things at once. Goroutines give you concurrency cheaply, and the Go runtime decides whether to run them in parallel based on how many CPU cores are available. You write concurrent code; Go decides how much of it runs in parallel.

Goroutines are not operating-system threads. They are lightweight, runtime-managed units of execution that the Go scheduler multiplexes onto a small pool of OS threads. A goroutine starts with a tiny stack (a few kilobytes) that grows and shrinks as needed. This is why Go programs routinely run hundreds of thousands of goroutines, while a program spawning that many OS threads would exhaust the machine.

### Technical Explanation

**The `go` keyword** schedules a function to run concurrently. The call `go doWork()` creates a new goroutine that will execute `doWork`, then immediately returns control to the calling goroutine. There is no return value — `go` discards whatever the function returns. If you need a result, you must communicate it back through a channel or shared memory.

```go
go doWork()           // run doWork concurrently
go func() {           // or an anonymous function
    fmt.Println("hi")
}()
```

**The GMP scheduler.** Go's runtime scheduler is built on three entities, conventionally abbreviated G, M, and P:

- **G (goroutine)** — the unit of work: a function, its stack, and its scheduling state.
- **M (machine)** — an OS thread. The kernel schedules Ms onto CPU cores.
- **P (processor)** — a logical scheduling context that holds a run queue of runnable goroutines. The number of Ps is controlled by `GOMAXPROCS`, which defaults to the number of CPU cores.

An M must hold a P to run Go code. The scheduler takes runnable Gs from a P's local run queue and runs them on the M attached to that P. When a goroutine blocks on a channel, a mutex, or a syscall, the scheduler can park it and run another goroutine on the same thread — no kernel context switch required. This is **cooperative multiplexing in user space**, and it is why goroutine switches are far cheaper than thread switches. When a goroutine makes a blocking syscall, the runtime can detach the M from its P and hand the P to another M so other goroutines keep running.

**Stack growth.** Each goroutine begins with a small contiguous stack (currently 8 KB). When a function call would overflow the stack, the runtime allocates a larger stack, copies the frames over, and adjusts pointers. The stack also shrinks when it is mostly unused. This dynamic sizing is what makes goroutines cheap: you do not pre-commit a large fixed stack per goroutine the way you do with OS threads (often 1–8 MB each).

**Lifecycle and the main goroutine.** `func main()` itself runs in a goroutine — the main goroutine. Here is the rule that catches everyone: **when the main goroutine returns, the program exits immediately**, even if other goroutines are still running. The runtime does not wait for them. There is no implicit join. If you start a goroutine and `main` finishes before that goroutine does, its work is simply lost. To wait, you must coordinate explicitly, most commonly with a `sync.WaitGroup`.

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    doWork()
}()
wg.Wait() // blocks until the counter returns to zero
```

### Design Rationale

Go's concurrency model descends directly from Tony Hoare's **Communicating Sequential Processes (CSP)**. The guiding slogan, coined by Rob Pike, is: **"Don't communicate by sharing memory; share memory by communicating."** Goroutines are the "processes" in CSP — independent sequential computations — and channels (covered next) are the communication between them.

Compare this with the mainstream alternative. In **Java** or **C++**, concurrency means OS threads plus shared mutable state guarded by locks. Threads are expensive: each carries a large stack and a kernel-managed identity, so you pool them carefully and treat creating one as a heavyweight act. Coordination is done with mutexes, condition variables, and memory barriers — primitives that are easy to misuse and hard to reason about. A missed lock is a data race; a lock taken in the wrong order is a deadlock.

Go inverts the defaults. Goroutines are so cheap that you create them freely — one per request, one per connection, one per pipeline stage. The runtime, not the kernel, schedules them. And the *preferred* coordination mechanism is not the lock but the channel: instead of multiple goroutines reaching into shared memory, one goroutine *owns* a piece of data and others ask it for results by sending and receiving messages. This does not abolish locks (Go has `sync.Mutex`), but it makes message passing the path of least resistance, which tends to produce designs that are easier to reason about.

The deeper rationale is that **concurrency is a structuring tool, not a performance trick**. Pike's point is that breaking a problem into independent communicating pieces often makes the program clearer, regardless of how many cores you have. Parallel speedup is a bonus the runtime provides when cores are available.

### Common Mistakes

**Assuming `go` waits.** The most common beginner error is starting a goroutine and expecting the program to wait for it. It will not. `main` returns, the process exits, and the goroutine's output never appears. Why: the runtime gives no guarantees about how far an unfinished goroutine progresses before the program tears down. You must coordinate with `sync.WaitGroup` or a channel.

**Relying on output order.** Two goroutines printing to stdout produce interleaved, nondeterministic output. The scheduler may run them in any order, and that order can change between runs. Code that depends on a particular interleaving is broken. Why: the scheduler is free to choose, and `GOMAXPROCS` plus core count make timing unpredictable.

**Capturing a loop variable by reference (pre-Go 1.22).** Writing `for _, v := range items { go func() { use(v) }() }` in older Go captured a single shared `v`, so every goroutine saw the final value. The fix was to pass `v` as an argument or shadow it inside the loop. Go 1.22 changed loop semantics so each iteration has its own variable, but you should still understand the capture-by-reference pitfall — it appears with any captured variable, not just loop variables.

**Leaking goroutines.** A goroutine blocked forever on a channel that will never receive, or stuck in an infinite loop with no exit, never gets collected. Goroutines are not garbage-collected while they are blocked or running — only when they return. Leaked goroutines accumulate, holding memory and other resources. Why: the runtime cannot know the goroutine is "done" if its function never returns.

**Sharing a variable without synchronization.** Two goroutines writing the same variable without a mutex or channel is a data race — undefined behavior, not merely a wrong number. Why: without synchronization there is no *happens-before* relationship, so the compiler and CPU may reorder or cache writes. Run with `go run -race` to detect these.

### Key Takeaways

- A goroutine is a concurrently executing function; start one with the `go` keyword, and the call returns immediately.
- Goroutines are lightweight runtime-managed units, not OS threads — they start with tiny growable stacks and are multiplexed onto threads by the GMP scheduler.
- When `main` returns, the program exits without waiting for other goroutines; you must coordinate explicitly with `sync.WaitGroup` or channels.
- Concurrency (structure) is not parallelism (simultaneous execution); you write concurrent code and the runtime decides how much runs in parallel via `GOMAXPROCS`.
- Goroutine scheduling and output order are nondeterministic — never depend on a particular interleaving.
- Sharing mutable state across goroutines without synchronization is a data race; prefer communicating over channels, and detect races with `-race`.

---

## Broken Code

```go
// broken: main returns before the goroutines run, so their output is lost
package main

import "fmt"

func main() {
	for i := 0; i < 3; i++ {
		// Each call returns immediately; nothing waits for these goroutines.
		go func(n int) {
			fmt.Println("worker", n, "did some work")
		}(i)
	}

	// main returns here. The program exits at once.
	// The goroutines almost never get a chance to run, so the
	// program usually prints nothing at all.
	fmt.Println("main is done")
}
```

---

## Correct Code

```go
// correct: wait for every goroutine with a WaitGroup before main returns
package main

import (
	"fmt"
	"sync"
)

func main() {
	var wg sync.WaitGroup

	const workers = 3
	for i := 0; i < workers; i++ {
		wg.Add(1) // register one goroutine before starting it

		// Pass i as an argument so each goroutine gets its own copy,
		// independent of the loop's progress.
		go func(n int) {
			defer wg.Done() // signal completion even if the body panics
			fmt.Printf("worker %d did some work\n", n)
		}(i)
	}

	// Block here until the WaitGroup counter returns to zero,
	// i.e. until all three goroutines have called Done.
	wg.Wait()

	fmt.Println("all workers finished; main is done")
}
```

---

## Explanation

The broken version starts three goroutines in a loop and then immediately falls off the end of `main`. Because `go` returns instantly and the main goroutine does nothing to wait, `main` reaches its end and the runtime tears the process down. The three workers are scheduled but the program exits before the scheduler runs them, so in practice you see only `main is done` — or, on an unlucky run, partial garbled output. The bug is not that the goroutines are wrong; it is that nothing coordinates their completion with `main`.

The correct version fixes this with a `sync.WaitGroup`, which is a counter for outstanding work. We call `wg.Add(1)` *before* launching each goroutine (adding inside the goroutine would race against `Wait`). Each goroutine calls `wg.Done()` via `defer`, so the count is decremented even on an early return or panic. Finally, `wg.Wait()` blocks the main goroutine until the counter reaches zero — a clean, explicit join point. We also pass `i` as the argument `n` so each goroutine captures its own value rather than sharing the loop variable.

The result is deterministic *termination* even though the *order* of the three lines is still nondeterministic. That is the correct mental model: synchronization controls when work is guaranteed to be done, not the order in which independent goroutines interleave.

---

## Design Tradeoff

Go deliberately makes goroutines trivially cheap to create but refuses to wait for them automatically. This is a tradeoff in favor of explicitness. The language could have made `main` block until all goroutines finish, but that would hide a critical question — *which* goroutines are you actually waiting on? — and would make it impossible to express fire-and-forget background work or graceful shutdown. By forcing you to write the coordination yourself, Go keeps the lifecycle of every goroutine visible in the code.

The cost is that beginners must learn the discipline immediately: a goroutine you start is your responsibility to coordinate and, eventually, to ensure terminates. The benefit is that there are no hidden join points and no surprise blocking. In larger systems this pays off — `WaitGroup`, channel close, and `context.Context` give you precise, composable control over goroutine lifetimes, which is far more powerful than an implicit "wait for everything" that you cannot opt out of.

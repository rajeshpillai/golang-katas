---
id: worker-pools
phase: 15
phase_title: Advanced Concurrency Patterns
sequence: 1
title: Worker Pools
---

## Description

### Concept Overview

A **worker pool** is a concurrency pattern in which a fixed number of goroutines (the "workers") pull units of work from a shared queue, process them, and push results to another queue. Instead of spawning one goroutine per task — which is tempting in Go because goroutines are cheap — you spawn a bounded set of workers and feed them through channels. The pool size becomes a deliberate knob for controlling how much work runs concurrently.

This is one of the most important patterns in production Go. It answers a question that naive concurrency ignores: *how many things should run at once?* If you launch a goroutine for every incoming request, every file, or every URL, you can exhaust memory, saturate a database connection pool, or trigger rate limits on a downstream API. A worker pool gives you back control. You decide the degree of parallelism, and the channels do the rest — distributing jobs and collecting results without you ever touching a lock.

The mental model is a small factory: a `jobs` channel is the conveyor belt feeding raw material in, a fixed crew of workers each take the next available item, and a `results` channel is the belt carrying finished goods out.

### Technical Explanation

A worker pool is built from three pieces: a **jobs channel**, a **fixed number of worker goroutines**, and a **results channel**.

**The jobs channel** carries the work to be done. The producer sends jobs into it and then closes it when there are no more jobs. Closing is essential — it is the signal that tells workers to stop ranging over the channel.

```go
jobs := make(chan int, len(inputs))
for _, j := range inputs {
    jobs <- j
}
close(jobs) // tells every worker: no more work is coming
```

**The workers** each run the same loop: `for j := range jobs`. The `range` over a channel receives values until the channel is both closed *and* drained. Because all workers range over the *same* channel, the Go runtime hands each queued job to whichever worker is currently free. This is automatic load balancing — there is no scheduler code you write, no mutex protecting a shared index. The channel *is* the synchronization.

```go
func worker(id int, jobs <-chan int, results chan<- int, wg *sync.WaitGroup) {
    defer wg.Done()
    for j := range jobs {
        results <- j * j // do the work, emit a result
    }
}
```

Note the **directional channel types**: `<-chan int` is receive-only and `chan<- int` is send-only. A worker should only receive jobs and only send results; encoding that in the type makes the compiler enforce the data-flow direction and documents intent.

**Coordinating shutdown** requires a `sync.WaitGroup`. Each worker calls `wg.Done()` when its `range` loop exits (which happens once `jobs` is closed and drained). A separate goroutine waits for all workers and then closes `results`:

```go
var wg sync.WaitGroup
for i := 0; i < numWorkers; i++ {
    wg.Add(1)
    go worker(i, jobs, results, &wg)
}
go func() {
    wg.Wait()      // all workers finished
    close(results) // safe to close now — no worker will send again
}()
```

Closing `results` from a *single* goroutine after `wg.Wait()` is the only safe place to close it. If any worker closed `results`, another worker might still try to send to it and panic ("send on closed channel"). The consumer then ranges over `results` until it is closed and drained:

```go
for r := range results {
    total += r
}
```

This is the canonical shape. The number of workers is fixed and small; jobs flow in, get distributed by the channel, and results flow out. Nothing busy-waits, nothing leaks, and the whole pipeline drains and terminates deterministically.

### Design Rationale

In Java, the equivalent is a `ThreadPoolExecutor`: you submit `Runnable` or `Callable` tasks to a queue, and a managed pool of OS threads executes them. It works, but it hides a lot. The queue, the threads, and the rejection policy are all objects with configuration you must understand. Concurrency in that model is achieved by *sharing* a queue object protected by internal locks.

Go inverts this. Goroutines are not OS threads — they are lightweight, runtime-scheduled coroutines multiplexed onto a small number of OS threads. Channels are the queue, but they are also the synchronization primitive. There is no separate "executor" object to configure; you assemble the pattern out of two language primitives — goroutines and channels. This embodies Go's mantra:

> Do not communicate by sharing memory; share memory by communicating.

A worker pool shares the *jobs* by communicating them over a channel rather than by having workers grab a mutex-protected shared list. The result is code where the data flow is visible: you can read the channel sends and receives and trace exactly how work moves through the system. Go chose this because explicit, traceable data flow is far easier to reason about than implicit shared state guarded by locks.

### Common Mistakes

**Spawning one goroutine per job instead of using a fixed pool.** Goroutines are cheap, so beginners write `for _, j := range jobs { go process(j) }`. With a few jobs this is fine; with a hundred thousand it spawns a hundred thousand goroutines that all hit the database or remote API at once. The whole point of a pool is to *bound* concurrency. Without that bound you lose the control the pattern exists to provide.

**Forgetting to close the jobs channel.** If you never `close(jobs)`, every worker's `for range jobs` loop blocks forever waiting for more work that never arrives. The workers never call `wg.Done()`, `wg.Wait()` never returns, and the program deadlocks (or leaks goroutines if `main` exits early). The close is the termination signal — omitting it is the single most common worker-pool bug.

**Closing the results channel from a worker.** If each worker closes `results` when its loop ends, the *first* worker to finish closes the channel while others are still sending, causing a panic. The results channel must be closed exactly once, from outside the workers, after `wg.Wait()`.

**Closing the jobs channel before all sends complete.** If you close `jobs` in a goroutine that is still sending, you will panic with "send on closed channel". Close only after the final send.

**Deadlocking on an unbuffered results channel with no consumer running yet.** If workers send to `results` but the consumer loop has not started (for example, you collect results *after* `wg.Wait()` on the main goroutine while also waiting inline), workers block on the send, never finish, and `wg.Wait()` hangs. Run the closer goroutine concurrently and range over results on the main goroutine, or buffer results to decouple the timing.

### Key Takeaways

- A worker pool uses a **fixed** number of goroutines reading from a shared jobs channel — concurrency is bounded by design, not left to chance.
- The jobs channel distributes work automatically; ranging multiple workers over one channel is built-in load balancing with no locks.
- Use directional channel types (`<-chan`, `chan<-`) so the compiler enforces the data-flow direction.
- Close the **jobs** channel after the last send to signal workers to stop; close the **results** channel exactly once, after `wg.Wait()`.
- A `sync.WaitGroup` coordinates "all workers done" so results can be closed safely and the pipeline terminates deterministically.
- Choose pool size deliberately to match a real constraint — CPU cores, connection-pool size, or a downstream rate limit.

---

## Broken Code

```go
// broken: spawns one goroutine per job (unbounded concurrency) and never
// closes the results channel, so the consumer ranges forever and deadlocks.
package main

import "fmt"

func main() {
    inputs := []int{1, 2, 3, 4, 5}
    results := make(chan int)

    // Bug 1: one goroutine per job — concurrency is unbounded. With many
    // inputs this would overwhelm any downstream resource.
    for _, j := range inputs {
        go func(n int) {
            results <- n * n
        }(j)
    }

    // Bug 2: nobody ever closes `results`. This range has no termination
    // signal, so after receiving 5 values it blocks forever -> deadlock.
    total := 0
    for r := range results {
        total += r
    }

    fmt.Println("total:", total)
}
```

---

## Correct Code

```go
// correct: a fixed-size worker pool with proper channel closing and no leaks.
package main

import (
	"fmt"
	"sync"
)

// worker pulls jobs from `jobs`, squares them, and sends results out.
// Directional channel types document and enforce the data flow.
func worker(id int, jobs <-chan int, results chan<- int, wg *sync.WaitGroup) {
	defer wg.Done()
	for j := range jobs { // exits when `jobs` is closed and drained
		results <- j * j
	}
}

func main() {
	const numWorkers = 3
	inputs := []int{1, 2, 3, 4, 5, 6, 7, 8}

	// Buffer jobs so the producer never blocks; buffer results so workers
	// never block waiting for the consumer to catch up.
	jobs := make(chan int, len(inputs))
	results := make(chan int, len(inputs))

	// Start a FIXED number of workers. This is the bound on concurrency.
	var wg sync.WaitGroup
	for i := 1; i <= numWorkers; i++ {
		wg.Add(1)
		go worker(i, jobs, results, &wg)
	}

	// Producer: send all jobs, then close to signal "no more work".
	for _, j := range inputs {
		jobs <- j
	}
	close(jobs)

	// Close results exactly once, after every worker has finished.
	go func() {
		wg.Wait()
		close(results)
	}()

	// Consumer: range until results is closed and drained.
	total := 0
	count := 0
	for r := range results {
		total += r
		count++
	}

	fmt.Printf("processed %d jobs with %d workers\n", count, numWorkers)
	fmt.Println("sum of squares:", total)
}
```

---

## Explanation

The broken version makes two mistakes that together produce a deadlock. First, it launches one goroutine per input. With five inputs this looks harmless, but the pattern does not scale — replace `inputs` with a million-element slice and you have a million goroutines all racing to send on `results`, with nothing controlling how many run at once. The purpose of a worker pool is precisely to bound that number, and the broken code throws the bound away.

Second, and fatally, nothing ever closes `results`. The consumer's `for r := range results` loop only terminates when the channel is closed and drained. Since no one closes it, the loop receives the five squared values and then blocks forever waiting for a sixth that never comes. The Go runtime detects that all goroutines are asleep and panics with "fatal error: all goroutines are asleep - deadlock!".

The correct version fixes both issues. It starts a fixed three workers regardless of how many jobs exist — that is the concurrency bound. The producer sends every job and then closes `jobs`, which is the signal each worker's `range` loop needs to exit. A dedicated goroutine calls `wg.Wait()` to block until all three workers have returned, and only then closes `results`. This guarantees the close happens exactly once and only after no worker can possibly send again. The consumer ranges over `results` and terminates cleanly when the channel drains. The program prints its aggregate and exits — deterministically, with no leaked goroutines.

---

## Design Tradeoff

The core tradeoff in a worker pool is **bounded throughput versus latency for any single job**. A larger pool processes more jobs in parallel and finishes a big batch sooner, but it also consumes more memory and pushes more concurrent load onto whatever the workers touch — a database, a disk, a remote API. A smaller pool is gentler on those resources but takes longer to clear a backlog and may leave CPU cores idle. There is no universally correct number; the right size is dictated by the *real* bottleneck. If workers are CPU-bound, `runtime.NumCPU()` is a sensible starting point. If they are I/O-bound and waiting on a database with a 20-connection pool, sizing the pool near 20 matches the actual constraint.

The second tradeoff is **buffering**. Buffered jobs and results channels decouple producer, workers, and consumer so that a brief stall in one stage does not immediately block the others, smoothing throughput. But buffers cost memory and can hide backpressure — if results pile up faster than the consumer drains them, a large buffer merely delays the moment you notice. Choosing buffer sizes is therefore a deliberate decision about how much slack you want in the pipeline, not a detail to set arbitrarily.

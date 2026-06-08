---
id: backpressure
phase: 15
phase_title: Advanced Concurrency Patterns
sequence: 3
title: Backpressure
---

## Description

### Concept Overview

**Backpressure** is the mechanism by which a slow consumer forces a fast producer to slow down. In any pipeline where one stage produces work faster than the next stage can process it, something has to give. Either the system buffers the excess (consuming unbounded memory until it crashes), drops the excess (losing data), or makes the producer *wait* until the consumer is ready. That last option — propagating "I am not ready yet" upstream — is backpressure, and it is the safe default.

Go has backpressure built into its most fundamental concurrency primitive: the channel. A send on a full (or unbuffered) channel **blocks** until a receiver is ready. That blocking *is* backpressure. The producer cannot outrun the consumer because the channel physically refuses to accept the next value until space opens up. You do not implement backpressure in Go so much as you avoid *defeating* it. The danger lies in patterns that remove the natural blocking — spawning a fresh goroutine per item, or using an unboundedly growing buffer — which let the producer run free and the system accumulate work without limit.

### Technical Explanation

The key to backpressure in Go is the **bounded channel** and the blocking semantics of sends.

**An unbuffered channel** (`make(chan T)`) provides the tightest backpressure: a send blocks until a receiver takes the value. Producer and consumer move in lockstep. The producer can be at most one item "ahead."

**A bounded buffered channel** (`make(chan T, N)`) provides looser, smoother backpressure: the producer may run up to `N` items ahead before a send blocks. The buffer absorbs short bursts so producer and consumer do not have to rendezvous on every single item, but the bound guarantees the in-flight work never exceeds `N`. This is the sweet spot for most pipelines — enough slack to smooth jitter, a hard ceiling on memory.

```go
// Bounded buffer of 4: producer may get at most 4 items ahead, then blocks.
ch := make(chan int, 4)

go func() {
    defer close(ch)
    for i := 0; i < 100; i++ {
        ch <- i // BLOCKS here once the buffer holds 4 unconsumed items
    }
}()

for v := range ch {
    process(v) // slow; while we are busy, the producer is parked
}
```

When `process` is slow, the buffer fills to 4, and the producer's next `ch <- i` blocks. The producer is now *paused by the consumer* — backpressure in action. Memory is bounded by the buffer size no matter how many items the producer would like to push.

**What destroys backpressure** is decoupling the producer from the consumer's pace. The classic anti-pattern is launching a goroutine per item so the producer never blocks:

```go
for i := 0; i < 1_000_000; i++ {
    go process(i) // producer never waits; a million goroutines pile up
}
```

Here the "send" never blocks because there is no shared bounded channel — every item gets its own goroutine. The producer races to completion instantly, and a million goroutines (each holding a stack, plus whatever resources `process` grabs) accumulate. Memory and scheduler pressure climb until the program is killed. The fix is to feed items through a bounded channel into a fixed worker pool, restoring the block.

You can also use a **semaphore channel** — a buffered channel of empty structs used as tokens — to bound concurrency while still spawning per-item goroutines:

```go
sem := make(chan struct{}, 4) // at most 4 concurrent
for _, item := range items {
    sem <- struct{}{}          // acquire: blocks when 4 are in flight
    go func(it Item) {
        defer func() { <-sem }() // release
        process(it)
    }(item)
}
```

The `sem <- struct{}{}` send blocks once four tokens are out, applying backpressure to the loop. This is backpressure expressed as a concurrency limit rather than a queue depth.

### Design Rationale

Most languages bolt backpressure on as a library concern. Reactive frameworks (RxJava, Project Reactor) have entire specifications — the Reactive Streams `request(n)` protocol — devoted to letting a subscriber tell a publisher how much it can handle. It works, but it is an explicit, intricate protocol layered on top of callbacks. Java's plain `BlockingQueue` offers backpressure too, but you must remember to bound it; an unbounded `LinkedBlockingQueue` silently removes it.

Go makes blocking-on-a-full-channel the *default behavior of the language's core concurrency type*. There is no protocol to opt into. A bounded channel send blocks; that is the whole mechanism. This reflects Go's philosophy that concurrency primitives should make the safe thing natural:

> Don't communicate by sharing memory; share memory by communicating.

When you communicate over a bounded channel, the channel's capacity is your flow-control contract. The producer and consumer negotiate pace implicitly through the act of sending and receiving. Go chose blocking sends precisely so that the obvious, idiomatic pipeline already has backpressure — you have to go out of your way (unbounded goroutines, infinite buffers) to lose it.

### Common Mistakes

**Spawning a goroutine per item to "go faster".** This is the most damaging backpressure mistake. Each `go process(item)` removes the producer's reason to wait, so a fast producer instantiates work without bound. Under load the goroutine count and memory grow until the process is OOM-killed. The producer's speed must be coupled to the consumer's via a bounded channel or a semaphore.

**Using an unbounded buffer (or an ever-growing slice as a queue).** Setting a channel buffer to some huge number, or appending unconsumed items into a slice, just moves the cliff farther away. The producer still outruns the consumer; you have only changed *when* you run out of memory, not *whether*. Backpressure requires a real, modest bound that the producer will actually hit.

**Picking buffer sizes to avoid blocking entirely.** Beginners size the buffer so the producer "never has to wait", treating any blocking as a problem to eliminate. But the blocking *is* the feature. A buffer should be sized to smooth bursts, not to defeat flow control. If your goal is for the send to never block, you have removed backpressure.

**Busy-waiting instead of blocking.** Polling — `for { if len(ch) < cap(ch) { ... } }` or sleeping in a loop to check readiness — burns CPU and reacts late. A blocking channel send parks the goroutine for free and resumes it the instant space appears. Let the channel block; never poll for capacity.

**Forgetting that `select` with a `default` removes backpressure.** A non-blocking send (`select { case ch <- v: default: }`) silently drops or skips the value when the channel is full. That is *load shedding*, not backpressure. It is sometimes what you want, but using it accidentally means data quietly vanishes under load instead of the producer slowing down.

### Key Takeaways

- Backpressure = a slow consumer forcing a fast producer to wait; it keeps in-flight work and memory bounded.
- In Go it is built in: a send on a full or unbuffered channel **blocks**, and that blocking is the backpressure.
- A **bounded** buffered channel smooths bursts while capping in-flight items; pick the bound to match available memory and acceptable latency.
- Spawning a goroutine per item, or using an unbounded buffer, **defeats** backpressure — the producer runs free and memory grows without limit.
- A semaphore channel of tokens bounds concurrency when you still want per-item goroutines.
- `select` with `default` turns a blocking send into load-shedding (dropping data), which is the opposite of backpressure — use it deliberately, never by accident.

---

## Broken Code

```go
// broken: the producer spawns a goroutine per item, so it never blocks and
// never feels backpressure. With a fast producer and slow work, goroutines
// (and memory) pile up without bound until the process is killed.
package main

import (
    "fmt"
    "time"
)

func process(n int) {
    time.Sleep(50 * time.Millisecond) // slow consumer
    fmt.Println("done", n)
}

func main() {
    // Producer runs flat out. Each item gets its own goroutine, so the
    // loop never waits for the consumer — there is zero backpressure.
    for i := 0; i < 1_000_000; i++ {
        go process(i) // a million goroutines accumulate almost instantly
    }

    // main exits before most goroutines run; in a real long-lived service
    // this loop would exhaust memory long before finishing.
    time.Sleep(time.Second)
}
```

---

## Correct Code

```go
// correct: a bounded channel into a fixed worker pool. The producer blocks
// when the buffer is full, so a slow consumer paces a fast producer.
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	const (
		numWorkers = 3
		bufferSize = 4 // hard ceiling on in-flight, unconsumed items
		numItems   = 20
	)

	// Bounded channel = the backpressure mechanism. Once it holds
	// `bufferSize` unconsumed items, the producer's send blocks.
	jobs := make(chan int, bufferSize)
	results := make(chan int, bufferSize)

	// Fixed pool of slow workers.
	var wg sync.WaitGroup
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				time.Sleep(2 * time.Millisecond) // simulate slow work
				results <- j * 2
			}
		}()
	}

	// Producer: tries to push fast, but blocks on a full `jobs` channel.
	// That blocking is backpressure — it cannot outrun the workers.
	go func() {
		for i := 1; i <= numItems; i++ {
			jobs <- i // BLOCKS when buffer is full -> paced by consumers
		}
		close(jobs)
	}()

	// Close results once all workers are done.
	go func() {
		wg.Wait()
		close(results)
	}()

	// Consumer aggregates; the whole pipeline stays bounded in memory.
	total := 0
	count := 0
	for r := range results {
		total += r
		count++
	}

	fmt.Printf("processed %d items, buffer capped at %d\n", count, bufferSize)
	fmt.Println("sum:", total)
}
```

---

## Explanation

The broken version illustrates exactly how backpressure gets lost. The producer loop launches a goroutine for every one of a million items. Because each item gets its own goroutine, the `go process(i)` statement returns immediately — the loop never blocks, never waits, and never learns that the consumer (the `process` function with its 50ms sleep) is far slower than it is. The result is a million goroutines created almost instantly, each holding a stack and eventually contending for the scheduler. In a real service this grows memory without bound until the OS kills the process. There is no mechanism anywhere telling the producer to slow down.

The correct version reintroduces blocking, and with it, backpressure. Items flow through a `jobs` channel with a small bounded buffer (4) into a fixed pool of three workers. When the workers are busy with their `time.Sleep`, the buffer fills, and the producer's `jobs <- i` send *blocks*. The producer is now paced by the consumers: it can never get more than `bufferSize` items ahead of the work actually being done. In-flight work — and therefore memory — is capped no matter how eager the producer is or how many items exist.

Notice that the producer's blocking is not a bug to engineer around; it is the entire point. The bounded channel makes the producer and consumers negotiate their pace automatically. The program processes all twenty items, keeps at most four unconsumed at a time, drains cleanly, and terminates. The bound on the channel is the bound on the system.

---

## Design Tradeoff

Backpressure trades **producer throughput for system stability**. By forcing a fast producer to wait for a slow consumer, you give up the raw speed of letting the producer run unconstrained — but you gain a guarantee that the system never accumulates unbounded work. For any long-lived service this is almost always the right trade: a service that stays up at steady throughput beats one that sprints briefly and then OOM-crashes. The cost is that your producer is now only as fast as your slowest downstream stage, which means improving overall throughput requires speeding up or scaling out that stage, not just the producer.

The finer tradeoff is **buffer size**: latency and memory versus jitter smoothing. A tiny buffer (or unbuffered channel) gives the tightest memory bound and immediate backpressure but forces near-lockstep coupling, so any momentary stutter in the consumer instantly stalls the producer. A larger buffer absorbs bursts and keeps both sides busy through brief hiccups, at the cost of more memory and more items sitting in flight (which adds latency before a given item is processed). The right size is the smallest buffer that smooths your *actual* burstiness — large enough to hide jitter, small enough to keep the memory ceiling and feedback latency where you want them.

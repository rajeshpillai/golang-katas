---
id: fan-in-fan-out
phase: 15
phase_title: Advanced Concurrency Patterns
sequence: 2
title: Fan-In / Fan-Out
---

## Description

### Concept Overview

**Fan-out** and **fan-in** are two complementary halves of a concurrency pattern for building pipelines. *Fan-out* means starting multiple goroutines that all read from the *same* input channel, spreading one stream of work across several concurrent processors. *Fan-in* means taking the *several* output channels those processors produce and merging them back into a single channel, so a downstream stage sees one unified stream.

Together they let you take a sequential pipeline — source → transform → sink — and parallelize the expensive middle stage without changing the stages on either side. The source still emits one stream. The sink still reads one stream. In between, the work is divided among N workers and then reunited. This is how Go pipelines scale a slow stage horizontally while keeping the overall structure simple and composable.

If a worker pool is "many workers, one results channel," fan-out/fan-in generalizes it: you fan a stream *out* to many workers, then fan their outputs *in* to one merged stream that the next stage can consume as if the parallelism never happened.

### Technical Explanation

A fan-out/fan-in pipeline is assembled from small stage functions, each of which takes channels in and returns channels out. The channels are the joints between stages.

**The generator (source)** turns a slice into a channel and closes it when done. Closing is what lets every downstream `range` terminate.

```go
func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}
```

**Fan-out** is simply starting the same stage function multiple times, each reading from the shared input channel. Because all the workers `range` over the *same* `in` channel, the runtime distributes its values among them — whichever worker is free takes the next value.

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            out <- n * n
        }
    }()
    return out
}

// fan-out: start N independent square stages over the same input
in := gen(1, 2, 3, 4, 5, 6, 7, 8)
c1 := square(in)
c2 := square(in)
c3 := square(in)
```

Each of `c1`, `c2`, `c3` is a separate output channel. Now we need to recombine them.

**Fan-in** merges multiple channels into one. The standard idiom uses a `sync.WaitGroup` and one forwarding goroutine per input channel. Each forwarder copies values from its input into the shared `out`. A closer goroutine waits for all forwarders and then closes `out`:

```go
func merge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup

    forward := func(c <-chan int) {
        defer wg.Done()
        for v := range c { // drains c until it is closed
            out <- v
        }
    }

    wg.Add(len(cs))
    for _, c := range cs {
        go forward(c)
    }

    go func() {
        wg.Wait()   // every input fully drained
        close(out)  // safe: no forwarder will send again
    }()

    return out
}
```

The downstream consumer then ranges over the single merged channel:

```go
for n := range merge(c1, c2, c3) {
    total += n
}
```

Two subtleties make this correct. First, `out` is closed **exactly once**, from the closer goroutine, only after `wg.Wait()` confirms every forwarder has finished — closing from inside a forwarder would let another forwarder send on a closed channel and panic. Second, the pattern relies on every upstream channel being **closed** when its source is exhausted; if `square` forgot to `close(out)`, its forwarder's `range` would block forever, `wg.Wait()` would never return, and the merged channel would never close. The whole pipeline drains and terminates only because closes propagate from source to sink.

### Design Rationale

In a thread-pool world (Java's `ExecutorService`, a `BlockingQueue`, futures), parallelizing a pipeline stage means submitting tasks and then gathering futures — joining results by calling `future.get()` on each, blocking until they complete. The merging logic is imperative and lives in the calling code, tangled with the task submission.

Go expresses the same idea with channels as first-class plumbing. A stage is just a function `func(<-chan T) <-chan T`. Fan-out is calling that function several times on one input. Fan-in is a reusable `merge` function. Because every stage has the same channel-in/channel-out shape, stages **compose**: you can snap them together in any order, insert a new stage in the middle, or change the fan-out width by adding another call — all without touching the stages around it. This composability is the payoff of building pipelines from channels rather than from shared queues and futures.

> Share memory by communicating.

Here the shared input is communicated to many workers over one channel, and their results are communicated back over many channels merged into one — no shared mutable list, no locks, no manual future-joining. The data flow *is* the program structure, visible in the channel types.

### Common Mistakes

**Forgetting to close a stage's output channel.** Every stage goroutine must `defer close(out)` so that downstream `range` loops terminate. If `square` never closes its output, the corresponding `merge` forwarder ranges forever, `wg.Wait()` never returns, and the entire pipeline hangs. Closes must propagate from source to sink.

**Closing the merged channel from inside a forwarder.** With multiple forwarders sending to one `out`, the first to finish must not close it — the others are still sending. "Send on closed channel" panics. The close belongs in a single closer goroutine gated on `wg.Wait()`.

**Leaking goroutines when the consumer stops early.** If the downstream consumer breaks out of its `range` before draining the merged channel, every blocked forwarder (and every upstream stage goroutine) is stuck on a send that will never be received — a goroutine leak. Robust pipelines thread a `done` channel or `context.Context` through every stage so an early exit signals all goroutines to stop. (This is covered in depth in the goroutine-leak kata.)

**Assuming fan-out preserves order.** Once a stream fans out to N workers, results come back in completion order, not input order. If order matters you must tag items with an index and reorder at the sink, or avoid fanning out that stage. Treating the merged stream as ordered is a silent correctness bug.

**Fanning out a stage that is not actually slow.** Fan-out adds goroutines, channel sends, and merge overhead. If the stage is cheap, the coordination cost exceeds the parallelism benefit. Fan out the *bottleneck* stage only.

### Key Takeaways

- **Fan-out** = multiple goroutines reading the same input channel; **fan-in** = merging multiple output channels into one.
- Build pipelines from stages shaped `func(<-chan T) <-chan T` so they compose freely.
- The `merge` function uses one forwarder goroutine per input plus a `WaitGroup`; close the merged channel exactly once, after `wg.Wait()`.
- Closes must propagate from source to sink — every stage closes its own output when its input drains.
- Fan-out does **not** preserve input order; reorder at the sink if order matters.
- Fan out only the slow stage, and thread cancellation through stages to avoid leaks on early exit.

---

## Broken Code

```go
// broken: the merge closes `out` from inside each forwarder, so the first
// goroutine to finish closes the channel while others are still sending,
// causing a "send on closed channel" panic. It also never propagates close.
package main

import "fmt"

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for n := range in {
            out <- n * n
        }
        // Bug: forgot to close(out). Downstream range never terminates.
    }()
    return out
}

func merge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    for _, c := range cs {
        go func(c <-chan int) {
            for v := range c {
                out <- v
            }
            close(out) // Bug: each forwarder closes the SAME channel -> panic
        }(c)
    }
    return out
}

func main() {
    in := make(chan int)
    go func() {
        for i := 1; i <= 6; i++ {
            in <- i
        }
        close(in)
    }()

    c1 := square(in)
    c2 := square(in)

    total := 0
    for n := range merge(c1, c2) {
        total += n
    }
    fmt.Println("total:", total)
}
```

---

## Correct Code

```go
// correct: fan-out across N square stages, fan-in via a single safe merge.
package main

import (
	"fmt"
	"sync"
)

// gen turns a list of numbers into a stream and closes it when done.
func gen(nums ...int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for _, n := range nums {
			out <- n
		}
	}()
	return out
}

// square is a pipeline stage: read ints, emit their squares, then close.
func square(in <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			out <- n * n
		}
	}()
	return out
}

// merge fans several channels into one. It closes the merged channel
// exactly once, after every input has been fully drained.
func merge(cs ...<-chan int) <-chan int {
	out := make(chan int)
	var wg sync.WaitGroup

	forward := func(c <-chan int) {
		defer wg.Done()
		for v := range c {
			out <- v
		}
	}

	wg.Add(len(cs))
	for _, c := range cs {
		go forward(c)
	}

	go func() {
		wg.Wait()
		close(out)
	}()

	return out
}

func main() {
	// Source stream.
	in := gen(1, 2, 3, 4, 5, 6, 7, 8)

	// Fan-out: three square stages all read from the same input channel,
	// so the eight values are spread across them concurrently.
	c1 := square(in)
	c2 := square(in)
	c3 := square(in)

	// Fan-in: merge the three result streams into one.
	total := 0
	count := 0
	for n := range merge(c1, c2, c3) {
		total += n
		count++
	}

	fmt.Printf("merged %d results\n", count)
	fmt.Println("sum of squares:", total)
}
```

---

## Explanation

The broken version fails in two ways. The `square` stage never closes its output channel, so any downstream `range` over it would block forever once the input is exhausted. More dramatically, `merge` closes `out` inside every forwarder goroutine. With two forwarders sending into the same `out`, the first one to drain its input calls `close(out)` while the second is still trying to send — Go panics with "send on closed channel". A channel must be closed exactly once, and only when no goroutine will send on it again.

The correct version makes closes a first-class part of every stage. `gen` and `square` each `defer close(out)`, so when their input drains, their output channel closes and the close propagates down the pipeline. Fan-out is achieved by calling `square(in)` three times: all three stage goroutines range over the *same* `in` channel, so the runtime distributes the eight input values among them. This is the entire mechanism of fan-out — no special API, just multiple readers on one channel.

Fan-in lives in `merge`. It launches one forwarder goroutine per input channel, each copying values into the shared `out`. A `sync.WaitGroup` tracks the forwarders, and a single closer goroutine calls `wg.Wait()` and then closes `out` exactly once — safely, because by then no forwarder can still be sending. The consumer ranges over the single merged channel, sums the results, and the program terminates cleanly with no leaked goroutines. The structure is fully composable: to widen the fan-out you add another `square(in)` call and pass it to `merge`; nothing else changes.

---

## Design Tradeoff

Fan-out/fan-in trades **simplicity and ordering for throughput**. A plain sequential pipeline is trivially correct and preserves order, but its slowest stage caps the whole pipeline's speed. Fanning that stage out lets several copies run concurrently, raising throughput — at the cost of more goroutines, more channel traffic, the merge machinery, and the loss of input ordering. You only come out ahead when the fanned-out stage is genuinely the bottleneck and is expensive enough that parallelism dwarfs the coordination overhead. Fanning out a cheap stage makes the program slower, not faster.

There is also a **liveness cost** to manage: every additional stage and forwarder is a goroutine that can leak if the consumer abandons the pipeline early. The clean composability of channel-based stages is real, but it comes with the obligation to either drain every stream to completion or thread a cancellation signal (a `done` channel or `context.Context`) through all stages. Fan-out/fan-in is the right tool when a pipeline has a clear, heavy bottleneck — and the wrong tool when added concurrency buys nothing but complexity.

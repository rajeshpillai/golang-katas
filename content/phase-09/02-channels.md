---
id: channels
phase: 9
phase_title: Concurrency Fundamentals
sequence: 2
title: Channels
---

## Description

### Concept Overview

A channel is a typed conduit through which goroutines send and receive values. If goroutines are the "processes" in Go's CSP model, channels are the wires between them. You declare a channel with a specific element type — `chan int`, `chan string`, `chan Result` — and only values of that type can travel through it. The channel itself is a first-class value: you pass it to functions, store it in structs, and return it from constructors.

Channels do two jobs at once. They **transfer data** between goroutines, and they **synchronize** those goroutines, because sending and receiving are coordinated operations that can block until both sides are ready. This dual nature is what makes them the centerpiece of the slogan "share memory by communicating." Instead of guarding a shared variable with a lock, you hand the value to another goroutine through a channel, and ownership moves with it.

A channel must be created with `make` before use. Its zero value is `nil`, and operations on a `nil` channel block forever — a subtlety we will return to. Once created, a channel can be sent to, received from, and eventually closed to signal that no more values are coming.

### Technical Explanation

**Creating channels** uses `make`. The optional second argument is the buffer capacity:

```go
ch := make(chan int)      // unbuffered: capacity 0
buf := make(chan int, 4)  // buffered: capacity 4
```

**Send and receive** use the arrow operator `<-`, where the arrow points in the direction the value flows:

```go
ch <- 42      // send: put 42 into the channel
v := <-ch     // receive: take a value out of the channel
<-ch          // receive and discard
```

**Unbuffered channels (capacity 0)** are synchronous rendezvous points. A send blocks until another goroutine is ready to receive, and a receive blocks until another goroutine is ready to send. The transfer happens at the exact moment both meet. This gives a strong guarantee: when a send on an unbuffered channel completes, you *know* the receiver has taken the value. The handoff is also a synchronization point — there is a *happens-before* relationship, so memory writes made before the send are visible to the receiver after the receive.

**Buffered channels (capacity N > 0)** decouple sender and receiver up to N values. A send succeeds immediately as long as the buffer is not full; it only blocks when the buffer is full. A receive succeeds immediately as long as the buffer is not empty; it only blocks when the buffer is empty. The buffer acts as a bounded queue (FIFO). This allows a fast producer to get ahead of a slower consumer by up to N items before backpressure kicks in.

**Closing a channel** signals that no more values will be sent:

```go
close(ch)
```

After close, sends panic, but receives still drain any buffered values and then return the element's zero value. The two-value receive form distinguishes a real value from a closed-and-empty channel:

```go
v, ok := <-ch   // ok == false means the channel is closed and drained
```

**Ranging over a channel** receives values until the channel is closed and drained, which is the idiomatic consumer loop:

```go
for v := range ch { // exits cleanly when ch is closed
    use(v)
}
```

The rule of thumb: **the sender closes, never the receiver**, because only the sender knows when no more values are coming. A channel should be closed exactly once.

### Design Rationale

Channels are Go's concrete realization of CSP. In Hoare's model, processes do not touch each other's memory; they communicate over named channels with synchronized message passing. Go takes this and makes channels a built-in type with first-class language support — `make`, `<-`, `close`, `range`, and `select` are all part of the language, not a library bolted on top.

Contrast this with the **shared-memory-plus-locks** model of Java and C++. There, to move a result from a producer thread to a consumer thread, you typically protect a shared queue with a mutex and a condition variable: the producer locks, enqueues, signals, unlocks; the consumer locks, waits on the condition, dequeues, unlocks. Every step is a chance to introduce a bug — forget to signal and the consumer sleeps forever; check the condition without a loop and you hit spurious wakeups; lock in the wrong order across two queues and you deadlock. Go folds all of that into a single typed primitive. `ch <- v` and `<-ch` *are* the synchronized queue, the condition variable, and the lock, combined and correct by construction.

The reason this matters is **ownership transfer**. When a value travels through a channel, the idiom is that the sender relinquishes it and the receiver takes it. At any instant, exactly one goroutine "owns" the value, so there is no shared mutable state to race over. The channel makes the handoff explicit in the code. This is the practical meaning of "share memory by communicating": you still share the underlying data, but you do it by passing it along a channel rather than by multiple goroutines reaching into the same variable.

Go does not pretend locks are obsolete — `sync.Mutex` exists and is the right tool for protecting a small piece of shared state like a counter or a cache. But channels are the default for *moving data and coordinating goroutines*, because they encode the synchronization and the data flow together.

### Common Mistakes

**Sending on or closing a `nil` channel.** A `nil` channel (the zero value, never `make`d) blocks forever on both send and receive, and closing it panics. This usually happens when a struct field holding a channel was never initialized. Why: the runtime treats `nil` channel operations as permanently-not-ready, which in `select` is sometimes useful but in a plain send is a silent deadlock.

**Closing a channel twice, or closing from the receiver.** `close(ch)` on an already-closed channel panics with "close of closed channel." Closing from the receiver side races with the sender. Why: close is a one-time state transition that only the producer can know is appropriate. Establish a single owner that closes exactly once.

**Sending on a closed channel.** This panics. It typically happens when multiple producers share a channel and one closes it while another is still sending. Why: after close, the channel's invariant is "no more values," so a send violates it. With multiple producers, coordinate with a `WaitGroup` and let a single goroutine close after all producers finish.

**Forgetting to close, leaving `range` blocked.** A `for v := range ch` loop never ends if the channel is never closed; the receiving goroutine leaks, blocked forever. Why: `range` only terminates on close. If a channel has a finite stream of values, the producer must close it.

**Deadlock from an unbuffered send with no receiver.** `ch := make(chan int); ch <- 1` in a single goroutine deadlocks immediately: the send blocks waiting for a receiver that does not exist, and the runtime detects that all goroutines are asleep. Why: unbuffered sends require a simultaneous receiver. Either run the receiver in another goroutine or use a buffered channel if a buffer is appropriate.

### Key Takeaways

- A channel is a typed conduit that both transfers a value and synchronizes the goroutines on each end.
- Create channels with `make`; an unbuffered channel (capacity 0) is a synchronous rendezvous, while a buffered channel decouples sender and receiver up to its capacity.
- A send on an unbuffered channel guarantees the receiver has taken the value; buffered sends only block when the buffer is full.
- Close a channel to signal "no more values"; the sender closes exactly once, never the receiver, and never twice.
- Use `v, ok := <-ch` to detect a closed channel and `for v := range ch` to consume until close.
- Operations on a `nil` channel block forever, sending on a closed channel panics, and an unbuffered send with no receiver deadlocks — these are the classic channel traps.

---

## Broken Code

```go
// broken: unbuffered send with no ready receiver -> immediate deadlock
package main

import "fmt"

func main() {
	ch := make(chan int) // unbuffered: capacity 0

	// This send blocks waiting for a receiver, but the only other
	// goroutine that could receive is... this same one. There is no
	// concurrent receiver, so the goroutine parks forever and the
	// runtime reports: "fatal error: all goroutines are asleep - deadlock!"
	ch <- 42

	value := <-ch // never reached
	fmt.Println("received", value)
}
```

---

## Correct Code

```go
// correct: a producer goroutine sends a stream, the consumer ranges to completion
package main

import (
	"fmt"
)

// produce sends the numbers 0..n-1 on ch, then closes it to signal
// that no more values are coming. The sender owns the channel and
// is responsible for closing it exactly once.
func produce(ch chan<- int, n int) {
	for i := 0; i < n; i++ {
		ch <- i
	}
	close(ch)
}

func main() {
	ch := make(chan int, 2) // small buffer lets the producer run ahead

	// Run the producer concurrently so sends and receives can rendezvous.
	go produce(ch, 5)

	// range receives values until the channel is closed and drained,
	// then exits cleanly. No manual counting, no leftover goroutine.
	sum := 0
	for v := range ch {
		fmt.Println("received", v)
		sum += v
	}

	fmt.Println("channel closed; total =", sum)
}
```

---

## Explanation

The broken version creates an unbuffered channel and then sends on it from the only running goroutine. An unbuffered send is a rendezvous: it blocks until some *other* goroutine is ready to receive. But there is no other goroutine — the receive on the next line can never run because execution is stuck on the send. The Go runtime detects that every goroutine is blocked and aborts with a deadlock fatal error. The lesson is that unbuffered channels require a sender and a receiver to be active *concurrently*.

The correct version separates the two roles. `produce` runs in its own goroutine, sending five values and then closing the channel. The main goroutine consumes with `for v := range ch`, which receives until the channel is closed and drained, then exits the loop on its own. Because the producer and consumer run in separate goroutines, every send finds a receiver (or buffer slot) and the program makes progress. The single `close` in `produce` is what lets `range` terminate cleanly — without it, the loop would block forever after the fifth value, leaking the main goroutine's wait.

Note the small buffer of capacity 2. It is not required for correctness here, but it lets the producer push a couple of values ahead of the consumer before blocking, which can smooth out timing. The program terminates deterministically: it prints the five values (in order, since there is a single producer) and the total.

---

## Design Tradeoff

Choosing between unbuffered and buffered channels is the central design decision when using them. Unbuffered channels give the strongest synchronization: a completed send proves the value was received, so the two goroutines are tightly coupled in time. That coupling is exactly what you want when the handoff *is* the coordination — for example, signaling that a stage is ready. The price is that the sender cannot get ahead; it stalls until the receiver shows up.

Buffered channels trade some of that guarantee for throughput and decoupling. A buffer lets a producer absorb bursts and keep working while the consumer catches up, which improves pipeline performance. But the buffer also hides backpressure: a send succeeding no longer means the value was consumed, only that it was queued. Oversizing buffers can mask a slow consumer until the buffer fills under load and latency spikes. The idiomatic guidance is to start unbuffered (the simplest, most synchronized form) and add buffering only when you have a concrete reason — measured throughput needs or a known, bounded burst size — rather than reaching for a large buffer by default.

---
id: directional-channels
phase: 9
phase_title: Concurrency Fundamentals
sequence: 4
title: Directional Channels
---

## Description

### Concept Overview

A channel value can carry a *direction* in its type. A plain `chan T` can be both sent to and received from. But Go also has send-only channels, written `chan<- T`, and receive-only channels, written `<-chan T`. The arrow shows the permitted direction: `chan<- T` means "you may send into it" (the arrow points into the channel), and `<-chan T` means "you may receive from it" (the arrow points out of the channel).

Directional channel types are not a separate kind of channel. There is only one underlying channel; the direction is a *constraint applied at a type boundary*, almost always a function parameter. A bidirectional `chan T` converts implicitly to either `chan<- T` or `<-chan T`, but never back. So when you pass a channel to a function that takes `chan<- int`, that function can only send — the compiler forbids it from receiving or closing in a way that violates the role you assigned.

The purpose is to encode *intent* and *responsibility* in the type system. A producer function should declare its channel parameter as send-only; a consumer should declare it as receive-only. This makes the data-flow direction visible in the signature and lets the compiler catch misuse — like a consumer accidentally sending, or a receiver trying to close a channel it does not own.

### Technical Explanation

**The three channel type forms:**

```go
chan T     // bidirectional: send and receive allowed
chan<- T   // send-only: only `ch <- v` and close(ch) allowed
<-chan T   // receive-only: only `v := <-ch` and `range ch` allowed
```

**Implicit conversion is one-way.** A `chan T` can be assigned or passed where a `chan<- T` or `<-chan T` is expected. The reverse is illegal — you cannot widen a directional channel back to bidirectional, and you cannot convert send-only to receive-only or vice versa. This one-directional narrowing is what makes the constraint meaningful: once a function holds a `<-chan T`, there is no way within the type system to recover send access.

```go
func producer(out chan<- int) { out <- 1 }       // send-only param
func consumer(in <-chan int)  { v := <-in; _ = v } // receive-only param

ch := make(chan int) // bidirectional
producer(ch)         // ch converts to chan<- int
consumer(ch)         // ch converts to <-chan int
```

**Closing is a send-side privilege.** You may call `close` on a `chan<- T` (send-only) but **not** on a `<-chan T` (receive-only). This is the compiler enforcing the rule from the channels kata: the sender closes, the receiver never does. A receive-only channel literally cannot be closed, so the "receiver closed the channel" bug becomes impossible to write.

**Returning a receive-only channel** is the idiomatic generator pattern. A constructor creates a bidirectional channel internally, launches a goroutine that sends and closes, and returns the channel narrowed to `<-chan T` so callers can only consume:

```go
func count(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            out <- i
        }
    }()
    return out // returned as receive-only
}
```

The caller gets a stream it can `range` over but cannot send to or close — the producer goroutine retains exclusive control of those operations. This is the backbone of pipeline stages: each stage takes a `<-chan In` and returns a `<-chan Out`.

**Compile-time enforcement.** All of this is checked at compile time with zero runtime cost. A direction violation — sending on a receive-only channel, closing a receive-only channel — is a compiler error, not a panic. The direction information exists only in the type; the compiled code is identical to a bidirectional channel.

### Design Rationale

Directional channels are Go applying its core philosophy — make intent explicit, let the compiler enforce it — to concurrency. A bare `chan int` in a function signature tells the reader nothing about whether the function produces or consumes values. A `chan<- int` or `<-chan int` tells them immediately, and the compiler guarantees the function lives up to that contract. The type *is* the documentation, and it cannot drift out of date.

This connects directly to the CSP discipline of single ownership. In "share memory by communicating," the safety comes from each value having one owner at a time and each channel having clear sender and receiver roles. Directional types let you *enforce* those roles structurally. The producer owns the right to send and close; the consumer owns the right to receive. By splitting one bidirectional channel into two narrowed views at the function boundary, you prevent the most damaging channel bugs — sending on a closed channel, closing twice, closing from the wrong side — by construction rather than by convention.

Compare the alternatives. In **Java's** `BlockingQueue` or **C++'s** condition-variable queues, there is no type-level notion of "this thread may only put" or "this thread may only take." Producer and consumer hold the same queue object with the same full API; the only thing stopping a consumer from calling `put` is programmer discipline and code review. Go pushes that discipline into the type checker. The cost is essentially zero — no runtime overhead, just a slightly more specific type — and the benefit is a whole class of concurrency mistakes that simply will not compile.

The decision to make conversion strictly one-way (bidirectional narrows to directional, never the reverse) is what gives the guarantee teeth. If you could widen a `<-chan T` back to `chan T`, the receive-only promise would be meaningless. Go closes that door.

### Common Mistakes

**Trying to receive on a send-only channel (or send on a receive-only one).** Inside a function with a `chan<- int` parameter, writing `v := <-ch` is a compile error. This usually signals confused roles — the function thinks it is a consumer but was given a producer's view. Why: the direction in the type permits exactly one operation, and the compiler refuses the other.

**Closing a receive-only channel.** Calling `close` on a `<-chan T` does not compile. Beginners sometimes write a consumer that closes the channel when it sees the last value. Why: close is a producer privilege; the type system deliberately removes it from the receiver to prevent the "receiver closes" bug.

**Expecting to widen a directional channel back.** Assigning a `<-chan int` to a `chan int` variable, or passing it where a bidirectional channel is required, fails to compile. Why: widening would discard the constraint, so Go forbids it entirely; directional narrowing is intentionally irreversible.

**Declaring channel parameters as bidirectional out of habit.** Writing `func worker(ch chan int)` when the function only sends loses all the documentation and safety benefits, and lets future edits accidentally receive or close. Why: it is not an error, just a missed opportunity — idiomatic Go narrows direction at every boundary where the role is known.

**Forgetting that direction is only about *access*, not a different channel.** Some learners think a `chan<- T` and a `<-chan T` are two separate channels and try to "connect" them. They are two *views* of the same underlying channel. Why: `make` always returns a bidirectional channel; the directional forms are constraints layered on at boundaries.

### Key Takeaways

- A channel type can be bidirectional (`chan T`), send-only (`chan<- T`), or receive-only (`<-chan T`); the arrow shows the allowed direction.
- A bidirectional channel converts implicitly to either directional form, but directional channels never widen back — the narrowing is one-way and irreversible.
- `close` is permitted on send-only channels and forbidden on receive-only ones, so the compiler enforces "the sender closes, never the receiver."
- Use directional types on function parameters and return values to document and enforce producer/consumer roles at compile time with zero runtime cost.
- Returning a `<-chan T` from a constructor is the idiomatic generator/pipeline pattern: callers consume but cannot send or close.
- Directional types are constraints on *access* to one underlying channel, not separate channels.

---

## Broken Code

```go
// broken: a consumer parameter typed bidirectionally lets bugs slip in,
// and here it wrongly closes a channel it does not own.
package main

import "fmt"

// consume should only receive, but the bidirectional `chan int` type
// permits sending and closing too. Nothing stops this misuse at the
// type level.
func consume(ch chan int) {
	for v := range ch {
		fmt.Println("got", v)
	}
	// Bug: the consumer closes a channel the producer also closes.
	// On the next producer close(), or on a second run, this causes
	// "panic: close of closed channel". A receive-only type would have
	// made this line a compile error.
	close(ch)
}

func main() {
	ch := make(chan int)
	go func() {
		for i := 0; i < 3; i++ {
			ch <- i
		}
		close(ch) // producer also closes -> double close with consume's close
	}()
	consume(ch)
}
```

---

## Correct Code

```go
// correct: directional types make producer/consumer roles explicit and
// enforce them at compile time.
package main

import (
	"fmt"
	"sync"
)

// generate returns a receive-only channel. The producer goroutine owns
// the send and close operations; callers can only consume.
func generate(n int) <-chan int {
	out := make(chan int) // bidirectional internally
	go func() {
		defer close(out) // sender closes, exactly once
		for i := 0; i < n; i++ {
			out <- i
		}
	}()
	return out // narrowed to <-chan int on return
}

// square takes a receive-only input and returns a receive-only output:
// a classic pipeline stage. It cannot send on in or close it.
func square(in <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for v := range in { // can only receive from in
			out <- v * v // can only send on out
		}
	}()
	return out
}

// consume takes a receive-only channel: the compiler forbids it from
// sending or closing, eliminating the double-close bug by construction.
func consume(in <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for v := range in {
		fmt.Println("squared:", v)
	}
}

func main() {
	var wg sync.WaitGroup

	// Build a pipeline: generate -> square -> consume.
	numbers := generate(5)
	squares := square(numbers)

	wg.Add(1)
	go consume(squares, &wg)

	wg.Wait()
	fmt.Println("pipeline drained; done")
}
```

---

## Explanation

The broken version types the consumer's parameter as a plain bidirectional `chan int`. That type permits every operation, so nothing stops `consume` from calling `close(ch)` after it finishes ranging. But the producer goroutine *also* closes `ch`. Whichever close runs second hits an already-closed channel and triggers `panic: close of closed channel`. The bug is a confusion of roles: the consumer takes on a responsibility (closing) that belongs to the producer, and the bidirectional type offered no protection against it.

The correct version encodes the roles in the types. `generate` creates a bidirectional channel internally but returns it as `<-chan int`, so callers can only receive. The producer goroutine inside `generate` is the sole owner of the send and `close` operations. `square` is a pipeline stage: it takes `<-chan int` and returns `<-chan int`, so it can receive from its input and send on its own output, but it can neither send on the input nor close it. `consume` takes `<-chan int`, which means the line `close(ch)` from the broken version would not even compile here — the receiver simply has no close capability. The double-close bug is impossible to write.

The whole program is a three-stage pipeline (`generate → square → consume`) that terminates cleanly: each stage closes its own output when its input is drained, the closes propagate downstream, and `wg.Wait()` returns once the consumer finishes. Every channel is closed exactly once, by its rightful owner, enforced by the type system.

---

## Design Tradeoff

Directional channels trade a small amount of signature verbosity for compile-time safety and self-documenting code. Typing every channel parameter as `chan<- T` or `<-chan T` instead of `chan T` requires you to think about each function's role and write a slightly longer type. In exchange, the compiler guarantees that producers cannot accidentally receive, consumers cannot accidentally send or close, and pipeline stages cannot reach across their boundaries. A reader can determine the data-flow direction of an entire pipeline just from the function signatures, with no comments and no risk of the documentation lying.

The limit of the technique is that direction is a property of a *type boundary*, not a runtime guard — it protects the function's view of the channel, not the channel itself. Within the producer goroutine you still hold the bidirectional channel and must still close it correctly exactly once. So directional types do not replace careful ownership design; they make the ownership *visible and enforceable at the seams* where channels pass between functions. Idiomatic Go narrows direction at every such seam, treating bidirectional channels as an internal detail that should rarely appear in a public signature.

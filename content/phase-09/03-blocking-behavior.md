---
id: blocking-behavior
phase: 9
phase_title: Concurrency Fundamentals
sequence: 3
title: Blocking Behavior
---

## Description

### Concept Overview

Blocking is the heart of how channels coordinate goroutines. A channel operation "blocks" when it cannot complete right now: a receiver blocks when there is nothing to receive, a sender blocks when there is no room to send. While a goroutine is blocked, it makes no progress and consumes no CPU — the scheduler parks it and runs other goroutines instead. When the condition that blocked it becomes true (a value arrives, a slot opens), the runtime wakes it and it resumes.

This is not a defect to be avoided; it is the mechanism. Blocking is how one goroutine waits for another without busy-looping, without polling, and without a separate condition variable. The blocking and unblocking *is* the synchronization. Understanding exactly which operations block, and when they unblock, is what separates code that coordinates correctly from code that deadlocks or leaks.

The flip side is that blocking forever is the most common concurrency bug in Go. A goroutine blocked on a channel that will never be ready is stuck for the life of the program. If enough goroutines get stuck, or if *every* goroutine gets stuck, you have a leak or a deadlock. The skill is knowing the precise blocking rules so you can guarantee that every block eventually unblocks.

### Technical Explanation

**The blocking rules** for channel operations are exact and worth memorizing:

| Operation | Blocks until... |
|---|---|
| Receive from unbuffered channel | a sender is ready |
| Send to unbuffered channel | a receiver is ready |
| Receive from buffered channel | the buffer is non-empty (or channel is closed) |
| Send to buffered channel | the buffer is non-full |
| Receive from closed channel | never blocks — returns immediately |
| Send to closed channel | never blocks — panics immediately |
| Any operation on a `nil` channel | forever |

**Receiving from a closed channel never blocks.** It drains any buffered values, then returns the zero value immediately, with the two-value form reporting `ok == false`. This is what makes `for v := range ch` and "done" signaling work.

**A `nil` channel blocks forever** on both send and receive. This is occasionally useful inside `select` to disable a case, but in straight-line code it is a silent hang.

**Deadlock detection.** The Go runtime has a global deadlock detector. If *all* goroutines are simultaneously blocked — none can make progress — the runtime aborts the whole program with `fatal error: all goroutines are asleep - deadlock!`. This is a safety net, not a feature to rely on: it only fires when *every* goroutine is stuck. If one goroutine is busy in an infinite loop while another is blocked forever, the detector stays silent and you simply leak the blocked goroutine.

**Blocking and the scheduler.** When a goroutine blocks on a channel, the runtime does not block the underlying OS thread. It saves the goroutine's state, removes it from the run queue, and lets the thread pick up another runnable goroutine. The blocked goroutine is placed on a wait queue associated with the channel. When a matching operation occurs (a send for a waiting receiver, say), the runtime moves the value and marks the goroutine runnable again. This is why blocking is cheap: it is a user-space queue operation, not a kernel thread suspension.

**Avoiding blocking with `select` + `default`.** A `select` with a `default` case turns a blocking operation into a non-blocking one. If no channel case is immediately ready, the `default` runs instead of blocking:

```go
select {
case v := <-ch:
    use(v)        // a value was ready
default:
    // nothing ready right now; do not block
}
```

This is the standard idiom for a non-blocking receive or send, and the foundation for timeouts when combined with `time.After`.

### Design Rationale

Go chose blocking-by-default for channels because it makes coordination *declarative*. You write "receive a value from this channel," and the language guarantees your goroutine waits efficiently until one is available. You do not write a polling loop, you do not manage a condition variable, and you do not spin the CPU. The blocking semantics encode the wait for you.

This is a sharp contrast with **manual synchronization in C or Java**. There, waiting for a condition means a `while (!ready) cond.wait(lock);` loop — and you *must* use a loop, because condition variables permit spurious wakeups, and you *must* hold the right lock, and you *must* signal at the right time. Each of those is a well-known footgun. Channels collapse the wait-and-wake protocol into a single primitive that is correct by construction: there are no spurious channel wakeups, and the value handoff and the wakeup are the same atomic event.

The runtime's **deadlock detector** reflects Go's philosophy of failing loudly rather than hanging silently — *when it can*. A total deadlock is almost always a programming error, so the runtime crashes instead of leaving you staring at a frozen process. But Go's designers were honest about the limits: detecting a single leaked goroutine in general is undecidable, so the detector only catches the all-stuck case. The rest is on you, which is why Go ships `-race`, goroutine dumps (`SIGQUIT` prints all goroutine stacks), and `context.Context` for cancellation — tools to find and prevent the leaks the detector cannot.

The decision to make `nil` channels block forever, rather than panic, is subtle but deliberate: it lets you dynamically enable and disable `select` cases by setting a channel variable to `nil`, a powerful idiom for state machines built on channels.

### Common Mistakes

**Deadlock from a missing concurrent partner.** Sending on an unbuffered channel with no goroutine receiving (or receiving with no goroutine sending) blocks forever. If it is the only goroutine, the detector fires; if not, it leaks. Why: unbuffered operations require a partner active *at the same time*.

**Leaking a goroutine blocked on a channel nobody closes or sends to.** A worker doing `for v := range ch` leaks if the producer returns early without closing `ch`. The detector will not catch it if other goroutines are still running. Why: `range` only ends on close, so an unclosed channel means an eternal block. Always ensure the producer closes, and use `context` cancellation for early exit.

**Assuming a closed channel blocks.** Receiving from a closed channel returns *immediately*, repeatedly, with the zero value. A `for { v := <-ch; ... }` loop over a closed channel spins at full CPU forever, never blocking. Why: close makes receives always-ready. Use the `ok` flag or `range` to stop.

**Forgetting that a `nil` channel hangs.** A struct field channel that was never `make`d is `nil`, and any send/receive on it blocks forever — often misdiagnosed as a logic bug elsewhere. Why: `nil` channels are permanently not-ready by design.

**Using `default` in a hot loop and burning CPU.** Wrapping a receive in `select { case ...: ...; default: }` inside a tight `for` makes a busy-poll that pegs a core. Why: `default` makes the select non-blocking, so the loop never parks. Use a blocking receive, or add a timeout/ticker, instead of spinning.

### Key Takeaways

- A blocked goroutine consumes no CPU; the scheduler parks it and runs others, then wakes it when its channel operation can proceed.
- Receives block on an empty channel, sends block on a full one; both directions of an unbuffered channel require a concurrent partner.
- Receiving from a closed channel never blocks (returns the zero value immediately); sending to a closed channel panics; any operation on a `nil` channel blocks forever.
- The runtime's deadlock detector aborts the program only when *all* goroutines are blocked — it cannot catch single leaked goroutines.
- `select` with a `default` case converts a blocking operation into a non-blocking one, but using it in a tight loop busy-polls and wastes CPU.
- The cure for leaks and deadlocks is guaranteeing every block eventually unblocks: close channels from the sender, and use cancellation for early exit.

---

## Broken Code

```go
// broken: the worker blocks forever because main never sends, then exits
package main

import (
	"fmt"
	"sync"
)

func main() {
	ch := make(chan int) // unbuffered
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		// This receive blocks waiting for a value that main never sends.
		// The goroutine parks here permanently. Because wg.Done never
		// runs, wg.Wait below also blocks forever -> deadlock.
		v := <-ch
		fmt.Println("worker received", v)
	}()

	// Bug: main forgot to send on ch (and never closes it).
	// Both goroutines are now blocked: the worker on <-ch, main on Wait.
	wg.Wait()
}
```

---

## Correct Code

```go
// correct: every block is matched by a concurrent partner that unblocks it
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	ch := make(chan int) // unbuffered rendezvous
	var wg sync.WaitGroup

	// Receiver: blocks on <-ch until main sends, then prints and returns.
	wg.Add(1)
	go func() {
		defer wg.Done()
		v := <-ch // unblocks the instant main's send rendezvous succeeds
		fmt.Println("worker received", v)
	}()

	// main sends a value; the unbuffered send unblocks the receiver above.
	ch <- 7

	// Demonstrate non-blocking receive with select+default: the channel
	// is now empty and no one will send again, so default runs instead
	// of blocking.
	select {
	case v := <-ch:
		fmt.Println("unexpected value", v)
	default:
		fmt.Println("nothing ready to receive; not blocking")
	}

	// Demonstrate a bounded wait with a timeout so we never hang forever.
	done := make(chan struct{})
	go func() {
		time.Sleep(10 * time.Millisecond)
		close(done) // closing makes the receive below unblock immediately
	}()
	select {
	case <-done:
		fmt.Println("background task signaled completion")
	case <-time.After(time.Second):
		fmt.Println("timed out waiting for background task")
	}

	wg.Wait() // the receiver already returned, so this does not block
	fmt.Println("all goroutines finished")
}
```

---

## Explanation

The broken version sets up an unbuffered channel and a goroutine that immediately blocks on `<-ch`, waiting for a value. The main goroutine never sends on `ch`, so the worker parks forever on the receive. Because the worker never reaches `wg.Done()`, the `wg.Wait()` in main also blocks forever. Now *both* goroutines are stuck, so the runtime's deadlock detector fires and the program aborts with `fatal error: all goroutines are asleep - deadlock!`. The root cause is a block with no partner: a receive that no send will ever satisfy.

The correct version makes sure every blocking operation has something that will unblock it. The worker blocks on `<-ch`, and main performs the matching `ch <- 7` — the unbuffered send and receive rendezvous, both goroutines unblock, and the value transfers. After that, main shows two ways to *avoid* unbounded blocking. The `select` with `default` performs a non-blocking receive: the channel is empty, no case is ready, so `default` runs instead of parking. Then `time.After` provides a bounded wait — main waits for `done` to close but gives up after one second, so even if the background task hung, main would not.

Every goroutine in the correct program eventually returns, so `wg.Wait()` completes and the program terminates cleanly and quickly. The pattern to internalize: pair every block with a guaranteed unblock — a concurrent partner, a close, a `default`, or a timeout.

---

## Design Tradeoff

Blocking-by-default is what makes channel code concise and efficient, but it pushes the responsibility for liveness onto the programmer. The language guarantees that a blocked goroutine costs nothing while it waits and resumes the instant its operation can proceed — there is no polling and no wasted CPU. The cost is that there is no built-in timeout on a channel operation: a receive will wait literally forever if you do not arrange otherwise. Go's answer is composition rather than a special blocking-with-timeout primitive — you build bounded waits out of `select`, `time.After`, and `context.Context`.

The tradeoff, then, is between simplicity and safety. A bare `<-ch` is the simplest possible wait and is correct whenever you can prove a partner exists. The moment that proof is uncertain — a network peer, a worker that might die, a task that might hang — you must wrap the operation in a `select` with a timeout or cancellation, accepting a little more code in exchange for guaranteed liveness. Idiomatic Go starts with the plain blocking form for internal, provably-paired operations and reserves `select`-based timeouts for boundaries where the partner is outside your control.

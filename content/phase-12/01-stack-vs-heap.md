---
id: stack-vs-heap
phase: 12
phase_title: Memory, Performance & GC Awareness
sequence: 1
title: Stack vs Heap (Conceptual)
---

## Description

### Concept Overview

Every value your Go program creates lives somewhere in memory. There are two broad regions where that can happen: the **stack** and the **heap**. The stack is a small, fast region tied to each goroutine's call frames — values placed there are created and destroyed automatically as functions are entered and exited. The heap is a larger, shared region managed by the garbage collector — values placed there outlive the function that created them and must eventually be reclaimed.

In many languages you choose this explicitly. In C you call `malloc` for the heap and declare locals for the stack. In Go you do **not** choose. The compiler decides, through a process called **escape analysis**, where each value goes. Your job is not to control allocation directly but to understand the rules well enough to write code that lets the compiler keep things on the stack when it matters — and to know when it genuinely does not matter.

This distinction is the foundation for everything else in this phase. Garbage collection, allocation patterns, and profiling all revolve around one central question: **did this value escape to the heap, and did it need to?**

### Technical Explanation

**The stack** is a per-goroutine region of memory organized as a last-in-first-out structure of *call frames*. When a function is called, a frame is pushed holding its parameters, return values, and local variables. When the function returns, the frame is popped — instantly, by just moving a pointer. There is no bookkeeping, no garbage collector involvement, and no synchronization, because each goroutine owns its own stack. Allocation and deallocation on the stack are effectively free.

Go's stacks are also **growable**. A goroutine starts with a tiny stack (a few kilobytes). If it needs more, the runtime allocates a larger stack, copies the old one over, and adjusts pointers. This is why Go can run millions of goroutines cheaply — stacks are small and grow on demand.

**The heap** is a single region shared across all goroutines. Values on the heap have no fixed lifetime tied to a function call. They persist until the garbage collector proves that no live part of the program can still reach them, at which point their memory is reclaimed. Heap allocation costs more than stack allocation: it involves the allocator finding space, and it adds work for the GC later.

**Escape analysis** is the compiler pass that decides stack vs heap. The core rule is about *lifetime and reachability*: if the compiler can prove a value does not outlive the function that created it, the value stays on the stack. If the value's lifetime might extend beyond the function — because a pointer to it is returned, stored in a longer-lived structure, captured by a closure that outlives the call, or sent through an interface or channel — the value **escapes** to the heap.

You can observe escape analysis directly. Compile with the flag:

```text
go build -gcflags='-m' ./...
```

The compiler prints lines like `moved to heap: x` or `&y escapes to heap`, telling you exactly which values escaped and why.

Some common triggers for escape:

- **Returning a pointer to a local variable.** The local must survive after the function returns, so it escapes.
- **Storing a value behind an interface.** `fmt.Println(x)` boxes `x` into an `interface{}`, which often forces it to the heap.
- **Closures capturing a variable by reference** when the closure outlives the function.
- **Slices or maps whose size is not known at compile time**, or that grow beyond what the compiler can bound.
- **Taking the address of something and passing it somewhere the compiler cannot follow.**

Crucially, **taking a pointer (`&x`) does not automatically cause a heap allocation.** A pointer to a local that never escapes the function stays on the stack. Go is happy to have stack-allocated values pointed at, as long as the pointer's lifetime is contained.

### Design Rationale

Go deliberately hides the stack/heap decision from the programmer. This is a sharp departure from C and C++, where you manually manage the heap and bear the full risk of use-after-free, double-free, and memory leaks. It is also different from Rust, which keeps manual control but uses the borrow checker to make it safe at compile time — at the cost of a steep learning curve and significant annotation burden.

Go chose a middle path: **automatic placement plus a garbage collector**. The compiler's escape analysis captures most of the performance benefit of stack allocation automatically, so idiomatic Go is fast without the programmer thinking about it. When a value genuinely must outlive its frame, it transparently goes to the heap and the GC handles cleanup. The programmer writes straightforward code; the toolchain does the dangerous bookkeeping.

The tradeoff Go accepts is that you give up *precise* control. You cannot force a value onto the stack, and you cannot manually free heap memory. In exchange you get memory safety with no borrow checker, simple code, and performance that is good by default and tunable when it matters. For the vast majority of programs — services, tools, pipelines — this is exactly the right trade. For the rare hot path, escape analysis output and profiling let you claw back control without leaving the language.

### Common Mistakes

- **Believing `&x` always allocates on the heap.** It does not. Pointers to non-escaping locals stay on the stack. People rewrite clean pointer code into awkward value-copying code to "avoid the heap" when escape analysis was already keeping it on the stack. Check with `-gcflags='-m'` before assuming.

- **Assuming value semantics are always cheaper than pointers.** Copying a large struct by value is real work, and passing it through interfaces can still cause an escape. The "value = stack = free" intuition breaks down for big types. Measure; do not guess.

- **Returning pointers to locals to "save a copy," then being surprised by heap traffic.** Returning `&local` is correct and safe in Go (the value escapes and lives on), but it *does* allocate. If you do this in a tight loop, you generate garbage. Sometimes returning a value is cheaper than returning a pointer precisely because it avoids the escape.

- **Trying to manually defeat escape analysis.** Writing convoluted code to trick the compiler usually backfires: the analysis evolves between Go versions, and clever tricks make code unreadable while saving nanoseconds that never mattered. Trust the compiler first; profile second.

- **Confusing "on the heap" with "leaked."** A heap value is not a leak. The GC reclaims it once unreachable. Escaping to the heap is a performance consideration (more GC work), not a correctness bug.

### Key Takeaways

- The **stack** is fast, per-goroutine, and automatically reclaimed; the **heap** is shared, GC-managed, and outlives function calls.
- In Go you do **not** choose stack vs heap — the compiler's **escape analysis** decides based on whether a value's lifetime escapes its function.
- Use `go build -gcflags='-m'` to see exactly what escapes and why.
- Taking `&x` does **not** automatically allocate; only *escaping* causes heap allocation.
- Go trades precise control (C/C++/Rust) for safety and simplicity, recovering performance via escape analysis and the GC.
- Heap allocation is a performance concern, not a leak — focus on it only on paths that profiling shows matter.

---

## Broken Code

```go
// broken: a hot loop that needlessly forces values onto the heap.
// Each iteration returns a pointer to a fresh local, so every value
// escapes and becomes garbage the GC must later clean up.
package main

import (
	"fmt"
	"runtime"
)

// newCounter returns a *pointer* to a freshly allocated int every call.
// Because the address escapes the function, the int is heap-allocated.
func newCounter(start int) *int {
	c := start
	return &c // &c escapes to heap on every call
}

func main() {
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)

	total := 0
	// One million heap allocations we did not actually need.
	for i := 0; i < 1_000_000; i++ {
		p := newCounter(i)
		total += *p
	}

	runtime.ReadMemStats(&after)
	fmt.Println("total:", total)
	fmt.Println("heap allocations (mallocs):", after.Mallocs-before.Mallocs)
}
```

---

## Correct Code

```go
// correct: keep the value on the stack by not letting it escape.
// We pass and return plain values; the compiler keeps everything in the
// call frame and the loop performs zero heap allocations.
package main

import (
	"fmt"
	"runtime"
)

// makeCounter returns an int by value. Nothing escapes, so the value
// lives on the caller's stack frame — no heap allocation, no GC work.
func makeCounter(start int) int {
	c := start
	return c
}

func main() {
	var before, after runtime.MemStats

	// Force any startup garbage to settle so our measurement is clean.
	runtime.GC()
	runtime.ReadMemStats(&before)

	total := 0
	for i := 0; i < 1_000_000; i++ {
		v := makeCounter(i) // stays on the stack
		total += v
	}

	runtime.ReadMemStats(&after)

	fmt.Println("total:", total)
	fmt.Println("heap allocations in loop (mallocs):", after.Mallocs-before.Mallocs)
	fmt.Println()
	fmt.Println("Tip: run `go build -gcflags='-m'` to see escape analysis decisions.")
	fmt.Println("The value version reports no 'escapes to heap' for the loop body.")
}
```

---

## Explanation

The broken version looks innocent: `newCounter` returns a `*int`. But returning the address of a local variable means that local must outlive the function call, so escape analysis moves it to the heap. Run the loop a million times and you have generated a million tiny heap allocations, each of which the garbage collector must eventually trace and reclaim. The `Mallocs` counter from `runtime.MemStats` makes this visible — it climbs by roughly one million.

The correct version returns the `int` *by value*. The compiler can now prove the value never escapes its frame, so it stays on the stack. Stack allocation is just a pointer bump; deallocation is automatic when the frame pops. The loop performs zero heap allocations, which you can confirm because the `Mallocs` delta stays at (or very near) zero. We call `runtime.GC()` before measuring to settle any startup allocations so the comparison is clean.

The deeper lesson is not "never return pointers" — returning pointers is often correct and necessary. The lesson is that **pointer-returning code allocates, value-returning code may not**, and in a hot loop that difference is real, measurable garbage. The tool that lets you stop guessing is `go build -gcflags='-m'`, which prints the compiler's escape decisions for every line.

---

## Design Tradeoff

By making escape analysis automatic, Go frees you from the manual allocate/free discipline of C while still capturing most of the speed of stack allocation. The cost is that placement is *implicit*: you cannot command a value onto the stack, and the same line of code might allocate or not depending on how the value is used downstream. This can feel opaque — the only way to be sure is to ask the compiler with `-gcflags='-m'` or to measure with `MemStats`.

The right posture is to write clear, idiomatic code first and treat allocation as something you investigate only when a profile says a path is hot. Rewriting readable pointer code into convoluted value-juggling to dodge the heap is almost always a net loss: you trade clarity for nanoseconds that usually do not matter, against a compiler whose analysis improves with every release. Reserve escape-analysis tuning for the small, proven hot spots — and let the compiler handle everything else.

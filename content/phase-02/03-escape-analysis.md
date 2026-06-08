---
id: escape-analysis
phase: 2
phase_title: Pointers & Memory Basics
sequence: 3
title: Escape Analysis (Conceptual)
---

## Description

### Concept Overview

When your Go program runs, every value lives somewhere in memory — either on the **stack** or on the **heap**. The stack is fast, per-goroutine, and automatically reclaimed when a function returns. The heap is shared, managed by the garbage collector, and slower to allocate and reclaim. The good news: you almost never choose where a value goes. The Go compiler decides for you, through a process called **escape analysis**.

Escape analysis is the compiler asking one question about every value: "Does this value need to outlive the function that created it?" If the answer is no, the value stays on the stack and disappears for free when the function returns. If the answer is yes — for example, because you return a pointer to it, or store it somewhere reachable after the function exits — the value "escapes" to the heap, where the garbage collector will eventually clean it up.

The key insight for this kata is that in Go, taking the address of a local variable with `&` is completely safe — even returning that pointer. There is no dangling pointer, no use-after-free. The compiler simply moves the value to the heap so it stays alive as long as something references it.

### Technical Explanation

**Stack vs heap, conceptually.**

| | Stack | Heap |
|---|-------|------|
| Speed of allocation | Essentially free (move a pointer) | Slower (find/track a block) |
| Reclaimed by | Function return (automatic) | Garbage collector |
| Lifetime | Until the function returns | Until no references remain |
| Per-goroutine? | Yes, each goroutine has its own | No, shared across goroutines |

A stack allocation is just bumping the stack pointer; deallocation is bumping it back. A heap allocation must be tracked and later collected, which costs CPU and adds garbage-collector pressure.

**What "escaping" means.** A value escapes when a reference to it can be observed after the creating function returns. Common triggers:

```go
// 1. Returning a pointer to a local — the local must outlive the function.
func newCounter() *int {
    n := 0
    return &n // n escapes to the heap
}

// 2. Storing a pointer in something with a longer lifetime.
func store(dst *[]*int, x int) {
    *dst = append(*dst, &x) // &x escapes; it lives in the slice
}

// 3. Sending a pointer to another goroutine or a channel.
// 4. Putting a value in an interface that itself escapes.
```

If none of these happen — if the value is used only within the function and its callees — it stays on the stack:

```go
// Does NOT escape: p is used locally and never leaks out.
func sum() int {
    n := 5
    p := &n
    return *p // we return the value, not the pointer; n stays on the stack
}
```

**Seeing the decisions.** The compiler will tell you what it decided. Run:

```
go build -gcflags='-m' yourfile.go
```

You will see lines like `moved to heap: n` or `&x escapes to heap`. This is the authoritative answer — you never have to guess. (This flag is for learning and tuning; you do not sprinkle it into normal builds.)

**Why this is safe.** In C, returning `&localVar` is a classic bug: the local's stack frame is destroyed on return, so the pointer dangles. Go eliminates this entire bug class by promoting escaping locals to the heap *automatically*. The semantics are always correct; escape analysis only affects *where* the value lives, never *whether* it stays valid.

### Design Rationale

Go's escape analysis embodies a recurring theme of the language: **safety without ceremony, performance without manual control.**

**C and C++** make the stack/heap decision the programmer's job. You write `int x;` for the stack and `malloc`/`new` for the heap, and you are responsible for freeing heap memory and for never returning pointers to dead stack variables. This gives maximum control and maximum opportunity for catastrophic bugs: dangling pointers, double frees, memory leaks.

**Java, Python, and JavaScript** go the other way: almost every object lives on the heap, and the garbage collector handles everything. This is safe and simple but pays a constant tax — even short-lived, function-local objects become garbage the collector must track and reclaim. The programmer has little say in the matter.

Go threads the needle. By default it would be safe to put everything on the heap (like Java), but the compiler proves, value by value, which allocations *cannot* escape and keeps those on the stack — getting C-like efficiency for the common case of short-lived locals, with no manual `free` and no dangling-pointer risk. You write the obvious, idiomatic code (including freely returning `&local`), and the compiler quietly chooses the cheapest correct placement. The programmer expresses *intent* (sharing via pointers); the compiler handles *placement*.

### Common Mistakes

**Fearing `return &local` out of C habit.** People avoid returning the address of a local because in C it is undefined behavior. In Go it is idiomatic and safe — the value escapes to the heap automatically. Writing contorted code to avoid it adds complexity for no benefit.

**Assuming `new` means heap and a literal means stack.** Neither `new(T)` nor a composite literal forces a location. `new(T)` can stay on the stack if it does not escape, and `&T{}` can stay on the stack too. Conversely, an ordinary `var x T` can be moved to the heap if its address escapes. The keyword is not the deciding factor — escape behavior is.

**Adding pointers everywhere to "avoid copying" and accidentally causing escapes.** Replacing a small value parameter with a pointer can force the value onto the heap, adding GC pressure that outweighs the saved copy. For small values, passing by value is often *faster* precisely because it stays on the stack. Optimizing without measuring frequently backfires.

**Treating escape analysis as something to fight.** Beginners sometimes try to micro-manage allocations by guessing what escapes. Without measuring (`-gcflags='-m'`, benchmarks, the profiler) these guesses are usually wrong, and the resulting code is harder to read. Escape analysis is best understood, then trusted, then tuned only when profiling shows a real hot spot.

**Believing escape decisions are part of the program's meaning.** They are not. Whether a value lands on the stack or heap never changes the program's *result* — only its performance. Reasoning about correctness in terms of allocation location is a category error.

### Key Takeaways

- Every value lives on the stack or the heap; the Go compiler decides via escape analysis, not you.
- Stack allocation is nearly free and auto-reclaimed on return; heap allocation is slower and reclaimed by the garbage collector.
- A value "escapes" to the heap when a reference to it can outlive the function that created it (e.g., returning `&local`).
- Returning the address of a local is safe in Go — the compiler moves the value to the heap automatically; no dangling pointers.
- `new` vs. literal vs. `var` does not determine location; escape behavior does.
- Use `go build -gcflags='-m'` to see the compiler's decisions; optimize allocations only when profiling proves it matters.

---

## Broken Code

```go
// broken: C-style thinking — manually trying to avoid returning a pointer
// to a local, producing convoluted, less-safe code based on a false premise.
package main

import "fmt"

// The author wrongly believes returning &local is unsafe (it is NOT in Go),
// so they pass a caller-provided buffer and reach OUTSIDE its bounds.
func makeID(buf *[1]int, seed int) *int {
    // Bug: index 5 is out of range for a [1]int array.
    // This panics at runtime: index out of range.
    buf[5] = seed * 7
    return &buf[5]
}

func main() {
    var storage [1]int
    id := makeID(&storage, 3)
    fmt.Println("id:", *id)
}
```

---

## Correct Code

```go
// correct: return a pointer to a local; let escape analysis place it safely
package main

import "fmt"

// newID returns the address of a local int. In Go this is safe:
// escape analysis moves `n` to the heap because its address outlives newID.
func newID(seed int) *int {
    n := seed * 7
    return &n // n escapes to the heap; the returned pointer is valid
}

// sumLocally uses a pointer to a local but never lets it escape,
// so the compiler can keep the value on the stack — fast and free.
func sumLocally(a, b int) int {
    total := 0
    p := &total // address used only inside this function
    *p = a + b
    return *p // we return the value, not the pointer; nothing escapes
}

func main() {
    // Two independent IDs, each backed by its own heap-allocated int.
    a := newID(3)
    b := newID(10)
    fmt.Println("id a:", *a) // 21
    fmt.Println("id b:", *b) // 70

    // Different addresses prove they are distinct values.
    fmt.Println("a and b share storage?", a == b) // false

    // The non-escaping case still works and is cheaper under the hood.
    fmt.Println("sum:", sumLocally(4, 5)) // 9

    // Mutating through one pointer does not affect the other.
    *a = 100
    fmt.Println("after *a = 100 -> a:", *a, "b:", *b) // 100 70
}
```

---

## Explanation

The broken version is rooted in a false premise carried over from C: the author believes returning `&n` for a local `n` would be dangerous, so they instead force the caller to supply a buffer and write the result into it. But they index `buf[5]` of a `[1]int` array, which is out of range, and the program panics. The irony is that the entire workaround was unnecessary — the thing they were avoiding (returning the address of a local) is perfectly safe in Go. The convoluted "safer" design introduced a real bug while trying to dodge an imaginary one.

The correct version does the simple, idiomatic thing: `newID` creates a local `n`, returns `&n`, and trusts the compiler. Because the returned pointer outlives the function, escape analysis moves `n` to the heap so it stays valid; the caller receives a fully usable pointer with no danger of dangling. Each call to `newID` produces an independent value, which we confirm by comparing addresses (`a == b` is `false`) and by mutating one without affecting the other. The `sumLocally` function illustrates the contrasting case: it also takes the address of a local, but that address never leaves the function, so the compiler is free to keep `total` on the stack. Both functions are correct; the only difference is *where* the value lives, which is exactly the decision escape analysis makes for you. You can confirm all of this by compiling with `go build -gcflags='-m'` and reading the `moved to heap` notes.

---

## Design Tradeoff

Escape analysis trades programmer control for safety and simplicity. In C you decide stack vs. heap explicitly and pay for mistakes with crashes and leaks; in Go you give up that explicit control and the compiler chooses for you, guaranteeing correctness in every case. The cost is that you cannot *force* a particular placement from the source — you can only write code whose escape behavior leads the compiler to the placement you want, and then verify with `-gcflags='-m'`.

The second trade is between predictability and performance. Garbage-collected languages that heap-allocate everything are easy to reason about but pay a constant collection tax; manual languages are fast but unsafe. Go's escape analysis keeps short-lived locals on the cheap stack while safely promoting the few values that genuinely need to live longer. The result is that idiomatic Go — including freely returning pointers to locals — is both safe and, for the common case, efficient, without the programmer micromanaging memory. The right posture is to understand escape analysis, trust it by default, and tune only when a profiler points at a real allocation hot spot.

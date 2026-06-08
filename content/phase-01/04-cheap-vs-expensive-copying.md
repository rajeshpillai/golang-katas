---
id: cheap-vs-expensive-copying
phase: 1
phase_title: Structs, Methods & Data Modeling
sequence: 4
title: When Copying Is Cheap vs Expensive
---

## Description

### Concept Overview

Go copies values constantly. Every function argument, every assignment, every value-receiver method call, every channel send, and every `append` that grows a slice can copy data. Most of the time this is invisible and irrelevant — copying a few bytes is essentially free. But copying is not always cheap, and copying is not always *safe*. A large struct copied on every call wastes CPU and memory bandwidth. A struct containing a `sync.Mutex` copied by value silently breaks its locking. A struct holding a slice or pointer, when copied, produces a *shallow* copy that shares the underlying data with the original — a subtle source of aliasing bugs.

This kata is about developing intuition for when a copy is cheap and harmless, when it is expensive, and when it is outright dangerous. The decision feeds directly into earlier choices: whether to use a value or pointer receiver, and whether to pass a struct by value or by pointer.

### Technical Explanation

**What "copying a struct" actually does.** Copying a struct duplicates its fields *bit for bit*. The cost is proportional to the struct's in-memory size (`unsafe.Sizeof`), not to how "big" it feels conceptually:

```go
type Point struct{ X, Y int }          // 16 bytes — trivially cheap to copy
type Matrix struct{ data [1024]float64 } // 8192 bytes — expensive to copy
```

A `Point` copy moves 16 bytes. A `Matrix` copy moves 8 KB on every assignment or value-receiver call. The first is negligible; the second, in a hot loop, is a real cost.

**Shallow copy and shared backing data.** Slices, maps, channels, and pointers are *reference-like*: the struct field is a small header (for a slice: a pointer, a length, and a capacity — 24 bytes on 64-bit) that points to backing data elsewhere. Copying the struct copies the *header*, not the backing data. Both copies then point at the same underlying array or map:

```go
type Team struct {
    Name    string
    Members []string // 24-byte header pointing to a backing array
}

a := Team{Name: "A", Members: []string{"Ada"}}
b := a            // copies the slice header; both share the backing array
b.Members[0] = "Bob"
fmt.Println(a.Members[0]) // "Bob" — the copy aliased the original's data!
```

This is the central subtlety: copying a struct is cheap *because* it does not deep-copy reference fields, but that same shallowness means the copy is not independent. Mutating shared backing data through one copy is visible through the other.

**Copying can be unsafe, not just slow.** Some types must never be copied:

- `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once` — copying duplicates internal state and breaks the synchronization invariant. `go vet` reports "passes lock by value."
- Types whose identity matters (the copy is a different object that the original code does not know about).

For these, you must use pointers (and pointer receivers) so there is exactly one instance.

**Measuring size and copies.** `unsafe.Sizeof(v)` reports the shallow size of a value (the bytes that get copied). It does *not* include backing arrays. Use it to reason about copy cost:

```go
fmt.Println(unsafe.Sizeof(Point{}))  // 16
fmt.Println(unsafe.Sizeof(Team{}))   // 40 (string header 16 + slice header 24)
```

**The escape-analysis nuance.** Passing by pointer is not automatically "faster." A pointer can force the value to *escape to the heap* (so the garbage collector must track it), whereas a small value passed by copy can stay on the stack. So for small structs, copying by value is often *both* faster and lighter on the GC than passing a pointer. The rule of thumb: copy small immutable values; share large or mutable ones by pointer.

### Design Rationale

Go's pass-by-value default is a deliberate departure from reference-everywhere languages.

**Java** makes every object a reference; you never copy an object implicitly, but you also never get a cheap independent value — everything is shared, and independence requires manual `clone()` (with all its pitfalls). Go inverts this: small values are copied and independent by default, and you opt into sharing with a pointer.

**C++** gives you the full machinery — value semantics, copy constructors, move semantics, references — which is powerful but requires understanding when deep copies happen, what a copy constructor does, and how RAII interacts with copying. Go deliberately omits copy constructors and overloading: a copy is always a shallow, bitwise field copy, with no hidden user code running. This makes copy *cost* predictable, at the price of having to manage shallow-sharing yourself.

**C** copies structs bitwise on assignment, exactly like Go, and shares heap data through pointers, exactly like Go's reference fields. Go's model is essentially C's value semantics plus garbage collection, with the same shallow-copy reality for pointer-bearing structs.

The upshot of Go's choice: copying is simple and predictable (always bitwise, never running hidden code), so the programmer can reason about *cost* and *aliasing* directly from the type's fields and size. The responsibility that comes with that simplicity is recognizing when a shallow copy is too expensive or unsafe and reaching for a pointer instead.

### Common Mistakes

**Assuming a struct copy is a deep, independent copy.** Copying a struct with a slice, map, or pointer field yields a *shallow* copy that shares backing data. Mutating that shared data through one copy is visible through the other. If you need independence, you must explicitly deep-copy the reference fields (e.g., allocate a new slice and `copy` into it).

**Copying a struct that contains a `sync.Mutex`.** This silently breaks locking: the two copies have independent mutex state, so they no longer guard the same critical section. `go vet` warns "passes lock by value." Types with a mutex must be used via pointers and pointer receivers.

**Passing huge structs by value in hot paths.** A value receiver or value parameter on an 8 KB struct copies 8 KB per call. In a tight loop this dominates runtime. Use a pointer receiver/parameter for large structs to copy just the 8-byte pointer.

**Reflexively using pointers "for performance" on tiny structs.** A pointer can force a small value to escape to the heap, adding GC pressure and an indirection on every access. For small, short-lived values, copying by value is usually faster *and* cheaper. Measure before assuming pointers help.

**Forgetting that arrays are value types but slices are not.** `[1024]int` is copied in full on assignment (8 KB); `[]int` copies only a 24-byte header. Beginners conflate the two and are surprised either by an expensive array copy or by an aliased slice.

### Key Takeaways

- Copy cost is proportional to a value's shallow in-memory size (`unsafe.Sizeof`), not its conceptual "bigness."
- Copying a struct with slice/map/pointer fields is a *shallow* copy: the copy shares the same backing data and is not independent.
- Some types (`sync.Mutex`, `WaitGroup`, etc.) must never be copied; use pointers and pointer receivers for them.
- Copy small, immutable values freely — it is cheap and often stack-friendly; share large or mutable values by pointer.
- Pointers are not automatically faster: they can force heap escapes and add indirection; choose based on size and mutation needs.
- Arrays are value types (copied in full); slices are reference-like (only the header is copied).

---

## Broken Code

```go
// broken: two distinct failures of "just copy the struct" thinking.
package main

import (
    "fmt"
    "sync"
)

// Counter must be shared, never copied: copying the Mutex breaks locking.
type Counter struct {
    mu    sync.Mutex
    Value int
}

// Value receiver copies the Counter — INCLUDING its Mutex.
// go vet: "Inc passes lock by value". The lock no longer protects
// a single shared Value, and the increment is lost on the copy anyway.
func (c Counter) Inc() {
    c.mu.Lock()
    c.Value++
    c.mu.Unlock()
}

type Team struct {
    Name    string
    Members []string
}

func main() {
    c := Counter{}
    c.Inc()
    fmt.Println("counter:", c.Value) // 0, not 1: mutated a copy

    a := Team{Name: "A", Members: []string{"Ada"}}
    b := a // shallow copy: b.Members shares a.Members' backing array
    b.Members[0] = "Bob"

    // Surprise: a.Members[0] is now "Bob" too — the copy aliased a's data.
    fmt.Println("team a:", a.Members[0])
}
```

---

## Correct Code

```go
// correct: share what must not be copied; deep-copy when independence
// is required; copy small values freely.
package main

import (
    "fmt"
    "sync"
    "unsafe"
)

// Counter is used via a pointer so its Mutex is never copied.
type Counter struct {
    mu    sync.Mutex
    Value int
}

// Pointer receiver: operates on the single shared Counter; the Mutex
// guards the real Value, and the increment persists.
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.Value++
}

type Team struct {
    Name    string
    Members []string
}

// Clone returns an INDEPENDENT copy: the slice's backing array is
// duplicated so mutations to the clone do not affect the original.
func (t Team) Clone() Team {
    members := make([]string, len(t.Members))
    copy(members, t.Members)
    return Team{Name: t.Name, Members: members}
}

// Point is tiny (16 bytes); copying by value is cheap and idiomatic.
type Point struct{ X, Y int }

func (p Point) Translate(dx, dy int) Point {
    return Point{X: p.X + dx, Y: p.Y + dy}
}

func main() {
    c := &Counter{} // share via pointer
    c.Inc()
    c.Inc()
    fmt.Println("counter:", c.Value) // 2

    a := Team{Name: "A", Members: []string{"Ada"}}
    b := a.Clone() // deep, independent copy
    b.Members[0] = "Bob"
    fmt.Println("team a:", a.Members[0]) // still "Ada"
    fmt.Println("team b:", b.Members[0]) // "Bob"

    // Small value type: cheap to copy, value semantics are a feature.
    p := Point{X: 1, Y: 2}
    q := p.Translate(3, 4)
    fmt.Println("p:", p, "q:", q) // p unchanged, q is the moved copy

    // Inspect shallow copy sizes to reason about copy cost.
    fmt.Println("sizeof Point:", unsafe.Sizeof(Point{})) // 16
    fmt.Println("sizeof Team: ", unsafe.Sizeof(Team{}))  // 40
}
```

---

## Explanation

The broken version makes two classic mistakes. First, `Counter.Inc` uses a value receiver, so each call copies the entire `Counter` — including its `sync.Mutex`. Copying a mutex breaks its invariant: the copy locks and unlocks its own private mutex state, not the original's, and `go vet` flags this with "passes lock by value." Worse, because it is a value receiver, the `Value++` happens on a copy and is discarded, so the counter never advances. Second, `b := a` performs a shallow copy of `Team`. The `Members` slice field is just a header pointing to a backing array; copying the struct copies the header but not the array, so `a` and `b` share the same underlying data. Writing `b.Members[0] = "Bob"` mutates the array that `a` also references, silently changing `a`.

The correct version addresses each issue with the right tool. `Counter` is used through a pointer (`&Counter{}`) with a pointer receiver, so there is exactly one mutex guarding exactly one `Value`, and increments persist. `Team.Clone` produces a genuinely independent copy by allocating a fresh slice and `copy`-ing the elements, so mutating the clone leaves the original untouched. And `Point` — a 16-byte struct — is copied freely by value, with `Translate` returning a new moved point; here value semantics are a *feature*, giving cheap, immutable, independent values. The closing `unsafe.Sizeof` calls make the copy-cost reasoning concrete: a `Point` is 16 bytes, a `Team` header is 40, and neither size includes the backing arrays that reference fields point to.

---

## Design Tradeoff

Go's promise is that copying is simple and predictable: a copy is always a bitwise duplication of a value's fields, with no hidden constructors or overloaded operators running behind your back. This makes copy *cost* easy to estimate from a type's size and lets small value types behave as cheap, independent, immutable units — exactly what you want for points, durations, and small records. You opt into sharing explicitly with a pointer, so the question "is this shared or copied?" is always answerable from the code.

The price of that simplicity is that you, not the language, own two responsibilities. First, copies of structs with reference fields are *shallow* — independence is something you must create deliberately by deep-copying slices and maps, and forgetting to do so produces aliasing bugs that are hard to trace. Second, some types are unsafe to copy at all, and nothing but `go vet` and discipline stops you from copying a mutex. The reward for managing these is a memory model with no hidden allocations or implicit deep copies, where you can reason directly about both performance and sharing — but it demands that you read each type's fields and ask, every time, whether a copy is cheap, independent, and safe.

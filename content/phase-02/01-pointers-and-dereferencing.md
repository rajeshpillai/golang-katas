---
id: pointers-and-dereferencing
phase: 2
phase_title: Pointers & Memory Basics
sequence: 1
title: Pointers and Dereferencing
---

## Description

### Concept Overview

A pointer is a value that holds the memory address of another value. Instead of storing the data itself, a pointer stores *where* the data lives. This single layer of indirection is one of the most important ideas in systems programming, and Go exposes it deliberately and explicitly.

In Go, you create a pointer with the address-of operator `&`, and you read or write the value it points to with the dereference operator `*`. A pointer to an `int` has the type `*int`. A pointer to a `User` struct has the type `*User`. The zero value of every pointer type is `nil`, meaning "points to nothing."

The crucial mental model is this: a pointer lets two pieces of code refer to the *same* underlying value. When one piece of code changes the value through the pointer, the other piece of code sees the change. Without a pointer, Go copies values, and changes to a copy never affect the original. Pointers are how you opt out of copying and into sharing.

### Technical Explanation

**Taking an address with `&`.** The `&` operator returns the address of a variable. The result is a pointer whose type is `*T` where `T` is the type of the variable:

```go
x := 42
p := &x        // p has type *int, holds the address of x
fmt.Println(p) // prints something like 0xc000018030
```

**Dereferencing with `*`.** The `*` operator, when applied to a pointer, gives you access to the value at that address. You can read through it and write through it:

```go
fmt.Println(*p) // read: prints 42
*p = 100        // write: changes the value stored at that address
fmt.Println(x)  // x is now 100, because p pointed at x
```

Note that `*` is overloaded in Go syntax. In a *type* position, `*int` means "pointer to int." In an *expression* position, `*p` means "the value p points at." They read similarly but live in different grammatical slots.

**The `new` builtin.** `new(T)` allocates zeroed storage for a value of type `T` and returns a `*T` pointing at it:

```go
p := new(int) // p is *int, *p is 0
*p = 7
```

`new(T)` is roughly equivalent to declaring a hidden variable of type `T` (which Go zero-initializes) and taking its address. It is most useful when you want a pointer to a freshly zeroed value without naming the variable.

**Pointer comparisons.** Pointers can be compared with `==` and `!=`. Two pointers are equal if they hold the same address (or are both `nil`). You cannot compare pointers with `<` or `>`, and you cannot do pointer arithmetic — Go is not C.

| Operation | Syntax | Meaning |
|-----------|--------|---------|
| Address-of | `&x` | Pointer to the variable `x` |
| Dereference | `*p` | The value `p` points at |
| Allocate | `new(T)` | A `*T` pointing at a zeroed `T` |
| Compare | `p == q` | True if same address or both `nil` |
| Zero value | `var p *T` | `nil` |

**No pointer arithmetic.** In C you can write `p + 1` to walk through memory. Go forbids this in normal code. A Go pointer either points at exactly one valid value or is `nil`. This restriction is what lets Go's garbage collector and type system remain memory-safe.

### Design Rationale

Go made pointers explicit but tame. This is a middle path between two extremes.

**C** gives you raw pointers with full arithmetic: `*(arr + i)`, casting between pointer types, and pointers to arbitrary addresses. This power is also the source of buffer overflows, use-after-free bugs, and undefined behavior. C trusts the programmer completely, and that trust is frequently betrayed.

**Java, Python, and JavaScript** hide pointers entirely. In these languages, objects are *always* accessed through references you cannot see or manipulate, while primitives are *always* copied. You never write `&` or `*`, but you also lose explicit control: you cannot tell from a function signature whether a value will be shared or copied, and you cannot have a pointer to a local primitive. The indirection is implicit and uniform, which means you cannot opt out of it when you want a cheap copy, and cannot opt into it precisely when you want sharing.

Go chooses explicitness without danger. You write `&` and `*` so the reader *sees* where sharing happens, but the language removes the foot-guns: no arithmetic, no manual freeing (the garbage collector handles that), and `nil` is the only invalid pointer state. The result is that pointers in Go communicate *intent* — "I want this to be shared and mutable" — rather than serving as a low-level memory tool.

### Common Mistakes

**Dereferencing a nil pointer.** The zero value of a pointer is `nil`. Writing `*p` when `p` is `nil` causes a runtime panic (`invalid memory address or nil pointer dereference`). This fails because there is no value at address "nothing" to read or write. You must ensure a pointer points at a real value before dereferencing it.

**Confusing the two meanings of `*`.** Beginners read `var p *int` and `y := *p` as the same operation. They are not. The first is a *type* (`*int`, "pointer to int"); the second is an *expression* (`*p`, "the value p points at"). Mixing these up leads to type errors that are confusing until the distinction clicks.

**Taking the address of a temporary you think disappears.** Coming from C, people fear `return &localVar` because in C the local's stack frame vanishes. In Go this is *safe* — Go's escape analysis moves the value to the heap automatically. The mistake here is not doing it; it is *fearing* it and writing convoluted code to avoid a perfectly idiomatic pattern.

**Forgetting that copying a pointer copies the address, not the value.** When you write `q := p`, both `p` and `q` now point at the *same* value. Writing through `*q` changes what `*p` sees too. People expecting an independent copy of the underlying data are surprised when one mutation appears to affect both.

**Comparing what a pointer points at vs. comparing addresses.** `p == q` compares addresses; `*p == *q` compares the pointed-at values. Two distinct variables holding the same number have equal `*p`/`*q` but unequal `p`/`q`. Choosing the wrong comparison silently produces wrong logic.

### Key Takeaways

- A pointer holds the memory address of a value; its type is `*T` and its zero value is `nil`.
- `&x` takes the address of `x`; `*p` dereferences `p` to read or write the value it points at.
- `*` means "pointer to" in a type position and "the value at" in an expression position — these are different roles.
- Go has no pointer arithmetic and no manual freeing; pointers either point at one valid value or are `nil`.
- Dereferencing a `nil` pointer panics at runtime — always ensure a pointer is non-nil before using `*`.
- Pointers express the *intent* to share and mutate a single underlying value rather than copy it.

---

## Broken Code

```go
// broken: dereferences a nil pointer and panics at runtime
package main

import "fmt"

type Counter struct {
    value int
}

func main() {
    var p *Counter // zero value of a pointer is nil — points at nothing

    // Bug: p is nil, so reading p.value dereferences a nil pointer.
    // This panics: "invalid memory address or nil pointer dereference"
    fmt.Println("current value:", p.value)

    // We never even reach here.
    p.value = 10
    fmt.Println("updated value:", p.value)
}
```

---

## Correct Code

```go
// correct: create real storage, then take its address and dereference safely
package main

import "fmt"

type Counter struct {
    value int
}

func main() {
    // 1. A pointer to a local variable. Go's escape analysis keeps this safe.
    x := 42
    p := &x // p has type *int and holds the address of x

    fmt.Println("x via value:   ", x)
    fmt.Println("x via pointer: ", *p) // dereference to read

    *p = 100             // dereference to write — changes x itself
    fmt.Println("after *p = 100, x =", x)

    // 2. Two pointers to the SAME value share mutations.
    q := p
    *q = 7
    fmt.Println("after *q = 7, *p =", *p, "and x =", x)

    // 3. Address comparison vs value comparison.
    a, b := 5, 5
    pa, pb := &a, &b
    fmt.Println("same address? ", pa == pb)   // false: different variables
    fmt.Println("same value?   ", *pa == *pb) // true: both hold 5

    // 4. A pointer to a struct, allocated with new (zeroed Counter).
    c := new(Counter) // c is *Counter, *c is Counter{value: 0}
    c.value = 10       // Go auto-dereferences: (*c).value = 10
    fmt.Println("counter value:", c.value)
}
```

---

## Explanation

The broken version declares `var p *Counter` but never gives it anything to point at. A freshly declared pointer is `nil` — it holds no address. The line `p.value` is shorthand for `(*p).value`, so Go must dereference `p` to reach the `value` field. Dereferencing `nil` has no valid memory to read, so the runtime panics immediately. This is the single most common pointer bug in Go, and it stems from forgetting that declaring a pointer does not allocate the thing it points at.

The correct version shows the full lifecycle. First we create a real variable `x`, then take its address with `&x`. Now `p` points at genuine storage, so `*p` can read and write safely. Writing `*p = 100` modifies `x` itself, proving that the pointer and the variable refer to the same memory. Copying the pointer into `q` makes both pointers alias the same value, so `*q = 7` is visible through `*p`. The comparison section highlights that `==` on pointers checks addresses, while `==` on dereferenced values checks the underlying data. Finally, `new(Counter)` allocates a zeroed struct and returns a pointer to it, and Go's automatic dereferencing lets us write `c.value` instead of the noisier `(*c).value`.

The lesson is that a pointer is only useful once it points at real, live storage — created either by taking the address of an existing variable or by allocating with `new`.

---

## Design Tradeoff

Making pointers explicit costs a little syntax: you must type `&` and `*` and reason about which level of indirection you are at. In languages that hide all references, you never write these symbols, and simple code can look cleaner. Go accepts this small verbosity because the payoff is *visible intent*. When you read a Go function and see `*User`, you immediately know mutations will be shared with the caller; when you see `User`, you know you are working on a copy. No hidden rules about "objects are references but primitives are values" — the type signature tells the whole story.

The flip side is responsibility: an explicit pointer can be `nil`, and dereferencing `nil` panics. Go trades the convenience of never-thinking-about-references for the clarity of always-knowing-when-you-are-sharing. In practice this trade favors large codebases, where being able to tell at a glance whether a value is shared or copied is worth far more than saving two characters.

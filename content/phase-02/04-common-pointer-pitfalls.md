---
id: common-pointer-pitfalls
phase: 2
phase_title: Pointers & Memory Basics
sequence: 4
title: Common Pointer Pitfalls
---

## Description

### Concept Overview

Pointers in Go are explicit and safe, but they still come with a handful of recurring traps. These pitfalls are not exotic — they appear constantly in real codebases, especially when developers are new to Go or carrying habits from other languages. The good news is that almost all of them reduce to a few core misunderstandings: forgetting that a pointer can be `nil`, forgetting that pointers *alias* (share) the same value, and misunderstanding how addresses interact with loops, maps, and slices.

This kata is a guided tour of the traps that cause the most production incidents: dereferencing `nil`, the classic loop-variable address bug, taking the address of an unaddressable value, accidental aliasing through copied pointers, and the inability to take the address of a map element. Each one has a clear cause and a clean, idiomatic fix.

The unifying theme: a pointer is a precise statement about *which* piece of memory you mean. Most pointer bugs are really bugs about meaning to point at one thing while actually pointing at another (or at nothing).

### Technical Explanation

**1. Nil dereference.** The zero value of any pointer is `nil`. Dereferencing it panics:

```go
var p *int
fmt.Println(*p) // panic: invalid memory address or nil pointer dereference
```

Guard with a nil check, or ensure the pointer is initialized before use.

**2. The loop-variable address trap (pre–Go 1.22 semantics, and still worth understanding).** Historically, a `for` loop reused a single variable across iterations. Taking its address repeatedly captured *the same* variable:

```go
nums := []int{1, 2, 3}
var ptrs []*int
for _, v := range nums {
    ptrs = append(ptrs, &v) // pre-1.22: all point at the SAME v
}
```

Before Go 1.22, every `&v` was the same address, so after the loop all pointers showed the final value. Go 1.22+ gives each iteration a fresh variable, fixing the common case — but the *robust, version-independent* fix is to copy into a new local and take *its* address:

```go
for _, v := range nums {
    v := v          // new variable each iteration
    ptrs = append(ptrs, &v)
}
```

**3. Unaddressable values.** You cannot take the address of everything. These have no address:

```go
p := &42                    // error: cannot take address of a literal
p := &someFunc()            // error: cannot take address of a function result
p := &m["key"]              // error: cannot take address of a map element
```

You *can* take the address of a variable, a struct field of an addressable value, a slice element, and an array element of an addressable array. The rule is: the value must have a stable memory location.

**4. Aliasing through copied pointers.** Copying a pointer does not copy the pointed-at value:

```go
a := &User{Name: "Ann"}
b := a          // b and a point at the SAME User
b.Name = "Bob"
fmt.Println(a.Name) // "Bob" — surprise if you expected a copy
```

To get an independent copy, dereference and copy the value: `c := *a; b := &c`.

**5. Map elements are not addressable.** Because a map may rehash and move its entries, you cannot take `&m[k]`. To mutate a struct stored in a map, either store pointers (`map[K]*V`) or read-modify-write the whole value:

```go
m := map[string]Point{"a": {1, 2}}
// m["a"].X = 9      // compile error: cannot assign to struct field of map value
v := m["a"]; v.X = 9; m["a"] = v // correct
```

### Design Rationale

Many of these pitfalls exist because Go made a deliberate choice to keep pointers safe and the memory model simple, accepting a few rough edges as the price.

**Map element unaddressability** is a direct consequence of how Go maps are implemented: entries may move when the map grows and rehashes, so a pointer into the map could dangle. Rather than pin entries (which would complicate the runtime and hurt performance), Go forbids `&m[k]` entirely. The restriction is annoying once, then it teaches you to model mutable map values as `map[K]*V`.

**The loop-variable trap** came from Go's original decision to make the loop variable a single reused variable — efficient and simple, but a footgun when combined with `&`. The Go team eventually decided the safety win was worth the change and, in Go 1.22, gave each iteration its own variable. That history is a useful lesson in language evolution: even a small, well-intentioned design choice can produce a pervasive bug class, and fixing it is worth a (carefully managed) breaking change.

Compared to **C**, where pointer bugs mean undefined behavior and silent corruption, Go's pitfalls are far gentler: a nil dereference panics *loudly and immediately* with a clear message, rather than corrupting memory and crashing later somewhere unrelated. Compared to **Java/Python**, where you cannot take addresses at all and aliasing is implicit and pervasive, Go's explicit `&` at least makes aliasing *visible* — you can see where sharing was requested. Go's pitfalls are the cost of giving you real pointers while keeping the language memory-safe.

### Common Mistakes

**Dereferencing a pointer without checking for nil.** A pointer returned from a lookup, a failed initialization, or an optional field may be `nil`. Dereferencing it panics. This fails because `nil` literally points at no memory. Always establish that a pointer is non-nil — by checking, or by construction — before using `*` or accessing a field through it.

**Storing `&loopVar` and getting the same value repeated.** Taking the address of a range/loop variable and stashing it captures the variable, not the iteration's snapshot. Before Go 1.22 this made every stored pointer identical; relying on that bug or on the version is fragile. The fix — `v := v` then `&v` — is correct on every Go version and states your intent clearly.

**Assuming `b := a` copies the data when `a` is a pointer.** Copying a pointer copies the address, so `a` and `b` alias the same value and mutations through one are visible through the other. This surprises people expecting value semantics. To copy the underlying data, dereference: `c := *a`.

**Trying to take the address of a map element or a literal.** `&m[k]`, `&42`, and `&f()` do not compile because those values have no stable address. The fix depends on intent: use `map[K]*V`, copy into a variable first, or read-modify-write the whole map value.

**Mutating a struct value stored in a map directly.** `m[k].Field = x` is a compile error because the map value is not addressable. Forgetting this leads to reaching for clever workarounds; the idiomatic fix is `v := m[k]; v.Field = x; m[k] = v`, or storing `*V` in the map.

### Key Takeaways

- The zero value of a pointer is `nil`; dereferencing `nil` panics — guard or construct before use.
- Taking the address of a loop variable captures the variable, not the iteration's value; copy with `v := v` then take `&v`.
- Not all values are addressable: literals, function results, and map elements have no stable address, so `&` on them does not compile.
- Copying a pointer copies the address, creating an alias — mutations are shared; dereference to copy the underlying value.
- Map values are not addressable; use `map[K]*V` or read-modify-write the whole value to mutate.
- Go's pointer pitfalls fail loudly (compile error or immediate panic), unlike C's silent memory corruption.

---

## Broken Code

```go
// broken: the classic loop-variable address bug PLUS a nil dereference.
package main

import "fmt"

type User struct {
    Name string
}

func find(users []User, name string) *User {
    for _, u := range users {
        if u.Name == name {
            return &u // returns address of the loop copy (fragile/misleading)
        }
    }
    return nil // not found -> nil
}

func main() {
    users := []User{{Name: "Ann"}, {Name: "Bob"}}

    // Collect pointers to every user.
    var ptrs []*User
    for _, u := range users {
        ptrs = append(ptrs, &u) // pre-1.22: all point at the same loop var
    }
    for _, p := range ptrs {
        fmt.Println(p.Name) // may print "Bob","Bob" on old Go versions
    }

    // Lookup that misses, then dereferences nil.
    missing := find(users, "Cara")
    fmt.Println("found:", missing.Name) // panic: nil pointer dereference
}
```

---

## Correct Code

```go
// correct: index into the slice for stable addresses; always check for nil.
package main

import "fmt"

type User struct {
    Name string
}

// find returns a pointer into the slice's backing array (stable address)
// and a found flag, so callers can handle the miss explicitly.
func find(users []User, name string) (*User, bool) {
    for i := range users {
        if users[i].Name == name {
            return &users[i], true // address of an addressable slice element
        }
    }
    return nil, false
}

func main() {
    users := []User{{Name: "Ann"}, {Name: "Bob"}}

    // Collect stable pointers by indexing the slice, not the loop copy.
    var ptrs []*User
    for i := range users {
        ptrs = append(ptrs, &users[i])
    }
    for _, p := range ptrs {
        fmt.Println("ptr ->", p.Name) // Ann, Bob — correct and distinct
    }

    // Mutating through a slice-element pointer reaches the real element.
    if p, ok := find(users, "Ann"); ok {
        p.Name = "Annie"
    }
    fmt.Println("users[0]:", users[0].Name) // Annie

    // Always check the found flag before dereferencing.
    if p, ok := find(users, "Cara"); ok {
        fmt.Println("found:", p.Name)
    } else {
        fmt.Println("Cara not found") // safe: no nil dereference
    }

    // Map values are not addressable: read-modify-write the whole value.
    scores := map[string]int{"Ann": 10}
    v := scores["Ann"]
    v += 5
    scores["Ann"] = v
    fmt.Println("Ann score:", scores["Ann"]) // 15
}
```

---

## Explanation

The broken version stacks two of the most common pointer bugs. First, both `find` and the collection loop take `&u` of the range variable `u`. Because `u` is a copy of each element (and, on Go versions before 1.22, a *single reused* variable), the resulting pointers do not refer to the elements in the slice — they refer to a transient copy. On older Go versions every stored pointer ends up aliasing the same variable and printing the final value. Even on Go 1.22+, returning `&u` from `find` hands back a pointer to a copy, so mutating through it would not affect the original slice — a silent correctness bug. Second, `find` returns `nil` when the name is missing, but `main` dereferences the result with `missing.Name` without checking, producing an immediate `nil pointer dereference` panic.

The correct version fixes both issues idiomatically. By looping with `for i := range users` and taking `&users[i]`, we obtain pointers into the slice's backing array — stable, addressable storage that refers to the real elements. Mutating through such a pointer (`p.Name = "Annie"`) genuinely updates `users[0]`. The `find` function returns an explicit `(*User, bool)` pair so callers must acknowledge the miss; the call sites use the `if p, ok := find(...); ok` pattern and never dereference a `nil` pointer. Finally, the map example shows the read-modify-write dance required because map values are not addressable: you cannot write `scores["Ann"] += 5` through a pointer, so you copy out, modify, and store back. Together these patterns cover the everyday pointer pitfalls you will meet in real Go code.

---

## Design Tradeoff

Go's pointer pitfalls are the price of a deliberate bargain: real, explicit pointers that remain memory-safe. The language could have eliminated the loop-variable trap, map-unaddressability, and nil dereferences by hiding pointers entirely (as Java and Python do), but that would also remove your ability to express precise sharing and in-place mutation — and it would make aliasing implicit and invisible rather than marked with a visible `&`. Conversely, Go could have allowed `&m[k]` and pointer arithmetic (as C does), but only by sacrificing the runtime's freedom to move map entries and by reopening the door to dangling-pointer corruption.

The trade Go settled on is "explicit but safe, with a few sharp corners." When you violate the rules, you get a *compile error* (unaddressable value) or an *immediate, well-described panic* (nil dereference) rather than silent memory corruption that surfaces hours later. The idiomatic responses — index into slices for stable addresses, return `(*T, bool)` and check the flag, store `map[K]*V` or read-modify-write — are simple, readable, and become second nature. The cost is that you must learn these patterns; the payoff is pointers you can trust in a garbage-collected, memory-safe language.

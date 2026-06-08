---
id: passing-values-vs-pointers
phase: 2
phase_title: Pointers & Memory Basics
sequence: 2
title: Passing Values vs Pointers
---

## Description

### Concept Overview

Go passes everything by value. When you call a function, every argument is *copied* into the function's parameters. This is true for integers, strings, structs, slices, maps, and even pointers. There is no "pass by reference" in Go the way C++ has it. Understanding this one rule resolves most confusion about when a function can and cannot change its caller's data.

The consequence: if you pass a value (like a struct), the function works on a copy, and any changes it makes vanish when the function returns. If you want the function to modify the caller's original data, you pass a *pointer* to it. The function still receives a copy — but a copy of the *address*, which still points at the original value. Through that address, the function can reach back and mutate the caller's data.

So "pass by pointer" is really "pass a copy of an address." That subtle framing is the key to reasoning about Go function calls correctly.

### Technical Explanation

**Passing a value copies the whole value.** Consider a struct passed by value:

```go
type Point struct{ X, Y int }

func moveBroken(p Point) {
    p.X += 10 // mutates the copy, not the caller's Point
}
```

When `moveBroken(pt)` is called, Go copies all of `pt`'s fields into the parameter `p`. The function modifies `p`, but `pt` in the caller is untouched. For a two-field struct this copy is cheap; for a struct with hundreds of fields, copying it on every call is wasteful.

**Passing a pointer copies the address.** To mutate the caller's value, pass `*Point`:

```go
func move(p *Point) {
    p.X += 10 // (*p).X += 10 — reaches the caller's Point
}
```

Now `move(&pt)` copies the *address* of `pt` into `p`. The function dereferences `p` to reach the original struct and changes it in place. After the call, `pt.X` reflects the change.

**Reference-like types still pass the header by value.** Slices, maps, and channels are special. A slice value is a small three-word *header* — a pointer to a backing array, a length, and a capacity. When you pass a slice, Go copies the header, but the copied header still points at the *same* backing array:

```go
func fill(s []int) {
    s[0] = 99 // visible to caller: same backing array
}
```

So mutating *elements* of a passed slice is visible to the caller, because both headers share the backing array. But reassigning the slice (`s = append(s, x)` that reallocates) only changes the local header copy and is *not* visible to the caller. This is a frequent source of surprise.

| Type | What gets copied | Can callee mutate caller's data? |
|------|------------------|----------------------------------|
| `int`, `bool`, `float64` | The whole value | No |
| `struct` (by value) | All fields | No |
| `*struct` (pointer) | The address | Yes, via dereference |
| `[]T` slice | The 3-word header | Element writes: yes; reslice/append-realloc: no |
| `map` | The map header (a pointer internally) | Yes, key writes are shared |
| `string` | The 2-word header (immutable) | No (strings are read-only) |

**Cost of copying.** Copying a value costs CPU time proportional to its size. A pointer is one machine word (8 bytes on a 64-bit machine). For large structs, passing a pointer avoids copying every field on every call. For small values, the copy is so cheap that a pointer offers no speed benefit and may even hurt (by forcing a heap allocation — see the escape analysis kata).

### Design Rationale

Go's "everything is passed by value" rule is deliberately simple. Compare the alternatives:

**C++** offers value parameters, pointer parameters, *and* reference parameters (`T&`). A reference parameter looks like a value in the function body but secretly aliases the caller's variable. This means you cannot tell from a call site `f(x)` whether `x` might be modified — you have to read `f`'s signature. C++ trades clarity for flexibility, and the result is a language where mutation can hide behind ordinary-looking syntax.

**Java and Python** pass object references by value (the reference is copied, the object is shared) but primitives by value. This two-rule system means `void f(int x)` cannot change the caller's int, but `void f(List l)` can mutate the caller's list — and there is no syntax at the call site to signal which is which. Beginners are perpetually confused about "is Java pass by reference?" The honest answer ("it passes references by value") is precisely Go's model, but Go makes it *visible* through explicit pointers.

Go's choice: one rule (always by value) plus explicit pointers. At the call site, `move(&pt)` *shows* you that `pt` may be modified, because you had to write `&`. A reader scanning calls can spot every potential mutation by looking for `&`. This is the same philosophy as the previous kata — Go prefers that sharing and mutation be visible in the source rather than inferred from type rules.

### Common Mistakes

**Expecting a value-receiver function to mutate the original.** Passing a struct by value and then modifying it inside the function changes only the copy. The caller sees nothing. This fails because the function never had access to the caller's variable — only to a snapshot of its fields. The fix is to pass a pointer.

**Assuming slices behave like structs.** Because slice *element* writes are visible to the caller, people conclude slices are "passed by reference" and then expect `append` to be visible too. But `append` may reallocate, replacing the local header's backing pointer without touching the caller's header. The element-write being shared and the append not being shared both follow from "the header is copied but points at a shared array." Misunderstanding this leads to lost appends.

**Passing huge structs by value in hot loops.** Copying a large struct on every call is silently expensive. The program is correct but slow, and the cost is invisible in the source. For large structs, prefer a pointer parameter to avoid repeated copying.

**Passing a pointer to a tiny value expecting a speedup.** Conversely, passing `*int` instead of `int` rarely helps and can force the value onto the heap, adding garbage-collector pressure. Tiny values should be passed by value; the copy is a single register move.

**Returning a pointer to a loop-variable copy and being surprised.** When you take `&v` of a range variable and store it, every iteration may reuse or copy the variable differently depending on Go version semantics. Misjudging what the pointer aliases produces subtle bugs. Be deliberate about *what* a pointer points at when loops are involved.

### Key Takeaways

- Go always passes arguments by value — the argument is copied into the parameter.
- To let a function modify the caller's data, pass a pointer; the function copies the *address* and mutates through it.
- Slices, maps, and channels copy a small header that shares underlying storage, so element mutations are visible but reslicing/reallocation is not.
- Pass large structs by pointer to avoid copying every field on every call.
- Pass small values (ints, small structs) by value — the copy is cheap and avoids heap pressure.
- An explicit `&` at the call site is your signal that the callee may mutate the argument.

---

## Broken Code

```go
// broken: passes a struct by value, so the mutation is lost
package main

import "fmt"

type Account struct {
    Balance int
}

// deposit takes Account by value: it works on a COPY.
func deposit(a Account, amount int) {
    a.Balance += amount // mutates the copy; caller never sees it
}

func main() {
    acc := Account{Balance: 100}
    deposit(acc, 50)

    // Expected 150, but prints 100 — the deposit was applied to a copy.
    fmt.Println("balance:", acc.Balance)
}
```

---

## Correct Code

```go
// correct: pass a pointer to mutate the caller's value; pass small values by value
package main

import "fmt"

type Account struct {
    Balance int
}

// deposit takes *Account: it can mutate the caller's Account in place.
func deposit(a *Account, amount int) {
    a.Balance += amount // (*a).Balance += amount
}

// scale takes an int by value: cheap copy, no need for a pointer.
func scale(n int, factor int) int {
    return n * factor
}

// fillFirst writes an element through a copied slice header.
// The backing array is shared, so the caller sees the change.
func fillFirst(s []int, v int) {
    if len(s) == 0 {
        return // never write past the end; that would panic
    }
    s[0] = v
}

// growLocally appends to a copied header; the caller's header is unchanged.
func growLocally(s []int) {
    _ = append(s, 999) // may reallocate; not visible to caller
}

func main() {
    acc := Account{Balance: 100}
    deposit(&acc, 50) // & makes the mutation visible at the call site
    fmt.Println("balance:", acc.Balance) // 150

    fmt.Println("scaled:", scale(7, 3)) // 21, returned by value

    nums := []int{1, 2, 3}
    fillFirst(nums, 99) // element write IS shared
    fmt.Println("after fillFirst:", nums) // [99 2 3]

    growLocally(nums) // append is NOT shared
    fmt.Println("after growLocally:", nums) // still [99 2 3]
}
```

---

## Explanation

The broken version passes `acc` to `deposit` by value. Go copies every field of `acc` into the parameter `a`, so `a.Balance += amount` increments the copy's balance and then discards the copy when the function returns. The caller's `acc.Balance` is never touched, so the program prints the original `100` instead of the expected `150`. The bug is not in the arithmetic — it is in the assumption that the function received the caller's account rather than a snapshot of it.

The correct version fixes this by changing the parameter to `*Account`. Now `deposit(&acc, 50)` copies the *address* of `acc`, and inside the function `a.Balance += amount` dereferences that address to reach the original struct. The `&` at the call site is the visible signal that `acc` may be modified. The `scale` function shows the contrasting case: an `int` is tiny, so we pass it by value and return the result — no pointer needed, no mutation intended. The slice examples make the reference-like behavior concrete: `fillFirst` writes an element through the shared backing array, so the change is visible; `growLocally` appends, which only updates the local header copy, so the caller's slice is unchanged. Both behaviors follow from the single rule that the *header* is copied while the *backing array* is shared.

---

## Design Tradeoff

Go's uniform "pass by value" rule means you trade some convenience — you must write `&` and accept the possibility of `nil` pointers — for total clarity about where mutation can happen. A reader can audit a function call and know, just from the presence or absence of `&`, whether the argument might change. Languages with hidden reference parameters give you terser call sites but force you to consult signatures to understand data flow.

The performance dimension is the second axis of the trade. Passing by value copies, which is cheap for small types and expensive for large ones; passing by pointer avoids the copy but adds an indirection and may push the value onto the heap. There is no universally correct choice — the idiomatic guideline is "pass small values by value, large values and anything you intend to mutate by pointer." Go gives you both tools and asks you to choose deliberately, rather than hiding the decision behind a single uniform reference model.

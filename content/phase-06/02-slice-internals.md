---
id: slice-internals
phase: 6
phase_title: Collections & Data Structures
sequence: 2
title: Slice Internals (Length vs Capacity)
---

## Description

### Concept Overview

A slice carries two sizes, not one: its **length** (`len`) — how many elements you can index right now — and its **capacity** (`cap`) — how many elements the backing array can hold from the slice's starting point before a new, larger backing array must be allocated. Most beginners only think about length and are blindsided when capacity quietly changes the behavior of `append`.

The distinction matters because `append` is allowed to do one of two completely different things depending on capacity. If there is **spare capacity**, `append` writes into the existing backing array in place — and any other slice sharing that array sees the change. If there is **no spare capacity**, `append` allocates a brand-new, larger backing array, copies the elements over, and returns a slice pointing at the new array — leaving the old sharers behind. Same function call, two opposite outcomes. Understanding when each happens is the difference between correct and subtly broken Go.

### Technical Explanation

**The slice header revisited.** Every slice is three machine words:

```
ptr -> first element in backing array
len -> elements addressable as s[0]..s[len-1]
cap -> elements from ptr to the end of the backing array
```

`len(s)` and `cap(s)` return these directly. Always `0 <= len <= cap`.

**Slicing controls len and cap.** The full slice expression `s[low:high:max]` produces a slice with `len = high - low` and `cap = max - low`. The two-index form `s[low:high]` sets `cap` to the end of the original backing array.

```go
s := make([]int, 0, 8) // len 0, cap 8
s = s[0:2]             // len 2, cap 8
s = s[0:2:4]           // len 2, cap 4 (capped explicitly)
```

**How append grows.** When you `append` and the result fits within `cap`, the element is written in place and `len` increases. When it does not fit, the runtime allocates a new backing array, copies the existing elements, appends the new one, and returns a header pointing at the new array. This is why **you must always reassign**: `s = append(s, x)`.

```go
s := make([]int, 0, 2) // cap 2
s = append(s, 1)       // len 1, cap 2 — in place
s = append(s, 2)       // len 2, cap 2 — in place, now full
s = append(s, 3)       // len 3, cap 4 — REALLOCATED, copied, new array
```

**Growth strategy.** Go's runtime grows capacity geometrically. For small slices it roughly **doubles**; for large slices the growth factor tapers toward ~1.25x to avoid wasting memory. The exact numbers are an implementation detail and have changed across Go versions — never rely on a specific capacity, only on the amortized O(1) cost of append.

| Operation | len | cap | Reallocated? |
|-----------|-----|-----|--------------|
| `make([]int, 0, 4)` | 0 | 4 | — |
| `append` x4 | 4 | 4 | no (fits) |
| `append` (5th) | 5 | 8 | yes (doubled) |
| `s[1:3]` | 2 | 7 | no (view) |

**Aliasing during in-place append.** If two slices share a backing array and one appends within capacity, it overwrites elements the other can still see:

```go
base := make([]int, 2, 4) // [0 0], cap 4
a := base
b := append(a, 99) // writes index 2 in the shared array
// a still len 2, but the shared backing array now has 99 at index 2
```

### Design Rationale

In **C++**, `std::vector` hides exactly this machinery — `size()` and `capacity()` exist, and `push_back` may reallocate and invalidate iterators. Go exposes the same concepts but forces you to reassign the slice header yourself (`s = append(...)`), making reallocation impossible to ignore. C++ invalidates pointers silently on reallocation; Go simply hands you a new header and lets the old one keep pointing at the old array — no dangling, just two views that diverged.

In **Java**, `ArrayList` has an internal capacity and `ensureCapacity`, but you never see the backing array, so aliasing surprises cannot occur — at the cost of never being able to take cheap sub-views. Go trades that safety for the power of zero-copy slicing.

In **Python**, `list` over-allocates internally and grows amortized, just like Go, but slicing (`lst[1:3]`) always **copies**. Go's slicing never copies — `s[1:3]` is a view sharing storage. That is faster and more flexible, but it is precisely why Go programmers must understand capacity and aliasing while Python programmers can stay blissfully unaware.

Go's choice — expose `len` and `cap`, make `append` return a value, allow zero-copy sub-slicing — is a deliberate bet that performance-aware, explicit code beats convenient-but-hidden behavior.

### Common Mistakes

**Forgetting to reassign the result of append.** Writing `append(s, x)` without `s =` is almost always a bug. If a reallocation happened, your new element is in an array you just threw away. The compiler does not stop you because the return value is technically usable. Always write `s = append(s, x)`.

**Assuming append never affects other slices.** When capacity is available, `append` writes in place into the shared backing array, corrupting data visible through other slices. This bites people who slice a buffer and append to the sub-slice. Use the three-index slice (`s[low:high:high]`) to cap capacity and force the next append to reallocate.

**Pre-sizing with make's length instead of capacity.** `make([]int, 10)` creates a slice of **length** 10 (ten zeros), not an empty slice with room for ten. If you then `append`, you add an 11th element after the zeros. To pre-allocate capacity, use `make([]T, 0, 10)`.

**Expecting a sub-slice's cap to stop at the high index.** `s[1:3]` has `len 2` but `cap` running to the end of the backing array, not to index 3. A later append into that sub-slice can overwrite elements beyond index 3. Use `s[1:3:3]` when you want capacity to stop where length does.

**Relying on a specific growth factor.** Code that assumes append doubles capacity will break on large slices or future Go versions. Treat the exact capacity after growth as unspecified.

### Key Takeaways

- A slice has both `len` (addressable elements) and `cap` (backing-array room).
- `append` writes in place when there is spare cap; otherwise it reallocates and copies.
- Always reassign: `s = append(s, x)` — the returned header may point at a new array.
- In-place append into a shared backing array mutates other slices that alias it.
- `make([]T, n)` sets length n; use `make([]T, 0, n)` to reserve capacity.
- Use the three-index slice `s[lo:hi:hi]` to cap capacity and prevent aliasing surprises.

---

## Broken Code

```go
// broken: ignores capacity, so append silently corrupts an aliased slice
package main

import "fmt"

func main() {
	// Reserve capacity 5 but length 3.
	buffer := make([]int, 3, 5) // [0 0 0], cap 5
	buffer[0], buffer[1], buffer[2] = 1, 2, 3

	// Take a view of the first two elements.
	view := buffer[0:2] // len 2, cap 5 (NOT capped!)

	// We THINK appending to view is independent of buffer.
	// But view has spare capacity, so append writes into the SHARED
	// backing array at index 2 — clobbering buffer[2].
	view = append(view, 999)

	fmt.Println("view:  ", view)   // [1 2 999]
	fmt.Println("buffer:", buffer) // [1 2 999] — corrupted! expected [1 2 3]

	// Also broken: forgetting to reassign loses the appended element.
	more := make([]int, 0, 1)
	append(more, 42) // result discarded; if it reallocated, 42 is gone
	fmt.Println("more:", more) // []
}
```

---

## Correct Code

```go
// correct: respect capacity, cap sub-slices, and always reassign append
package main

import "fmt"

func main() {
	buffer := make([]int, 3, 5)
	buffer[0], buffer[1], buffer[2] = 1, 2, 3
	fmt.Printf("buffer: %v  len=%d cap=%d\n", buffer, len(buffer), cap(buffer))

	// Three-index slice caps capacity at the length, so any append on the
	// view is forced to reallocate instead of overwriting buffer.
	view := buffer[0:2:2] // len 2, cap 2
	fmt.Printf("view:   %v  len=%d cap=%d\n", view, len(view), cap(view))

	view = append(view, 999) // cap full -> reallocates, copies, new array
	fmt.Println("after append on capped view:")
	fmt.Println("  view:  ", view)   // [1 2 999]
	fmt.Println("  buffer:", buffer) // [1 2 3] — safe, untouched

	// Always reassign the result of append.
	nums := make([]int, 0, 2)
	for i := 1; i <= 5; i++ {
		before := cap(nums)
		nums = append(nums, i)
		if cap(nums) != before {
			fmt.Printf("grew at len %d: cap %d -> %d\n", len(nums)-1, before, cap(nums))
		}
	}
	fmt.Println("nums:", nums) // [1 2 3 4 5]
}
```

---

## Explanation

The broken version creates `buffer` with length 3 and capacity 5, then takes `view := buffer[0:2]`. The crucial detail is that the two-index slice expression sets the view's capacity to the end of the backing array — `cap(view)` is 5, not 2. So when we `append(view, 999)`, there is spare capacity, and `append` writes 999 directly into index 2 of the **shared** backing array. That index is `buffer[2]`, which silently changes from 3 to 999. The two slices were never independent. The second bug — `append(more, 42)` with no reassignment — discards the returned header, so if a reallocation occurred, the element is lost in an orphaned array.

The correct version fixes both. Using the three-index expression `buffer[0:2:2]` caps the view's capacity at 2. Now the view is full, so appending forces `append` to allocate a fresh backing array and copy the elements, leaving `buffer` completely untouched. The output confirms `buffer` stays `[1 2 3]`. And every append reassigns its result (`nums = append(nums, i)`), so growth is handled correctly; the loop even prints when a reallocation occurs to make capacity growth visible.

The key mental model: a slice is a window onto a backing array, and `len` versus `cap` tells you how far that window can stretch before the array must be reallocated. Capping capacity is how you turn an aliased view into a safe, independent one.

---

## Design Tradeoff

Go deliberately exposes capacity and makes `append` return a (possibly new) header rather than mutating in place invisibly. This puts a real cognitive burden on the programmer: you must understand that the same `append` call can either mutate shared storage or fork off a private copy, depending on a number you might not be tracking. Languages like Java's `ArrayList` hide all of this, and Python's slicing always copies, so their users rarely think about it.

The reward for that burden is performance you can reason about and control. Zero-copy sub-slicing makes parsing, buffering, and streaming dramatically cheaper than the copy-on-slice model. Amortized-O(1) append with a visible growth strategy lets you pre-size with `make([]T, 0, n)` to eliminate reallocations on hot paths. And the three-index slice gives you a precise tool to opt back into safety when sharing would be dangerous. Go's bet is that systems programmers want this control more than they want the convenience of a fully hidden growable list — and once you understand len versus cap, that control is exactly what you get.

---
id: arrays-vs-slices
phase: 6
phase_title: Collections & Data Structures
sequence: 1
title: Arrays vs Slices
---

## Description

### Concept Overview

Go has two distinct sequence types that beginners constantly confuse: **arrays** and **slices**. They look almost identical in source code — both use `[]` syntax — but they behave completely differently. An array has a **fixed length that is part of its type**. A slice has a **dynamic length backed by an array you do not directly see**. Understanding the difference is the foundation of everything else in this phase.

An array is a value. When you assign it or pass it to a function, the entire array is **copied**. A slice is a small descriptor — a header — that *points* to an underlying array. When you pass a slice, you copy the header, but both copies still point to the same backing data. This single fact is the source of most slice surprises and most slice power.

In practice, you will almost never declare arrays directly in everyday Go. Slices are the workhorse. But arrays exist underneath every slice, and knowing they are there explains why slices behave the way they do.

### Technical Explanation

**An array's length is part of its type.** `[3]int` and `[4]int` are different, incompatible types. You cannot assign one to the other, and a function expecting `[3]int` will not accept `[4]int`.

```go
var a [3]int        // array of exactly 3 ints, all zero: [0 0 0]
b := [3]int{1, 2, 3}
c := [...]int{4, 5}  // compiler counts elements: type is [2]int
```

Because the length is in the type, the compiler knows the exact size at compile time, and the array is allocated inline — there is no separate heap allocation and no pointer indirection.

**A slice is a three-word header.** Internally, every slice value is a small struct of exactly three fields:

```
slice header:
  ptr  -> pointer to the first element in a backing array
  len  -> number of elements currently in the slice
  cap  -> number of elements available in the backing array from ptr onward
```

A slice literal `[]int{1, 2, 3}` creates a backing array and returns a header pointing at it. The `make` function creates a slice with a chosen length and capacity:

```go
s := make([]int, 3)      // len 3, cap 3, backed by a fresh [3]int
s := make([]int, 3, 10)  // len 3, cap 10, backed by a fresh [10]int
```

**Copy semantics differ fundamentally.** Assigning an array copies every element. Assigning a slice copies only the three-word header — both headers point at the same backing array.

```go
arr := [3]int{1, 2, 3}
arr2 := arr        // full copy: arr2 is independent
arr2[0] = 99       // arr is still {1, 2, 3}

sl := []int{1, 2, 3}
sl2 := sl          // header copy: same backing array
sl2[0] = 99        // sl is now {99, 2, 3} — shared!
```

**Slicing an array or slice produces a new header** over the same backing array. `s[1:3]` gives a slice whose `ptr` is offset to index 1, `len` is 2, and `cap` extends to the end of the original backing array. No data is copied.

| Property | Array `[N]T` | Slice `[]T` |
|----------|--------------|-------------|
| Length in type? | Yes | No |
| Fixed size? | Yes | Grows via `append` |
| Assignment/pass | Copies all elements | Copies 3-word header |
| Backing storage | Inline | Separate backing array |
| Zero value | All-zero array | `nil` (ptr=nil, len=0, cap=0) |
| Comparable with `==`? | Yes (if elements are) | No (only against `nil`) |

### Design Rationale

In **C**, an array decays to a pointer the moment you pass it to a function — you lose the length entirely and must pass it as a separate argument. This is the root cause of countless buffer overflows. Go fixes this by making the slice carry its own length and capacity, so the size travels with the data.

In **C++**, `std::array<T, N>` is the fixed-size value type and `std::vector<T>` is the growable heap-backed type — almost exactly mirroring Go's array vs slice split. But C++ hides the vector's growth behind operator overloading and copy constructors. Go keeps the slice header visible and explicit: three words, no hidden machinery, and you must call `append` deliberately.

In **Java**, arrays are objects with a fixed length and an `.length` field, while growth requires `ArrayList`. Java arrays are always reference types — assignment never copies. Go's arrays being **value types** is the surprising part for Java and Python programmers.

In **Python**, `list` is the only sequence most people use, and it is always a reference. Python has no value-type array equivalent in everyday code. Go's deliberate split forces you to decide: do I want copy-on-assign semantics (array) or shared-backing semantics (slice)? That explicitness is the Go philosophy — make the cost and the sharing visible.

### Common Mistakes

**Thinking `[N]T` and `[]T` are the same type.** A function with signature `func sum(a [3]int)` only accepts arrays of exactly length 3. Passing `[4]int` or a slice is a compile error. Beginners write fixed-size array parameters and then cannot understand why their data does not fit. The fix: use `[]T` slice parameters for flexible APIs.

**Accidentally copying a large array.** Because arrays are values, `func process(data [100000]int)` copies 800 KB on every call. This is silent and slow. If you genuinely need an array, pass a pointer `*[100000]int` or, far more idiomatically, use a slice.

**Mutating a slice and being surprised the "original" changed.** Since slices share backing arrays, `s2 := s; s2[0] = 99` modifies `s` too. People coming from Python's `list.copy()` mindset expect independence. In Go, you must explicitly `copy()` into a fresh slice to decouple them.

**Comparing slices with `==`.** Arrays are comparable element-by-element with `==`, but slices are not. `s1 == s2` is a compile error (you can only compare a slice to `nil`). Beginners expect value equality and get a compiler rejection. Use `slices.Equal` from the standard library instead.

**Assuming the zero-value slice is unusable.** A `nil` slice has `len 0` and `cap 0`, but it is perfectly valid to `range` over and to `append` to. Unlike a `nil` map, a `nil` slice is not a trap.

### Key Takeaways

- An array's length is part of its type; `[3]int` and `[4]int` are different types.
- Arrays are values: assigning or passing them copies every element.
- A slice is a three-word header (`ptr`, `len`, `cap`) pointing at a backing array.
- Assigning or passing a slice copies only the header, so copies share backing data.
- Slices are not comparable with `==` (except to `nil`); use `slices.Equal`.
- Reach for slices by default; arrays are for fixed-size, copy-semantics needs.

---

## Broken Code

```go
// broken: confuses array value-copy semantics with slice sharing,
// and tries to compare slices with ==
package main

import "fmt"

// This only accepts arrays of EXACTLY length 3 — inflexible.
func doubleAll(nums [3]int) {
    for i := range nums {
        nums[i] *= 2 // mutates a COPY; caller never sees the change
    }
}

func main() {
    data := [3]int{1, 2, 3}
    doubleAll(data)
    fmt.Println(data) // surprise: still [1 2 3], the copy was discarded

    // Tries to pass a 4-element array — compile error: wrong type.
    more := [4]int{1, 2, 3, 4}
    doubleAll(more)

    // Tries to compare slices with == — compile error.
    a := []int{1, 2}
    b := []int{1, 2}
    if a == b {
        fmt.Println("equal")
    }
}
```

---

## Correct Code

```go
// correct: use slices for flexible, shared-backing APIs and
// compare them with slices.Equal
package main

import (
	"fmt"
	"slices"
)

// Accepts a slice of any length. Because a slice shares its backing
// array, mutations here are visible to the caller.
func doubleAll(nums []int) {
	for i := range nums {
		nums[i] *= 2
	}
}

func main() {
	// Arrays are values: copying gives an independent array.
	arr := [3]int{1, 2, 3}
	arrCopy := arr
	arrCopy[0] = 99
	fmt.Println("array original:", arr)     // [1 2 3] — unchanged
	fmt.Println("array copy:    ", arrCopy) // [99 2 3]

	// Slices share backing storage: the function mutates the caller's data.
	data := []int{1, 2, 3, 4}
	doubleAll(data)
	fmt.Println("slice after doubleAll:", data) // [2 4 6 8]

	// A slice of a different length works with the same function.
	short := []int{10}
	doubleAll(short)
	fmt.Println("short after doubleAll:", short) // [20]

	// Slices are not comparable with ==; use slices.Equal for value equality.
	a := []int{1, 2, 3}
	b := []int{1, 2, 3}
	fmt.Println("slices.Equal(a, b):", slices.Equal(a, b)) // true

	// Arrays ARE comparable with == when their elements are comparable.
	x := [2]int{1, 2}
	y := [2]int{1, 2}
	fmt.Println("array x == y:", x == y) // true
}
```

---

## Explanation

The broken version makes two classic errors. First, `doubleAll(nums [3]int)` takes an **array** parameter. Because arrays are values, the function receives a full copy; doubling the elements inside mutates only that copy, and the caller's `data` is untouched. Worse, the signature locks the function to exactly three elements, so passing a `[4]int` is a compile error — arrays of different lengths are different types. Second, comparing two slices with `a == b` does not compile at all, because slices are not comparable except against `nil`.

The correct version switches the parameter to `[]int`, a slice. Now the function accepts any length, and because the slice header points at the caller's backing array, the mutation is visible after the call returns — exactly what we intended. This is the everyday Go pattern: flexible APIs take slices, not fixed arrays.

The correct version also shows the contrasting copy behavior side by side. Copying the array `arr` produces a genuinely independent `arrCopy`, so changing one does not affect the other. For equality, we use `slices.Equal` for slices and the built-in `==` for arrays, which is legal because `int` elements are comparable. Seeing both behaviors together makes the value-vs-reference distinction concrete.

---

## Design Tradeoff

Go could have made all sequences reference types (like Java and Python lists) to avoid the surprise of expensive array copies, or made them all value types to avoid the surprise of shared-backing mutation. Instead it kept both and made the choice explicit in your type declaration. The cost is a learning curve: you must internalize that `[N]T` copies and `[]T` shares.

The payoff is control with no hidden machinery. When you want independent data with cheap, predictable copy semantics and a compile-time-known size, you reach for an array. When you want a growable, shareable, length-carrying view over data, you reach for a slice — which is the overwhelmingly common case. Neither hides allocation or copying behind operator overloads, so the reader of your code can always see exactly what will happen. That visibility, even at the price of two similar-looking types, is the Go bargain.

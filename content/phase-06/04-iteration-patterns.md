---
id: iteration-patterns
phase: 6
phase_title: Collections & Data Structures
sequence: 4
title: Iteration Patterns
---

## Description

### Concept Overview

Go has exactly one loop keyword — `for` — but the `range` clause gives it several distinct iteration modes over slices, arrays, strings, maps, and channels. The unifying rule that catches almost everyone is this: **`range` copies the value of each element into the loop variable**. You are not iterating over the elements themselves; you are iterating over *copies* of them. Mutating the loop variable changes the copy, not the collection.

This copy semantics, combined with two-result destructuring (`index, value` or `key, value`), defines the idioms you will use constantly. Get them right and your loops are clear and correct. Get them wrong — by mutating the copy, by taking the address of the loop variable, or by misreading how strings decode into runes — and you write bugs that compile cleanly and fail silently.

### Technical Explanation

**Ranging a slice or array yields index and a copy of the element.**

```go
for i, v := range nums {
    // i is the index; v is a COPY of nums[i]
}
```

To mutate the underlying collection, index it directly — do not assign to `v`:

```go
for i := range nums {
    nums[i] *= 2 // correct: writes into the slice
}
```

**Ranging a map yields key and a copy of the value, in randomized order:**

```go
for k, v := range m {
    // k is the key, v is a copy of the value; order is random
}
```

**Ranging a string yields byte-offset and a rune, decoding UTF-8:**

```go
for i, r := range "héllo" {
    // i is the BYTE offset (not the character count)
    // r is a rune (Unicode code point), not a byte
}
```

This is critical: a Go string is a sequence of bytes, but `range` decodes UTF-8 into runes. The index `i` jumps by the number of bytes each rune occupies (1 for ASCII, 2–4 for multibyte characters), so indices are not consecutive for non-ASCII text. Indexing a string with `s[i]` instead gives a single **byte**, not a rune.

**You can drop results you do not need:**

```go
for _, v := range nums { } // value only
for i := range nums      { } // index only
for range nums           { } // neither — just iterate len(nums) times
```

**Channels range until closed:**

```go
for v := range ch {
    // receives values until ch is closed and drained
}
```

**Range expressions are evaluated once.** `for i := range s` evaluates `len(s)` a single time at loop start (for slices/arrays), so appending to the slice inside the loop does not extend the iteration.

**The loop-variable scope (Go 1.22+).** Since Go 1.22, the loop variable is a **fresh variable each iteration**, so capturing it in a closure or goroutine captures that iteration's value. In Go 1.21 and earlier, the same variable was reused across iterations — a famous source of bugs where every captured closure saw the final value.

| Range over | First result | Second result |
|------------|--------------|---------------|
| `[]T` / `[N]T` | index `int` | copy of element |
| `map[K]V` | key (copy) | value (copy) |
| `string` | byte offset | rune (decoded) |
| channel `chan T` | received value | — |
| integer `n` (1.22+) | values `0..n-1` | — |

### Design Rationale

In **C**, you write three-part index loops by hand and own every off-by-one error. Go's `range` removes the manual bookkeeping for the common case while still allowing the classic `for i := 0; i < n; i++` form when you need it.

In **Java**, the enhanced for-each (`for (T x : coll)`) also gives you a copy of the reference/value and forbids structural modification during iteration (throwing `ConcurrentModificationException`). Go is laxer — it lets you mutate during iteration with defined-but-careful semantics — but shares the "you get a copy" model.

In **Python**, iterating a list yields the elements themselves (references), so `for x in lst: x.append(...)` mutates the real objects, and iterating a string yields one-character strings, hiding the bytes-vs-codepoints distinction entirely. Go is more explicit and more honest about cost: the loop variable is a value copy, and a string's dual nature as bytes-or-runes is exposed, because Go refuses to pretend that text is free of encoding.

The decision to make `range` over strings decode runes (rather than yield bytes) reflects Go's UTF-8-everywhere design — the language was co-designed by the creators of UTF-8, and string iteration is built to do the right thing for Unicode text by default while still letting you drop to bytes when you mean bytes.

### Common Mistakes

**Mutating the loop value expecting the collection to change.** `for _, v := range nums { v *= 2 }` does nothing to `nums` — `v` is a copy. The fix is index assignment: `for i := range nums { nums[i] *= 2 }`. This is the single most common range mistake.

**Taking the address of the loop variable across iterations (pre-1.22).** In Go 1.21 and earlier, `&v` inside the loop returns the address of the one reused variable, so a slice of such pointers ends up all pointing at the final element. Go 1.22 fixed the scoping, but code targeting older versions must copy the variable (`v := v`) first.

**Treating the string range index as a character count.** For non-ASCII strings the byte offset skips ahead by the rune's byte width, so indices are not `0,1,2,...`. Counting characters by reading the last index is wrong; use `utf8.RuneCountInString` or count runes explicitly.

**Indexing a string and expecting a rune.** `s[i]` is a `byte` (`uint8`), not a rune. Printing it with `%c` works for ASCII but mangles multibyte characters. Range, or convert to `[]rune`, to work in code points.

**Appending to the slice you are ranging and expecting the loop to grow.** The range length is fixed at the start, so new elements are not visited. If you truly need to process appended items, use an index loop that re-reads `len` each iteration.

### Key Takeaways

- `range` gives you a *copy* of each element/value — mutate via the index, not the loop variable.
- Slice/array range yields index + element copy; map range yields key + value copy in random order.
- String range decodes UTF-8: the index is a byte offset and the value is a rune.
- `s[i]` indexes a single byte; ranging or `[]rune(s)` works in runes.
- Drop unneeded results with `_`, or use `for range x {}` to iterate without binding.
- Go 1.22+ gives a fresh loop variable per iteration, fixing closure/goroutine capture bugs.

---

## Broken Code

```go
// broken: mutates loop-variable copies and misreads string bytes vs runes
package main

import "fmt"

func main() {
	nums := []int{1, 2, 3, 4}

	// Bug: v is a COPY; doubling it does nothing to nums.
	for _, v := range nums {
		v *= 2
	}
	fmt.Println("nums:", nums) // [1 2 3 4] — unchanged, not [2 4 6 8]

	// Bug: indexing a string yields a byte, and the loop assumes
	// one byte == one character. For "héllo" the 'é' is two bytes,
	// so this prints garbage and the wrong length.
	s := "héllo"
	for i := 0; i < len(s); i++ {
		fmt.Printf("%c", s[i]) // mangles the multibyte rune
	}
	fmt.Println()
	fmt.Println("characters:", len(s)) // 6 bytes, but only 5 characters
}
```

---

## Correct Code

```go
// correct: mutate via index, and range strings to decode runes
package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	nums := []int{1, 2, 3, 4}

	// Mutate through the index, not the loop-variable copy.
	for i := range nums {
		nums[i] *= 2
	}
	fmt.Println("nums:", nums) // [2 4 6 8]

	// Reading copies is fine when you only need the value.
	total := 0
	for _, v := range nums {
		total += v
	}
	fmt.Println("total:", total) // 20

	// Range over a string decodes UTF-8 into runes; i is a byte offset.
	s := "héllo"
	for i, r := range s {
		fmt.Printf("byte %d: %c (U+%04X)\n", i, r, r)
	}

	// Count characters correctly with rune counting, not len (which is bytes).
	fmt.Println("bytes:     ", len(s))                    // 6
	fmt.Println("characters:", utf8.RuneCountInString(s)) // 5

	// Drop the value to iterate by index only; drop both to just count.
	count := 0
	for range nums {
		count++
	}
	fmt.Println("iterations:", count) // 4
}
```

---

## Explanation

The broken version makes the two iteration errors that catch nearly every Go newcomer. First, `for _, v := range nums { v *= 2 }` operates on `v`, which is a fresh copy of each element. Doubling the copy leaves `nums` exactly as it was — the output is still `[1 2 3 4]`. Second, it iterates the string with a manual byte index and prints `s[i]`, which is a single **byte**. For `"héllo"` the `é` occupies two bytes, so byte-by-byte printing splits it into two invalid fragments, and `len(s)` reports 6 bytes even though the word has 5 characters.

The correct version fixes the slice mutation by ranging over the index alone and writing back through `nums[i]`, which addresses the real backing array and produces `[2 4 6 8]`. When the goal is merely to read — summing the values — taking the copy with `for _, v := range nums` is perfectly fine and idiomatic. For the string, ranging with `for i, r := range s` lets Go decode UTF-8 for us: `r` is a `rune` (a full Unicode code point) and `i` is the byte offset where that rune begins, which is why the offsets jump by two across the `é`. To count characters rather than bytes, it uses `utf8.RuneCountInString`, the correct tool, instead of `len`.

The example also shows the result-dropping forms — `for range nums {}` to iterate purely for its side effects — rounding out the everyday range idioms: mutate by index, read by copy, and treat strings as runes when you mean characters.

---

## Design Tradeoff

Making `range` hand you a copy of each element is a small, deliberate inefficiency in service of clarity and safety: the loop variable is yours to scribble on without ever accidentally corrupting the collection, and the cost (a value copy) is visible and usually trivial. The price is that mutation must go through the index, which beginners forget — but the alternative, giving you a mutable alias by default, would make every loop a potential source of aliasing bugs. Go chose the safer default and made you opt into mutation explicitly.

The string-iteration choice is the other notable trade. By decoding runes during `range` while keeping `s[i]` as raw byte access, Go refuses to hide the fact that text is encoded. Python papers over this by yielding one-character strings; Go makes you confront that a string is bytes and a character is a rune. That is more to learn, but it means correct Unicode handling is the natural default and byte-level work is available when you genuinely need performance or protocol fidelity. As with the rest of Go's collection design, the language prefers an explicit cost you can see over a convenient abstraction that lies about what is happening.

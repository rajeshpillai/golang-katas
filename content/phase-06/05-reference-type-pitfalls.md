---
id: reference-type-pitfalls
phase: 6
phase_title: Collections & Data Structures
sequence: 5
title: Common Pitfalls with Reference Types
---

## Description

### Concept Overview

Slices, maps, and channels are Go's **reference types**: their values are small headers that point at shared underlying data. This is what makes them cheap to pass around — you copy a few machine words, not the whole collection. But it is also the root of the most persistent class of bugs in Go: you *think* you have an independent copy when in fact you have a second handle on the same data. A mutation through one handle is visible through the other, often far from where the alias was created.

This kata consolidates the sharp edges from the whole phase into one place. The pattern is always the same — "I copied it, so changing one should not affect the other" — and it is wrong for reference types unless you deliberately make a deep copy. Recognizing when you are aliasing versus copying is the skill that separates correct Go from code that works in tests and corrupts data in production.

### Technical Explanation

**Assigning or passing a reference type copies the header, not the data.**

```go
a := []int{1, 2, 3}
b := a       // b shares a's backing array
b[0] = 99    // a[0] is now 99 too

m := map[string]int{"x": 1}
n := m       // n shares m's hash table
n["x"] = 99  // m["x"] is now 99 too
```

**Slicing shares storage.** `sub := s[1:3]` is a view, not a copy. Writing `sub[0] = 9` writes into `s[1]`. To break the sharing, copy into a fresh slice:

```go
sub := make([]int, 2)
copy(sub, s[1:3]) // independent copy of those two elements
```

**`append` aliasing.** If a slice has spare capacity, `append` writes in place into the shared backing array, mutating other slices that view it. This is the slip from the slice-internals kata, repeated here because it is the most common reference-type bug:

```go
base := make([]int, 2, 4)
view := append(base[:1], 7) // writes base[1] = 7 in place
```

**Holding a sub-slice keeps the whole backing array alive.** If you slice a tiny window out of a huge slice and keep it, the garbage collector cannot free the large backing array, because your view still points into it. Copy the window out to release the rest.

**Range over reference values gives copies, but the copies still alias inner reference data.** Ranging a `[]struct{ Tags []string }` gives you a copy of each struct, but the copy's `Tags` slice header still points at the same backing array as the original — so mutating `Tags` elements is shared, while mutating non-slice fields of the copy is not.

**Maps and channels are always shared.** There is no value-copy of a map or channel; assigning them always shares. The only way to copy a map's contents is to iterate and insert into a fresh `make`d map.

| Type | Copy of value shares… | How to truly copy |
|------|----------------------|-------------------|
| `[]T` slice | backing array | `make` + `copy`, or `slices.Clone` |
| `map[K]V` | backing hash table | new map + range-insert, or `maps.Clone` |
| `chan T` | the same channel | (channels are not "copied"; create a new one) |
| `*T` pointer | the pointee | dereference and copy the value |

**Nested reference types need deep copies.** `slices.Clone` and `maps.Clone` are **shallow**: they copy the top level but the inner slices/maps/pointers are still shared. A struct with a slice field needs explicit per-field copying to fully decouple.

### Design Rationale

In **Java** and **Python**, every container is a reference, and copying is always explicit (`new ArrayList<>(other)`, `list.copy()`, `dict.copy()`) — so the alias-by-default behavior is the norm and programmers are conditioned to it. Go is more nuanced: structs, arrays, and basic types copy by value, but slices, maps, and channels are references. This *mixed* model is exactly why Go developers get caught — the same `:=` that gives an independent copy of a struct gives a shared handle to a slice. The rule "reference types share, value types copy" must be learned, not assumed.

In **C++**, value semantics are the default and you opt into sharing with pointers, references, or smart pointers; copying a `std::vector` deep-copies its contents. Go reverses this for its built-in containers to keep passing them cheap, accepting the aliasing risk as the cost of avoiding implicit deep copies on every function call.

Go's designers chose cheap-by-default sharing because the alternative — deep-copying slices and maps on every assignment and call — would be a silent performance disaster, exactly the kind of hidden cost Go works to avoid. The trade is that *correctness* now requires you to copy explicitly when you want independence. Go provides the tools to do so clearly (`copy`, `slices.Clone`, `maps.Clone`), keeping the deep-copy cost visible at the call site rather than buried in the assignment operator.

### Common Mistakes

**Assuming assignment of a slice or map gives an independent copy.** `b := a` for a slice or map shares storage; later writes through `b` corrupt `a`. This is the canonical reference-type bug. Use `slices.Clone`/`maps.Clone` (shallow) or a manual deep copy when you need independence.

**Returning a sub-slice of an internal buffer.** A method that returns `b.buf[start:end]` hands the caller a window into the receiver's private backing array; the caller can mutate your internals, and a later `append` by either side may collide. Return a copied slice to keep encapsulation.

**Appending to a slice received as a parameter.** Because `append` may write in place, appending to a caller-provided slice can clobber elements the caller still relies on, or — worse — the change may or may not be visible depending on capacity, making behavior non-deterministic. Document ownership, or copy before appending.

**Memory leak from retaining a small sub-slice of a huge slice.** Keeping `huge[:1]` pins the entire `huge` backing array in memory. Copy the needed elements out with `slices.Clone(huge[:1])` so the large array can be collected.

**Shallow-cloning a struct with reference-type fields.** `clone := original` (or `slices.Clone` of a slice of structs) copies slice/map fields by header, so the clone and original still share that inner data. Mutating the inner slice of one mutates both. Deep-copy each reference field explicitly.

### Key Takeaways

- Slices, maps, and channels are reference types: copying the value shares the underlying data.
- Value types (structs, arrays, numbers) copy independently; mixing the two models is the trap.
- Slicing and in-place `append` share backing arrays — write through one, see it in the other.
- Use `copy`, `slices.Clone`, or `maps.Clone` to make a real copy when you need independence.
- `Clone` helpers are shallow; nested reference fields require explicit deep copying.
- Returning or retaining a sub-slice can leak the whole backing array and break encapsulation.

---

## Broken Code

```go
// broken: returns a shared sub-slice and shallow-copies a struct with a
// slice field, so callers can corrupt internal state through the alias
package main

import "fmt"

type Inventory struct {
	items []string
}

// Bug: returns a view into the internal slice. The caller can mutate
// inventory.items through this aliased return value.
func (inv *Inventory) Items() []string {
	return inv.items
}

func main() {
	inv := &Inventory{items: []string{"sword", "shield", "potion"}}

	got := inv.Items()
	got[0] = "HACKED" // mutates inv.items through the shared header
	fmt.Println("internal items:", inv.items) // [HACKED shield potion]

	// Bug: "copying" a slice with assignment shares the backing array.
	original := []int{1, 2, 3}
	backup := original
	original[0] = 999
	fmt.Println("backup:", backup) // [999 2 3] — not a real backup!
}
```

---

## Correct Code

```go
// correct: hand out independent copies so callers cannot corrupt internals
package main

import (
	"fmt"
	"slices"
)

type Inventory struct {
	items []string
}

// Return a clone so callers get an independent slice.
func (inv *Inventory) Items() []string {
	return slices.Clone(inv.items)
}

func main() {
	inv := &Inventory{items: []string{"sword", "shield", "potion"}}

	got := inv.Items()
	got[0] = "HACKED" // mutates only the caller's copy
	fmt.Println("internal items:", inv.items) // [sword shield potion] — safe
	fmt.Println("caller's copy: ", got)        // [HACKED shield potion]

	// A real backup needs an explicit copy.
	original := []int{1, 2, 3}
	backup := slices.Clone(original)
	original[0] = 999
	fmt.Println("original:", original) // [999 2 3]
	fmt.Println("backup:  ", backup)   // [1 2 3] — independent

	// Manual copy with make + copy works identically and shows the cost.
	src := []int{4, 5, 6, 7}
	dst := make([]int, len(src))
	copy(dst, src)
	dst[0] = 0
	fmt.Println("src:", src) // [4 5 6 7] — untouched
	fmt.Println("dst:", dst) // [0 5 6 7]

	// Avoid leaking a huge backing array: clone the small window you keep.
	huge := make([]int, 1_000_000)
	huge[0] = 42
	keep := slices.Clone(huge[:1]) // releases the million-element array
	fmt.Println("kept:", keep)     // [42]
}
```

---

## Explanation

The broken version exposes two faces of the same bug. The `Items()` method returns `inv.items` directly, which is just the slice header — the caller now holds a second handle on the inventory's private backing array. Writing `got[0] = "HACKED"` reaches straight through that alias and rewrites the struct's internal state, breaking encapsulation entirely. The second case is the everyday version: `backup := original` does not back anything up, because both names share one backing array, so mutating `original` also changes `backup`. The word "copy" in the programmer's head does not match what `:=` actually did.

The correct version makes independence explicit. `Items()` returns `slices.Clone(inv.items)`, so the caller receives a fresh slice with its own backing array; mutating it leaves the inventory untouched. For a genuine backup, `slices.Clone(original)` produces independent data. The example also shows the lower-level `make` + `copy` idiom that `slices.Clone` is built on, making the allocation and copy cost visible. Finally it demonstrates the memory-retention pitfall: slicing `huge[:1]` would otherwise pin the entire million-element array alive, so cloning the one-element window lets the garbage collector reclaim the rest.

The throughline is a single decision you must make consciously for every reference type: do I want to share this data or own an independent copy of it? Go will not decide for you. When you want sharing, assignment is cheap and correct; when you want independence, you must say so with `copy`, `slices.Clone`, or `maps.Clone`.

---

## Design Tradeoff

Go's reference types share by default because deep-copying every slice and map on assignment and on every function call would impose a large, invisible performance tax — precisely the kind of hidden cost the language is built to avoid. Passing a slice to a function is meant to be three words on the stack, not a duplication of potentially megabytes of data. That cheapness is a genuine, everyday benefit: it is why Go programs can stream and process large collections without ceremony.

The cost of that choice lands on correctness. Because sharing is the default, *independence* is the thing you must request explicitly, and forgetting to request it produces aliasing bugs that hide until two parts of the program mutate the same data at different times. Go mitigates this not by changing the default but by making the copy operation clear and local: `slices.Clone`, `maps.Clone`, and `copy` put the cost of independence right where you ask for it, visible to the reader. The remaining trap — that these clones are shallow — is the same trade one level down: Go gives you a cheap top-level copy and lets you decide, field by field, how deep you actually need to go. As everywhere in Go's collection design, the language prefers an explicit, visible cost over a convenient default that quietly does too much.

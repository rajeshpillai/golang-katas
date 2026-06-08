---
id: maps-and-zero-values
phase: 6
phase_title: Collections & Data Structures
sequence: 3
title: Maps and Zero Values
---

## Description

### Concept Overview

A map is Go's built-in hash table — an unordered collection of key/value pairs with average O(1) lookup, insertion, and deletion. Maps are central to almost every real Go program: counting things, indexing records, caching results, modeling sets. But maps carry two pieces of behavior that trip up nearly every newcomer: their **zero value is `nil`**, and reading a missing key returns the **zero value of the value type** rather than an error or exception.

The `nil` map is the sharpest edge. A `nil` map is safe to read from — it just returns zero values — but writing to it **panics at runtime**. This asymmetry surprises people because, unlike a `nil` slice (which you can append to), a `nil` map must be initialized with `make` or a literal before you can store anything in it. Master these two behaviors and maps become one of the most pleasant tools in the language.

### Technical Explanation

**The zero value of a map is `nil`.** Declaring `var m map[string]int` gives you a `nil` map: no backing hash table has been allocated.

```go
var m map[string]int // nil map
fmt.Println(m == nil) // true
fmt.Println(m["x"])   // 0 — reading a nil map is safe
m["x"] = 1            // PANIC: assignment to entry in nil map
```

To get a usable map, allocate one with `make` or a literal:

```go
a := make(map[string]int)        // empty, ready to write
b := map[string]int{"x": 1}      // literal with initial entries
```

**Reading always succeeds and returns the value type's zero value for a missing key.** There is no "key not found" error. `m["missing"]` returns `0` for an `int` value type, `""` for a `string`, `nil` for a pointer, and so on.

**The comma-ok idiom distinguishes "present and zero" from "absent."** Because a present key can legitimately hold the zero value, a plain read cannot tell you whether the key exists. The two-result form does:

```go
v, ok := m["x"]
// ok == true  -> key exists, v is its value
// ok == false -> key absent, v is the zero value
```

**`delete` removes a key and is a no-op on a missing key** (and even on a `nil` map):

```go
delete(m, "x") // removes "x" if present; harmless otherwise
```

**Maps are reference types.** A map value is a small header pointing at the underlying hash table. Assigning a map or passing it to a function copies the header, not the data — both refer to the same table, so writes through one are visible through the other.

```go
m1 := map[string]int{"a": 1}
m2 := m1
m2["a"] = 99
fmt.Println(m1["a"]) // 99 — shared underlying table
```

**Iteration order is randomized.** Ranging over a map yields keys in an intentionally random order that varies between runs. To produce deterministic output, collect the keys, sort them, then iterate.

**Key types must be comparable.** Keys must support `==`: strings, numbers, booleans, pointers, channels, interfaces, and structs/arrays of comparable types. Slices, maps, and functions are **not** comparable and cannot be map keys.

| Operation | `nil` map | Initialized map |
|-----------|-----------|------------------|
| Read `m[k]` | Safe, returns zero value | Returns value or zero value |
| `v, ok := m[k]` | Safe, `ok` is false | Reports presence correctly |
| Write `m[k]=v` | **Panic** | Inserts/updates |
| `delete(m, k)` | Safe (no-op) | Removes key |
| `len(m)` | `0` | Entry count |

### Design Rationale

In **Java**, `HashMap.get` returns `null` for a missing key, forcing you to null-check and risking `NullPointerException` when the value type is an object. Go's "return the zero value" rule plus comma-ok is more uniform: missing `int` keys return `0`, not a special sentinel, and you opt into presence-checking only when you need it.

In **C++**, `std::map::operator[]` on a missing key **silently inserts** a default-constructed value — a notorious footgun that mutates the map during what looks like a read. Go never inserts on read; `m[k]` is purely a lookup, and only `m[k] = v` writes. That separation removes an entire class of accidental-insertion bugs.

In **Python**, `dict[key]` raises `KeyError` on a missing key, and you reach for `.get(key, default)` or `defaultdict` to avoid it. Go inverts the default: reads never raise; you use comma-ok to detect absence. Python also preserves insertion order since 3.7, whereas Go **deliberately randomizes** iteration order to stop programmers from accidentally depending on it — a decision born from real bugs in early Go code that broke when the implementation's order changed.

The `nil`-map-panics-on-write rule is the one piece of friction Go accepts. It exists because a map, unlike a slice, cannot meaningfully grow from `nil` without allocating a hash table, and Go prefers an explicit `make` over silently allocating on first write. The panic makes the missing initialization loud and immediate rather than a quiet logic error.

### Common Mistakes

**Writing to a `nil` map.** `var m map[string]int; m["k"] = 1` compiles fine but panics at runtime with "assignment to entry in nil map." This commonly happens when a struct has a map field that was never initialized. Always `make` the map (or use a literal) before writing — often in a constructor.

**Confusing "key absent" with "value is zero."** Reading `count := m[name]` returns `0` whether `name` is missing or genuinely mapped to `0`. If that distinction matters, use `count, ok := m[name]`. Forgetting comma-ok produces subtle counting and caching bugs.

**Assuming iteration order is stable.** Ranging over a map and printing produces different orders across runs. Tests that hard-code an expected order flake intermittently. Sort the keys first if you need determinism.

**Using an uncomparable key type.** Declaring `map[[]string]int` is a compile error because slices are not comparable. Beginners try to key by a slice and must instead convert to a string or use an array/struct of comparable fields.

**Mutating a map while ranging over it.** Adding keys during iteration has unspecified behavior (the new key may or may not appear); it is allowed but unpredictable. Deleting the current key is safe, but collect-then-mutate is the clearer pattern.

### Key Takeaways

- A map's zero value is `nil`: safe to read, but writing to it panics.
- Initialize maps with `make(map[K]V)` or a literal before storing keys.
- Reading a missing key returns the value type's zero value, never an error.
- Use comma-ok (`v, ok := m[k]`) to tell "absent" apart from "present and zero."
- Maps are reference types; assigning or passing one shares the same backing table.
- Iteration order is randomized; sort keys for deterministic output. Keys must be comparable.

---

## Broken Code

```go
// broken: writes to a nil map and ignores comma-ok, so it panics and miscounts
package main

import (
	"fmt"
	"strings"
)

func wordCount(text string) map[string]int {
	// Bug: declared but never allocated — this is a nil map.
	var counts map[string]int

	for _, word := range strings.Fields(text) {
		// PANIC at runtime: assignment to entry in nil map.
		counts[word]++
	}
	return counts
}

func main() {
	counts := wordCount("go is go and go is fast")
	fmt.Println(counts)

	// Bug: a plain read can't tell "absent" from "count is zero".
	if counts["python"] == 0 {
		// Wrong conclusion: we can't tell if python appeared zero times
		// or was never seen at all.
		fmt.Println("python never appeared (maybe?)")
	}
}
```

---

## Correct Code

```go
// correct: initialize the map, use comma-ok, and sort keys for stable output
package main

import (
	"fmt"
	"sort"
	"strings"
)

func wordCount(text string) map[string]int {
	counts := make(map[string]int) // allocate before writing
	for _, word := range strings.Fields(text) {
		counts[word]++ // safe: writing into an initialized map
	}
	return counts
}

func main() {
	counts := wordCount("go is go and go is fast")

	// Iterate in sorted key order for deterministic output.
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("%-5s %d\n", k, counts[k])
	}

	// comma-ok distinguishes "absent" from "present and zero".
	if v, ok := counts["python"]; ok {
		fmt.Println("python count:", v)
	} else {
		fmt.Println("python was never seen")
	}

	// delete is safe and a no-op on a missing key.
	delete(counts, "and")
	delete(counts, "missing") // harmless
	fmt.Println("remaining entries:", len(counts))
}
```

---

## Explanation

The broken version declares `var counts map[string]int` and never allocates it, leaving a `nil` map. The first attempt to write — `counts[word]++`, which both reads and assigns — panics at runtime with "assignment to entry in nil map." Even if it did not panic, the function's caller falls into the second trap: `counts["python"] == 0` cannot distinguish a word that appeared zero times from one that was never in the text, because a missing key reads back as the zero value `0`.

The correct version fixes the root cause by allocating with `make(map[string]int)` before any write. Now `counts[word]++` works: a missing key reads as `0`, gets incremented to `1`, and is stored. To answer presence questions honestly, it uses the comma-ok form `v, ok := counts["python"]`, where `ok` is `false` precisely when the key is absent — no ambiguity with a genuine zero count. The example also demonstrates idiomatic deterministic iteration: collect keys into a slice, `sort.Strings` them, then range over the sorted slice, because ranging the map directly yields randomized order.

Finally it shows `delete`, which removes a key if present and does nothing for a missing one (or even a `nil` map), so you never need to guard it. Together these are the four daily map operations — initialize, write, comma-ok read, delete — done the idiomatic way.

---

## Design Tradeoff

Go's map design optimizes for the common case at the cost of two memorized rules. Returning the value type's zero value on a missing read (instead of raising, like Python, or risking null, like Java) makes the frequent "look up and use" path clean and uniform — but it forces you to remember comma-ok whenever the zero value is itself a meaningful value. And making a `nil` map read-safe but write-panicking keeps allocation explicit, at the price of a runtime panic for the forgotten `make`.

These are deliberate trades toward explicitness and predictability. The randomized iteration order is the clearest example: it actively makes one thing harder (deterministic output now needs an extra sort) in order to make a whole class of bugs impossible (code that silently depends on an order the runtime never promised). Go would rather you feel a little friction up front — call `make`, use comma-ok, sort your keys — than ship a program that breaks mysteriously later. Once these rules are second nature, maps are fast, simple, and free of the accidental-insertion and ordering surprises that haunt other languages.

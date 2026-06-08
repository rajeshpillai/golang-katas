---
id: when-generics-help
phase: 7
phase_title: Generics (Carefully)
sequence: 3
title: When Generics Help
---

## Description

### Concept Overview

Generics earn their keep in a specific, recognizable situation: when an algorithm or data structure is **identical across many element types** and you would otherwise either duplicate the code or erase the types with `interface{}`. The classic signal is that you find yourself copy-pasting a function and changing only the type in the signature — `MapInts`, `MapStrings`, `MapUsers` — with byte-for-byte identical bodies. That duplication is exactly what a single type-parameterized function removes.

This kata is about *recognizing the fit*. Generics are not a style to apply everywhere; they are a remedy for a particular pain. When you feel that pain — duplicated container code, type assertions scattered through a utility, a data structure that should hold "any element" safely — generics are the right and idiomatic answer.

### Technical Explanation

Three patterns account for the large majority of good generic code.

**1. Container types.** A stack, queue, set, linked list, or tree holds elements but does not care what they are. Before generics you wrote one container of `interface{}` (losing type safety) or one per element type (duplication). A single generic type solves both:

```go
type Set[T comparable] struct {
    m map[T]struct{}
}

func NewSet[T comparable]() *Set[T] { return &Set[T]{m: make(map[T]struct{})} }
func (s *Set[T]) Add(v T)           { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool      { _, ok := s.m[v]; return ok }
func (s *Set[T]) Len() int          { return len(s.m) }
```

`Set[string]` and `Set[int]` are distinct, fully type-checked types from one definition. The constraint is `comparable` because map keys require it.

**2. Slice / collection algorithms.** Operations like `Map`, `Filter`, `Reduce`, `Keys`, `Values`, `Contains`, and `Index` have bodies that never inspect the element — they only move, compare, or transform it. These are the sweet spot, and the standard library now ships many of them in **`slices`** and **`maps`** (Go 1.21):

```go
func Filter[T any](xs []T, keep func(T) bool) []T {
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if keep(x) {
            out = append(out, x)
        }
    }
    return out
}
```

**3. Functions parameterized over numeric/ordered kinds.** `Min`, `Max`, `Sum`, `Clamp` need an operator (`<`, `+`) that cannot be expressed as a method. A type-set constraint (`cmp.Ordered`) lets one function serve every numeric type:

```go
func Max[T cmp.Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}
```

The unifying test: **the type parameter relates input to output, or the body works uniformly without inspecting the concrete type.** `Map[T, U]` guarantees the output slice's element type *follows from* the function you pass. `Keys[K, V]` guarantees the returned slice is `[]K`, matching the map. That relationship is precisely what `interface{}` cannot express and what makes generics worthwhile here.

A useful contrast is what you *gain over `interface{}`*:

```go
// interface{} version: caller must assert, may panic at runtime
func FirstAny(xs []interface{}) interface{} { return xs[0] }
v := FirstAny([]interface{}{1, 2}).(int) // assertion, runtime risk

// generic version: type flows through, checked at compile time
func First[T any](xs []T) T { return xs[0] }
n := First([]int{1, 2}) // n is int, no assertion, no risk
```

### Design Rationale

The reason Go waited so long for generics is that its designers wanted evidence that the feature solved *real, recurring* problems rather than hypothetical ones. The motivating use cases in the official proposal were exactly these: type-safe containers and slice utilities. For a decade, Go programmers hand-wrote `interface{}` containers and asserted on the way out, or generated code with tools like `go generate`. Both worked, but both were unsatisfying — one sacrificed safety, the other added a build step and produced repetitive source.

Compared to other languages, Go's "when to use it" guidance is unusually conservative *on purpose*. **Java** and **C#** programmers reach for generics routinely for collections because the standard library is built on them (`List<T>`, `Dictionary<K,V>`). **Rust** uses generics pervasively because zero-cost abstraction is a core value. Go, by contrast, treats generics as a targeted tool and keeps much of the standard library non-generic where interfaces suffice (`io.Reader`, `sort.Interface`). The Go team's own advice — "if you are writing the same code for different types and the only difference is the type, use a type parameter" — is deliberately narrow. It points you at duplication and type-erasure pain, and at little else.

This restraint reflects Go's broader philosophy that abstractions must pay for the cognitive cost they impose. A generic container is justified because it removes real duplication *and* restores type safety simultaneously. That double win is the hallmark of a good generic.

### Common Mistakes

**Not recognizing the duplication you already have.** Teams sometimes maintain `IntStack`, `StringStack`, and `JobStack` with identical bodies, never noticing they are the textbook case for a single `Stack[T]`. The signal is "I changed only the type." When you see it, consolidate.

**Keeping an `interface{}` container after generics exist.** Legacy `[]interface{}` collections with assertions on every read are exactly what generics replace. Migrating them removes runtime panics and clarifies intent.

**Using generics for the container but then storing `any` inside.** A `Stack[any]` defeats the purpose — you have a generic type but erased the element type. Parameterize over the *real* element type (`Stack[Job]`), not over `any`.

**Forgetting the standard library already has it.** Before writing `Map`, `Filter`, `Keys`, or `Contains`, check `slices` and `maps`. `slices.Contains`, `slices.Index`, `slices.Sort`, `maps.Keys`, and friends already exist and are well tested. Reinventing them is the wrong kind of generic enthusiasm.

**Choosing the wrong constraint for a container.** A set or map-keyed structure needs `comparable`; an ordered structure needs `cmp.Ordered`. Defaulting everything to `any` will block the very operations (`==`, `<`) the container needs.

### Key Takeaways

- The clearest signal for generics is duplicated code where the *only* difference between copies is the type.
- Type-safe containers (stack, queue, set, tree) are a primary, idiomatic use of generics.
- Slice/map algorithms whose bodies never inspect the element (`Map`, `Filter`, `Keys`) are the sweet spot — and many already live in `slices`/`maps`.
- Generics shine when the type parameter *relates* input to output, something `interface{}` cannot express.
- Prefer parameterizing over the real element type; a `Stack[any]` throws away the benefit.
- Check the standard library (`slices`, `maps`, `cmp`) before writing your own generic utility.

---

## Broken Code

```go
// broken: an interface{} container — the pre-generics workaround that
// loses type safety and forces error-prone assertions on every read.
package main

import "fmt"

type Stack struct {
    items []interface{}
}

func (s *Stack) Push(v interface{}) { s.items = append(s.items, v) }
func (s *Stack) Pop() interface{} {
    v := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return v
}

func main() {
    var s Stack
    s.Push(10)
    s.Push("oops") // nothing stops a string from entering an "int" stack

    // Caller must assert; this one panics: interface conversion error.
    n := s.Pop().(int) + 1
    fmt.Println(n)
}
```

---

## Correct Code

```go
// correct: one generic container + standard-library generic helpers,
// all type-checked at compile time with zero assertions.
package main

import (
	"fmt"
	"slices"
)

// Set is a type-safe container: one definition, many element types.
// comparable is required because map keys must be comparable.
type Set[T comparable] struct {
	m map[T]struct{}
}

func NewSet[T comparable](items ...T) *Set[T] {
	s := &Set[T]{m: make(map[T]struct{}, len(items))}
	for _, v := range items {
		s.Add(v)
	}
	return s
}

func (s *Set[T]) Add(v T)      { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool { _, ok := s.m[v]; return ok }
func (s *Set[T]) Len() int     { return len(s.m) }

// Filter is a uniform slice algorithm: its body never inspects the element.
func Filter[T any](xs []T, keep func(T) bool) []T {
	out := make([]T, 0, len(xs))
	for _, x := range xs {
		if keep(x) {
			out = append(out, x)
		}
	}
	return out
}

func main() {
	// A type-safe Set[string]: the compiler rejects non-string elements.
	langs := NewSet("go", "rust", "go")
	fmt.Printf("unique langs: %d, has go: %t\n", langs.Len(), langs.Has("go"))

	// Custom generic Filter — uniform across element types.
	nums := []int{1, 2, 3, 4, 5, 6}
	even := Filter(nums, func(n int) bool { return n%2 == 0 })
	fmt.Println("even:", even)

	// Prefer the standard library when it already provides the helper.
	fmt.Println("contains 4:", slices.Contains(nums, 4))
	fmt.Println("index of 5:", slices.Index(nums, 5))

	// Type flows through with no assertions and no runtime risk.
	words := []string{"alpha", "beta", "gamma"}
	long := Filter(words, func(w string) bool { return len(w) > 4 })
	fmt.Println("long words:", long)
}
```

---

## Explanation

The broken version is the historical pattern Go developers lived with before 1.18: a `Stack` backed by `[]interface{}`. It compiles, but it lies. Nothing prevents `s.Push("oops")` from putting a string into what was conceptually an integer stack, and the mistake is invisible until `s.Pop().(int)` panics at runtime with an interface-conversion error. Every read site is forced to assert, every assertion is a potential panic, and the type that the data "really is" exists only in the programmer's head.

The correct version replaces that with a genuinely type-safe `Set[T comparable]`. `NewSet("go", "rust", "go")` produces a `Set[string]`, and the compiler will reject any attempt to add a non-string. There are no assertions anywhere, and there is nothing to panic on. The constraint is `comparable` precisely because the underlying `map[T]struct{}` needs comparable keys — choosing the right constraint is part of making the container correct.

The `Filter` function illustrates the second sweet spot: a slice algorithm whose body moves elements around without ever inspecting their concrete type. It works uniformly for `[]int` and `[]string`. And the calls to `slices.Contains` and `slices.Index` make the final point — much of this is already in the standard library. The idiomatic move is to *use* `slices` and `maps` first, and write your own generic helper only when the standard library lacks it.

---

## Design Tradeoff

The win here is a rare double: generics remove duplication *and* restore type safety at the same time. The `interface{}` container had one virtue (it accepted anything) and one fatal flaw (it accepted anything). The generic container keeps the flexibility while making the compiler enforce the element type, eliminating a whole class of runtime panics. That is the strongest possible justification for reaching for a type parameter.

The tradeoff to stay honest about is restraint. Recognizing the fit is easy to over-apply: not every function that *could* be generic *should* be. The discipline is to introduce a type parameter when you have demonstrable duplication or active type-erasure pain, and to lean on `slices`, `maps`, and `cmp` for the common cases rather than hand-rolling them. Generics are the right tool for type-safe containers and uniform collection algorithms — and applying them precisely there, rather than everywhere, is what keeps Go code clear.

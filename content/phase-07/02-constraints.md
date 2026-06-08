---
id: constraints
phase: 7
phase_title: Generics (Carefully)
sequence: 2
title: Constraints
---

## Description

### Concept Overview

A **constraint** is the contract a type parameter must satisfy. When you write `func Sum[T Number](xs []T) T`, the `Number` part is the constraint — it tells the compiler exactly which operations are legal on values of type `T` inside the function body. Without a constraint, the compiler knows nothing about `T` and refuses to let you add, compare, or order its values.

In Go, constraints *are interfaces*. This is the elegant core of the design: you already know interfaces, so you already know most of constraints. But constraints extend interfaces with two new abilities — listing **type sets** (using `|` and `~`) and requiring the `comparable` capability — that ordinary runtime interfaces never had. Getting constraints right is what makes generic code both expressive and safe.

### Technical Explanation

The loosest constraint is **`any`** (alias for `interface{}`): every type satisfies it, and inside the function you may do almost nothing to a `T` except assign it, pass it around, and produce `var zero T`. You cannot add, compare with `==`, or order it.

To allow more operations, the constraint must promise them. There are three building blocks.

**1. Method-set constraints** — a normal interface listing methods. Any type with those methods satisfies it:

```go
type Stringer interface {
    String() string
}

func Join[T Stringer](xs []T) string {
    var b strings.Builder
    for _, x := range xs {
        b.WriteString(x.String()) // legal: the constraint promises String()
    }
    return b.String()
}
```

**2. Type-set constraints** — a constraint may list *concrete types* separated by `|`. This says "T must be one of these underlying types," which unlocks operators:

```go
type Number interface {
    int | int64 | float64
}

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs {
        total += x // legal: every listed type supports +
    }
    return total
}
```

The **`~` (approximation / tilde) token** means "any type whose *underlying* type is this." `~int` matches `int` *and* any named type defined as `type Celsius int`. Without `~`, a constraint of `int` would reject `Celsius`:

```go
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
        ~float32 | ~float64 | ~string
}
```

This is essentially the constraint provided by the standard library as **`cmp.Ordered`** (Go 1.21) and previously as `constraints.Ordered` in `golang.org/x/exp/constraints`. Types satisfying `Ordered` support `<`, `<=`, `>`, `>=`.

**3. `comparable`** — a predeclared constraint satisfied by every type that can be used with `==` and `!=`. It is exactly what map keys require, so it is the constraint you use when `T` will be a map key or you need equality:

```go
func Contains[T comparable](xs []T, target T) bool {
    for _, x := range xs {
        if x == target { // legal: comparable promises ==
            return true
        }
    }
    return false
}
```

Note `comparable` is *not* the same as `Ordered`. `comparable` permits `==`/`!=` (structs, arrays, interfaces qualify). `Ordered` permits `<`/`>` (only the numeric and string kinds qualify).

You can also **combine** elements in one constraint. A constraint may embed other constraints and add methods:

```go
type SignedStringer interface {
    ~int | ~int64
    String() string
}
```

This requires T to have an underlying int/int64 type *and* a `String()` method.

**Constraint type inference** lets the compiler deduce one type parameter from another via the constraint, reducing how many type arguments you must write — but in everyday code, ordinary argument inference handles most cases.

### Design Rationale

Reusing interfaces for constraints is the design decision that kept Go generics from feeling like a bolted-on second language. In **C++** templates, constraints were historically *absent* — a template would simply fail deep inside instantiation if a type lacked an operation, producing the infamous wall-of-text errors. C++20 added *concepts* to fix this. **Rust** has *trait bounds* from the start: `T: Ord` requires the `Ord` trait, very close in spirit to Go's `T Ordered`. **Java** and **C#** use bounded type parameters like `<T extends Comparable<T>>`, but because they rely on method dispatch (and Java boxes primitives), they cannot express "must be an integer type that supports `+`" the way Go's type sets can.

Go's innovation is the **type set**: a constraint can enumerate underlying types with `|` and `~`, which lets the compiler permit *operators* (`+`, `<`) on a type parameter — something method-based constraints alone cannot express, because operators are not methods in Go. The `~` token exists because Go distinguishes a named type from its underlying type; without `~`, generic numeric code would mysteriously reject every domain-specific named type like `type Money int64`. The decision to make `comparable` a predeclared constraint (rather than something you spell out) reflects how central map keys and equality are to everyday Go.

The guiding principle remains: a constraint should promise *exactly* what the function needs and no more. An over-tight constraint excludes valid callers; an over-loose one lets in types the body cannot actually handle. Designing the right constraint is the real skill in writing generic Go.

### Common Mistakes

**Forgetting `~` and rejecting named types.** A constraint of `int | float64` accepts `int` but *rejects* `type Score int`. Almost always you want `~int | ~float64`. Omitting the tilde is the single most common constraint bug, because it compiles fine until a caller passes a named type.

**Confusing `comparable` with `Ordered`.** Using `comparable` and then trying `a < b` fails to compile — `comparable` only promises `==`/`!=`. Conversely, requiring `Ordered` when you only need equality needlessly excludes structs and other comparable-but-not-ordered types.

**Making the constraint too loose, then hitting a compile error in the body.** If you constrain to `any` but write `total += x`, the compiler rejects it because `any` does not promise `+`. The fix is to tighten the constraint to a type set that includes `+`-capable types.

**Making the constraint too tight.** Listing only `int | float64` when your algorithm works for all numeric kinds turns away `int64`, `uint`, etc. Prefer the broad standard constraints (`cmp.Ordered`) unless you have a reason to restrict.

**Trying to use a type-set constraint as a runtime interface.** A constraint containing a type-set (with `|`) can *only* be used as a constraint, not as an ordinary variable type. You cannot write `var x Number` as a normal variable — type-set interfaces are not usable as runtime values.

### Key Takeaways

- A constraint is an interface that declares what operations a type parameter permits; `any` permits almost nothing.
- Type sets (`int | float64`) unlock operators like `+`, `<`, and `==` that method constraints cannot express.
- The `~` token matches a type's *underlying* type, so `~int` accepts named types like `type Money int` — usually what you want.
- `comparable` allows `==`/`!=` (map keys, equality); `Ordered` allows `<`/`>` (numeric and string ordering). They are different.
- Constraints can combine type sets and methods, and embed other constraints.
- Aim for the *exact* constraint your function body needs — too tight excludes valid callers, too loose fails to compile.

---

## Broken Code

```go
// broken: the constraint is too loose, so the body does not compile
package main

import "fmt"

// `any` promises nothing, so `+` and `<` are both illegal on T.
func SumAndMax[T any](xs []T) (T, T) {
    var total T
    var max T
    for i, x := range xs {
        total += x // error: invalid operation, + not defined for T (any)
        if i == 0 || x > max {
            max = x // error: invalid operation, > not defined for T (any)
        }
    }
    return total, max
}

func main() {
    fmt.Println(SumAndMax([]int{3, 1, 4, 1, 5}))
}
```

---

## Correct Code

```go
// correct: constraints promise exactly the operations the body uses
package main

import (
	"fmt"
	"strings"
)

// Ordered is the standard-style constraint (mirrors cmp.Ordered).
// The ~ token also admits named types like `type Score int`.
type Ordered interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
		~float32 | ~float64 | ~string
}

// SumAndMax needs both + and >, so its constraint must promise both.
// Ordered promises ordering (<, >); for numeric kinds it also permits +.
func SumAndMax[T Ordered](xs []T) (T, T, error) {
	var zero T
	if len(xs) == 0 {
		return zero, zero, fmt.Errorf("SumAndMax: empty input")
	}
	total := xs[0]
	max := xs[0]
	for _, x := range xs[1:] {
		total += x
		if x > max {
			max = x
		}
	}
	return total, max, nil
}

// comparable (not Ordered) is the right constraint for equality / map keys.
func Contains[T comparable](xs []T, target T) bool {
	for _, x := range xs {
		if x == target {
			return true
		}
	}
	return false
}

// A method-set constraint: any type with a String() method qualifies.
type Stringer interface {
	String() string
}

func Join[T Stringer](xs []T) string {
	var b strings.Builder
	for i, x := range xs {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(x.String())
	}
	return b.String()
}

// Score is a NAMED type; the ~ in Ordered is what lets it satisfy the constraint.
type Score int

type Color struct{ R, G, B uint8 }

func (c Color) String() string { return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B) }

func main() {
	sum, max, err := SumAndMax([]Score{3, 1, 4, 1, 5})
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Printf("named-type sum=%d max=%d\n", sum, max)

	// comparable lets Contains work on structs that support ==.
	palette := []Color{{255, 0, 0}, {0, 255, 0}}
	fmt.Println("has red:", Contains(palette, Color{255, 0, 0}))

	// Method-set constraint in action.
	fmt.Println("joined:", Join(palette))

	// Demonstrate the empty-input error path explicitly.
	_, _, err = SumAndMax([]int{})
	fmt.Println("empty:", err)
}
```

---

## Explanation

The broken version constrains `T` to `any`, then tries to use `+` and `>` on values of type `T`. Because `any` promises nothing about the underlying type, the compiler has no basis to allow those operators and rejects both lines. This is the central lesson of constraints: *the body may only do what the constraint promises*. A loose constraint is not "permissive" — it is restrictive about what you can write inside the function.

The correct version tightens the constraint to `Ordered`, a type set that enumerates the numeric and string kinds with `~`. That `~` is doing real work: it lets the named type `Score` (defined as `type Score int`) satisfy the constraint, because `Score`'s *underlying* type is `int`. Without the tilde, `SumAndMax([]Score{...})` would fail to compile even though `Score` is "obviously" an integer. The function also returns an `error` for the empty-input case rather than silently returning a misleading zero — generic code must still handle failure paths honestly.

The remaining examples show the other two constraint flavors. `Contains` uses `comparable`, the predeclared constraint for `==`/`!=`, which is why it works on `Color` structs (structs are comparable when all fields are). `Join` uses a method-set constraint, `Stringer`, the same kind of interface you already write for runtime polymorphism — here serving double duty as a generic constraint.

---

## Design Tradeoff

Constraints make you state, up front, the contract every caller must meet — and that explicitness is both the cost and the benefit. The cost is design effort: you must choose between `comparable` and `Ordered`, decide whether to add `~`, and weigh how broad the type set should be. Get it too tight and you turn away legitimate callers; too loose and your own function body stops compiling. There is no way to be vague.

The benefit is that the contract is checked at *compile time*, for both the implementer and every caller, with no runtime surprises. A `comparable` parameter can never be handed a non-comparable type; an `Ordered` parameter can never receive something that lacks `<`. Compare this to the `interface{}`-plus-reflection era, where such mismatches surfaced only as runtime panics. Prefer the standard constraints (`cmp.Ordered`, `comparable`) where they fit — they encode well-considered type sets so you do not have to — and write a custom constraint only when your function genuinely needs a narrower or combined contract.

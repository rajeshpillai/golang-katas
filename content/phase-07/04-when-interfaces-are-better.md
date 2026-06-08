---
id: when-interfaces-are-better
phase: 7
phase_title: Generics (Carefully)
sequence: 4
title: When Interfaces Are Better
---

## Description

### Concept Overview

Generics and interfaces solve *different* problems, and the most common generics mistake is using a type parameter where a plain interface was the better, simpler choice. The dividing line is sharp once you see it: **interfaces abstract over behavior; generics abstract over types.** If your function only needs to *call methods* on its argument — `Read`, `Write`, `String`, `Close` — an interface parameter is clearer, more flexible, and more idiomatic. If your function needs to *preserve a concrete type* across input and output, that is when a type parameter earns its place.

This kata teaches you to default to interfaces and reach for generics only when interfaces genuinely fall short. In a heterogeneous, behavior-oriented world — which most application code is — interfaces are usually the right answer.

### Technical Explanation

Consider a function that processes anything it can read bytes from. The behavior it needs is "give me bytes," nothing more. The idiomatic signature is an interface:

```go
func Count(r io.Reader) (int, error) {
    buf := make([]byte, 4096)
    total := 0
    for {
        n, err := r.Read(buf)
        total += n
        if err == io.EOF {
            return total, nil
        }
        if err != nil {
            return total, err
        }
    }
}
```

`Count` accepts a `*os.File`, a `*bytes.Buffer`, a `strings.Reader`, a network connection — anything with a `Read` method. A generic version, `func Count[T io.Reader](r T)`, would compile but adds a type parameter that buys *nothing*: the body only calls `Read`, and `T` is never related to a return value. The interface is strictly simpler.

**Heterogeneous collections** are the clearest case where interfaces win outright. A slice of *different* concrete types that share behavior must be `[]Shape`, not `[]T`:

```go
type Shape interface{ Area() float64 }

func TotalArea(shapes []Shape) float64 {
    var sum float64
    for _, s := range shapes {
        sum += s.Area() // each element may be a different concrete type
    }
    return sum
}
```

A generic `[]T` requires *every element to be the same type* `T`. You cannot put a `Circle` and a `Rectangle` in a `[]T` — but you can in a `[]Shape`. Generics homogenize; interfaces accommodate variety. When you need a mixed bag dispatched by behavior, only interfaces work.

**Dynamic dispatch and plugin-style designs** also belong to interfaces. Registering handlers, swapping implementations at runtime, and storing values of unknown concrete type in a registry all rely on the runtime polymorphism interfaces provide:

```go
type Handler interface{ Handle(event string) }
registry := map[string]Handler{} // values can be any implementing type
```

The decision rule:

- **Only calling methods?** Use an interface parameter.
- **Need a heterogeneous collection dispatched by behavior?** Use a `[]Interface`.
- **Need runtime swapping / registration?** Use an interface.
- **Need to preserve and relate concrete types (input type determines output type), or operate uniformly over many homogeneous element types?** *Then* use generics.

A subtle but important point: a type parameter whose constraint is a method-only interface (`func F[T io.Reader](r T)`) is almost always worse than just `func F(r io.Reader)`. The generic form pins the argument to a *single* concrete type per call and prevents you from mixing implementations, while gaining no type-relationship benefit. Prefer the interface.

### Design Rationale

Interfaces were Go's primary abstraction mechanism for over a decade, and the language was designed around small, implicitly-satisfied interfaces (`io.Reader`, `io.Writer`, `fmt.Stringer`, `error`). When generics arrived, the Go team was explicit that generics were *not* meant to replace interfaces but to complement them. The official guidance states it plainly: if the only operations you perform on a value are method calls, use an interface, not a type parameter.

This is a sharper stance than in many languages. In **Java** and **C#**, generics and interfaces are deeply intertwined and programmers use generics constantly because the collections framework demands it. In **Rust**, the trait system blurs the line — `dyn Trait` (dynamic dispatch) versus `impl Trait` / generic bounds (static dispatch) is a frequent, nuanced decision. Go keeps the distinction unusually crisp: interfaces for *behavioral* abstraction and runtime polymorphism; generics for *type-relational* abstraction over homogeneous types.

The runtime mechanics reinforce the design intent. An interface value carries a type descriptor plus a pointer to the data, enabling dynamic dispatch — a single function can handle a `[]Shape` of mixed concrete types. A generic function, by contrast, is specialized (or shape-shared) at compile time for the specific types used; it cannot hold a mixed collection. So the choice is not merely stylistic — it follows from what each mechanism *can physically do*. Interfaces can carry variety at runtime; generics cannot.

### Common Mistakes

**Parameterizing over a method-only interface.** Writing `func Write[T io.Writer](w T, p []byte)` instead of `func Write(w io.Writer, p []byte)` adds a type parameter that constrains callers to one concrete writer per call and yields no benefit. If the body only calls methods, drop the type parameter.

**Trying to build a heterogeneous slice with generics.** `[]T` forces a single element type. Programmers reaching for `Container[T]` to hold "different shapes" discover they actually need `[]Shape`. Generics homogenize; this requirement needs an interface.

**Using generics where runtime swapping is required.** A plugin registry, a strategy that changes at runtime, or a dependency injected at startup all need a value whose concrete type is not known at compile time. That is precisely what interface values provide and what generic specialization cannot.

**Believing generics are "more modern" so always preferable.** Newer is not better. An `io.Reader` parameter is more flexible than `[T io.Reader]` because it admits mixed implementations and reads more simply. Defaulting to generics out of novelty produces worse APIs.

**Over-constraining and losing the open set of implementers.** A core virtue of interfaces is that *any* type — including ones in other packages, written later — can satisfy them implicitly. Pinning to a type parameter can quietly narrow this openness without giving anything back.

### Key Takeaways

- Interfaces abstract over **behavior**; generics abstract over **types**. Match the tool to the problem.
- If the body only **calls methods**, use an interface parameter, not a type parameter.
- Heterogeneous collections dispatched by behavior require `[]Interface`; a generic `[]T` forces one element type.
- Runtime swapping, plugins, and registries need interface values — generics are resolved at compile time and cannot hold mixed types.
- A method-only constraint (`[T io.Reader]`) is almost always worse than the equivalent interface parameter.
- Default to interfaces; reach for generics only when you must preserve or relate concrete types across a homogeneous operation.

---

## Broken Code

```go
// broken: a needless type parameter over a method-only interface.
// It forces a SINGLE concrete element type, so a mixed collection
// of shapes cannot be expressed at all.
package main

import "fmt"

type Shape interface{ Area() float64 }

type Circle struct{ R float64 }

func (c Circle) Area() float64 { return 3.14159 * c.R * c.R }

type Rectangle struct{ W, H float64 }

func (r Rectangle) Area() float64 { return r.W * r.H }

// Generic over T: every element of the slice must be the SAME type T.
func TotalArea[T Shape](shapes []T) float64 {
    var sum float64
    for _, s := range shapes {
        sum += s.Area()
    }
    return sum
}

func main() {
    // This does not compile: a []T cannot hold both Circle and Rectangle.
    mixed := []Shape{Circle{R: 2}, Rectangle{W: 3, H: 4}}
    fmt.Println(TotalArea(mixed)) // type mismatch: []Shape is not []T
}
```

---

## Correct Code

```go
// correct: interfaces abstract over behavior and accommodate a
// heterogeneous collection — the natural, idiomatic solution.
package main

import (
	"fmt"
	"io"
	"strings"
)

type Shape interface{ Area() float64 }

type Circle struct{ R float64 }

func (c Circle) Area() float64 { return 3.14159 * c.R * c.R }

type Rectangle struct{ W, H float64 }

func (r Rectangle) Area() float64 { return r.W * r.H }

// Interface parameter: each element may be a DIFFERENT concrete type,
// dispatched by behavior at runtime.
func TotalArea(shapes []Shape) float64 {
	var sum float64
	for _, s := range shapes {
		sum += s.Area()
	}
	return sum
}

// Behavior-only function: it merely reads bytes, so io.Reader is the
// right abstraction. A type parameter here would add nothing.
func CountBytes(r io.Reader) (int, error) {
	buf := make([]byte, 256)
	total := 0
	for {
		n, err := r.Read(buf)
		total += n
		if err == io.EOF {
			return total, nil
		}
		if err != nil {
			return total, fmt.Errorf("CountBytes: %w", err)
		}
	}
}

func main() {
	// A genuinely heterogeneous collection — only interfaces allow this.
	shapes := []Shape{
		Circle{R: 2},
		Rectangle{W: 3, H: 4},
		Circle{R: 1},
	}
	fmt.Printf("total area: %.2f\n", TotalArea(shapes))

	// One function, many unrelated reader implementations, no type parameter.
	for _, src := range []io.Reader{
		strings.NewReader("hello"),
		strings.NewReader("a much longer string of bytes"),
	} {
		n, err := CountBytes(src)
		if err != nil {
			fmt.Println("error:", err)
			continue
		}
		fmt.Println("bytes read:", n)
	}
}
```

---

## Explanation

The broken version reaches for generics out of habit and immediately hits a wall. `TotalArea[T Shape]` declares that *all* elements share one concrete type `T`, so a slice mixing `Circle` and `Rectangle` cannot be passed: `[]Shape` is not assignable to `[]T`. The very thing we want — a collection of different shapes that all know how to compute their area — is impossible to express with a type parameter, because generics homogenize the element type. The type parameter also bought nothing even in the homogeneous case, since the body only calls the `Area()` method.

The correct version uses `[]Shape`, an interface slice. Each element carries its own concrete type at runtime, and `s.Area()` dispatches dynamically to the right implementation. A `Circle` and a `Rectangle` coexist naturally. This is interfaces doing exactly what they were designed for: abstracting over behavior and accommodating variety.

`CountBytes` makes the second point. It needs only to call `Read`, so `io.Reader` is the correct parameter type. The same function consumes any reader — here two different `strings.Reader` values, but equally a file, a network connection, or a buffer. A generic `CountBytes[T io.Reader]` would compile but would restrict each call to a single concrete reader type and add ceremony for no gain. Note also that the function wraps its read error with `%w` rather than swallowing it — behavioral abstraction does not excuse you from honest error handling.

---

## Design Tradeoff

Interfaces trade a small runtime cost — an indirection and a dynamic dispatch — for the ability to hold and dispatch *heterogeneous* values whose concrete types are not known until runtime. Generics trade that flexibility away in exchange for compile-time specialization and the ability to relate concrete types across a signature. Neither is universally better; they occupy different regions of the design space. Behavior that varies by implementation, mixed collections, and runtime swapping fall squarely in interface territory.

The practical discipline is to *default to interfaces* and treat a type parameter as something you must justify. Ask: am I only calling methods? Do I need a mixed collection? Do implementations get chosen at runtime? If yes to any, an interface is almost certainly clearer and more capable. Reserve generics for the cases where you must preserve or relate concrete types across a uniform, homogeneous operation. In behavior-oriented code — which is most code — the interface is not a compromise, it is the right answer.

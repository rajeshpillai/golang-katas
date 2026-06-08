---
id: interface-definition
phase: 4
phase_title: Interfaces (Core Abstraction)
sequence: 1
title: Interface Definition
---

## Description

### Concept Overview

An interface in Go is a **named set of method signatures**. It describes *what something can do*, never *what something is*. When you write `type Reader interface { Read(p []byte) (n int, err error) }`, you are not describing a class, a base type, or a data layout. You are describing a contract: "any value that has a `Read` method with this exact signature can be used wherever a `Reader` is expected."

This is the single most important abstraction in Go. Structs let you model data. Methods let you attach behavior to that data. Interfaces let you talk about that behavior *abstractly* — without naming the concrete type that provides it. A function that accepts an `io.Writer` does not care whether it is writing to a file, a network socket, an in-memory buffer, or `/dev/null`. It only cares that the value knows how to `Write`.

Interfaces are how Go achieves polymorphism. But unlike most languages, Go interfaces are defined entirely in terms of behavior and are satisfied *implicitly* — a topic we explore in depth in the next kata. This first kata focuses on what an interface *is*, how you declare one, and how interface values behave at runtime.

### Technical Explanation

**Declaring an interface** uses the `type` keyword followed by the `interface` keyword and a block of method signatures:

```go
type Shape interface {
    Area() float64
    Perimeter() float64
}
```

A method signature in an interface has a name, a parameter list, and a result list — but no body and no receiver. The interface says nothing about *how* `Area` is computed. It only says that anything claiming to be a `Shape` must offer an `Area() float64` method and a `Perimeter() float64` method.

**An interface value holds two things** at runtime: a *type* and a *value*. People describe this as the `(type, value)` pair, sometimes drawn as a two-word structure:

| Component | What it stores |
|-----------|----------------|
| Type descriptor | The concrete dynamic type stored inside (e.g. `Circle`) |
| Value           | A pointer to (or copy of) the underlying data |

When you assign a concrete value to an interface variable, Go records *which concrete type* you stored. This is why interfaces can dispatch the right method at runtime: the interface value remembers it is really a `Circle`, so calling `s.Area()` invokes `Circle`'s `Area` method.

```go
var s Shape       // s is nil: type=nil, value=nil
s = Circle{R: 2}  // s now holds: type=Circle, value={R:2}
fmt.Println(s.Area())
```

**Method sets determine satisfaction.** A type satisfies an interface when its *method set* includes every method the interface lists. For a value type `T`, the method set is all methods with a value receiver `(t T)`. For a pointer type `*T`, the method set includes methods with *either* a value receiver `(t T)` *or* a pointer receiver `(t *T)`. This distinction matters constantly and is the source of many "does not implement" errors.

**The empty interface**, written `interface{}` (or `any` since Go 1.18), lists *zero* methods. Every type has at least zero methods, so every value satisfies it. `any` is Go's way of saying "a value of unknown type." It is powerful but weakly typed — you give up static guarantees and must use a type assertion or type switch to recover the concrete type.

**Interfaces can embed other interfaces** to compose larger contracts from smaller ones:

```go
type ReadWriter interface {
    Reader   // embeds Read(...)
    Writer   // embeds Write(...)
}
```

### Design Rationale

Most object-oriented languages tie interfaces to a *declared, nominal* relationship. In **Java**, a class must say `class FileWriter implements Writer`. In **C#**, it is `class FileWriter : IWriter`. In **C++**, you inherit from an abstract base class with pure virtual functions. In **TypeScript**, the structural typing is closer to Go, but the interface still tends to be a compile-time shape check layered over a class-based runtime.

Go deliberately rejects the nominal approach. A Go type *never declares* which interfaces it implements. There is no `implements` keyword. Instead, satisfaction is **structural**: if your type has the right methods, it satisfies the interface — automatically, even if the interface was defined in a package your type has never heard of.

Why does this matter? It decouples the *definition* of an interface from the *implementation* of it. In Java, if you want to use a third-party class as a `Writer`, but that class did not declare `implements Writer`, you are stuck writing an adapter. In Go, you can define an interface that exactly matches the methods you need, and any existing type with those methods satisfies it for free. Interfaces become a tool of the *consumer*, not the *producer*. The package that *uses* a behavior gets to define the interface describing that behavior — a principle often summarized as "accept interfaces, return structs."

This is also why Go interfaces tend to be small. A nominal system encourages large, "kitchen-sink" interfaces because changing them later breaks every implementer. A structural system encourages tiny interfaces because they cost nothing to define and any matching type satisfies them instantly.

### Common Mistakes

**Putting fields in an interface.** Interfaces describe behavior, not data. You cannot write `type Shape interface { area float64 }`. Interfaces contain only method signatures (and embedded interfaces). If you find yourself wanting a field, you want a struct, or you want a *getter method* in the interface.

**Confusing the interface type with the concrete type.** When you store a `Circle` in a `Shape` variable, the static type is `Shape` but the dynamic type is still `Circle`. You can only call methods listed in `Shape` directly — even though the underlying `Circle` may have more methods. To reach the extra methods you must type-assert back to `Circle`. Beginners often expect `s.Radius()` to work when `Radius` is not part of the interface.

**Forgetting the pointer-vs-value method set rule.** If `Area` is defined on `*Circle` (pointer receiver) but you try to store a `Circle` value (not `&Circle{}`) into a `Shape`, the compiler rejects it: a `Circle` value's method set does not include pointer-receiver methods. The error reads "Circle does not implement Shape (Area method has pointer receiver)." This is the single most common interface error.

**Assuming an interface variable is never nil.** A freshly declared `var s Shape` is `nil` — both its type and value are nil. Calling a method on it panics. We dedicate an entire later kata to the subtle nil-interface-vs-nil-pointer trap, but the basic version bites here too.

**Overusing `any`.** Reaching for `interface{}`/`any` to "accept anything" throws away Go's type safety. Most of the time you actually want a small, specific interface that names the one or two methods you need.

### Key Takeaways

- An interface is a named set of method signatures describing behavior, never data or identity.
- An interface value is a `(type, value)` pair: it remembers the concrete dynamic type it holds, which is how method dispatch works at runtime.
- A type satisfies an interface when its method set contains every listed method — pointer receivers only count toward the `*T` method set.
- Go has no `implements` keyword; satisfaction is structural and implicit, letting consumers define the interfaces they need.
- The empty interface `interface{}` / `any` is satisfied by every type but sacrifices static type safety.
- Interfaces can embed other interfaces to compose larger contracts from smaller ones.

---

## Broken Code

```go
// broken: an interface cannot contain fields, and a value type does not
// satisfy an interface whose methods use pointer receivers.
package main

import "fmt"

// Bug 1: interfaces describe behavior, not data — fields are illegal here.
type Shape interface {
    name string // compile error: interface contains a field, not a method
    Area() float64
}

type Circle struct {
    Radius float64
}

// Area uses a POINTER receiver...
func (c *Circle) Area() float64 {
    return 3.14159 * c.Radius * c.Radius
}

func main() {
    // Bug 2: a Circle VALUE does not satisfy Shape because Area has a
    // pointer receiver. The compiler reports:
    //   Circle does not implement Shape (Area method has pointer receiver)
    var s Shape = Circle{Radius: 2}
    fmt.Println(s.Area())
}
```

---

## Correct Code

```go
// correct: a behavior-only interface, satisfied by concrete types,
// used polymorphically through interface values.
package main

import (
	"fmt"
	"math"
)

// Shape is a behavior contract: anything with Area and Perimeter is a Shape.
type Shape interface {
	Area() float64
	Perimeter() float64
}

type Circle struct {
	Radius float64
}

// Value receivers: a Circle VALUE satisfies Shape.
func (c Circle) Area() float64      { return math.Pi * c.Radius * c.Radius }
func (c Circle) Perimeter() float64 { return 2 * math.Pi * c.Radius }

type Rectangle struct {
	Width, Height float64
}

func (r Rectangle) Area() float64      { return r.Width * r.Height }
func (r Rectangle) Perimeter() float64 { return 2 * (r.Width + r.Height) }

// describe accepts the INTERFACE, so it works for any Shape without
// knowing or caring about the concrete type.
func describe(s Shape) {
	fmt.Printf("%-10T area=%6.2f perimeter=%6.2f\n", s, s.Area(), s.Perimeter())
}

func main() {
	// A nil interface value holds neither a type nor a value.
	var s Shape
	fmt.Printf("zero interface value: %v (is nil: %t)\n\n", s, s == nil)

	shapes := []Shape{
		Circle{Radius: 2},
		Rectangle{Width: 3, Height: 4},
	}

	for _, shape := range shapes {
		describe(shape)
	}

	// The interface remembers the concrete dynamic type; we can recover it.
	s = Circle{Radius: 5}
	if c, ok := s.(Circle); ok {
		fmt.Printf("\nrecovered concrete Circle with radius %.1f\n", c.Radius)
	}
}
```

---

## Explanation

The broken version fails for two independent but instructive reasons. First, it tries to declare a field (`name string`) inside an interface. Interfaces are *behavioral* contracts — they may only list method signatures and embedded interfaces. The compiler rejects the field outright because an interface is not a data layout; it never stores fields of its own. Second, `Area` is declared with a pointer receiver `(c *Circle)`, which means the method belongs to the method set of `*Circle`, not of `Circle`. When the code tries to store a `Circle` *value* into a `Shape`, the value's method set lacks `Area`, so satisfaction fails with the classic "method has pointer receiver" error.

The correct version fixes both issues. `Shape` lists only methods. `Circle` and `Rectangle` implement those methods with *value* receivers, so both the value and pointer forms satisfy `Shape`. Crucially, neither type ever says it implements `Shape` — satisfaction is implicit and structural. The `describe` function accepts the `Shape` interface, and at runtime each call dispatches to the correct concrete method because the interface value remembers whether it holds a `Circle` or a `Rectangle`.

The `main` function also demonstrates the `(type, value)` nature of interface values. A freshly declared `var s Shape` is genuinely `nil`. Once we store a concrete value, the interface carries that dynamic type, and a type assertion (`s.(Circle)`) can recover it. This round trip — concrete to interface and back — is the foundation of every interface-based design in Go.

---

## Design Tradeoff

By defining interfaces purely in terms of behavior and satisfying them structurally, Go trades the *explicit traceability* of nominal typing for *decoupling and flexibility*. In Java or C#, you can grep for `implements Writer` and find every type that claims the contract; the relationship is documented in the code. In Go, no such declaration exists — a type satisfies `io.Writer` silently the moment it grows a matching `Write` method, and tooling (or an IDE) is what tells you who implements what.

That loss is deliberate and, in practice, well worth it. Because interfaces cost nothing to satisfy and can be declared by the *consumer* of a behavior, Go programs lean on many tiny, purpose-built interfaces instead of a few large inheritance hierarchies. Code stays loosely coupled: a function depends only on the exact behavior it uses, third-party types slot into your interfaces without modification, and tests substitute fakes trivially. The price is that the implements-relationship lives in the type checker rather than on the page — a tradeoff Go makes consistently in favor of flexibility and small, composable contracts.

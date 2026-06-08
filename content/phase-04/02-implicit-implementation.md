---
id: implicit-implementation
phase: 4
phase_title: Interfaces (Core Abstraction)
sequence: 2
title: Implicit Implementation
---

## Description

### Concept Overview

In Go, a type satisfies an interface simply by **having the right methods**. There is no `implements` keyword, no `: IShape` syntax, no declaration of intent. If your type has a method `Area() float64` and a method `Perimeter() float64`, then it satisfies any interface that lists exactly those two methods — automatically, silently, and without the type or the interface ever referencing each other.

This is called **implicit (or structural) interface satisfaction**, and it is one of Go's defining design choices. The relationship between a type and an interface is discovered by the compiler from the *shape* of the type's method set, not declared by the programmer. A type can satisfy an interface that did not exist when the type was written. An interface can be satisfied by a type defined in a package that has never imported the interface.

The practical consequence is profound: **interfaces belong to the code that uses them, not the code that implements them.** The consumer of a behavior defines a small interface describing exactly what it needs, and any existing type with those methods slots in for free.

### Technical Explanation

Consider a concrete type with a method and an interface that lists that method:

```go
type Stringer interface {
    String() string
}

type Point struct{ X, Y int }

func (p Point) String() string {
    return fmt.Sprintf("(%d, %d)", p.X, p.Y)
}
```

`Point` never mentions `Stringer`. `Stringer` never mentions `Point`. Yet `Point` satisfies `Stringer`, because `Point`'s method set includes a `String() string` method. The compiler verifies this *at the assignment site*:

```go
var s Stringer = Point{1, 2} // checked here: does Point have String() string? yes.
```

**Satisfaction is checked structurally, method by method.** The compiler asks: for every method the interface requires, does the concrete type's method set contain a method with the *same name and identical signature*? Identical means the parameter types and result types match exactly — `String() string` is not satisfied by `String() (string, error)`.

**The standard library is built on this.** `fmt.Stringer`, `io.Reader`, `io.Writer`, `sort.Interface`, `error` — none of them require you to register or declare anything. The `fmt` package checks at runtime whether the value you pass implements `Stringer`; if it does, it calls `String()`. Your type "just works" with `fmt.Println` the moment you add the method.

**A compile-time satisfaction assertion** is an idiom worth knowing. Because satisfaction is implicit, you sometimes want a guarantee that a type *does* implement an interface, surfaced as a build error if it ever drifts:

```go
var _ Stringer = Point{}     // value satisfies Stringer
var _ Stringer = (*Point)(nil) // *Point satisfies Stringer
```

This declares a throwaway variable of the interface type and assigns the concrete type to it. It compiles only if satisfaction holds, and is erased by the compiler otherwise.

**Implicit satisfaction interacts with method sets.** A value `T` satisfies an interface if value-receiver methods cover it. A pointer `*T` additionally gets pointer-receiver methods. So `*Point` always satisfies anything `Point` satisfies, but not vice versa.

### Design Rationale

The contrast with nominal languages is stark.

In **Java**, you must write `class Point implements Comparable<Point>`. If a third-party library defines a `JsonSerializable` interface and you want your existing class to be serializable, you must edit the class to add `implements JsonSerializable` — and if you do not own the class, you cannot. You write an adapter instead.

In **C#**, the same nominal constraint applies: `class Point : IComparable`. **C++** uses abstract base classes with virtual functions, and your class must inherit from them. **TypeScript** is the closest relative — it uses structural typing too, so an object literal satisfies an interface by shape. But TypeScript's structural checks are erased at runtime, whereas Go's interface values carry real runtime type information and dispatch dynamically.

Go's designers chose implicit satisfaction to **invert the dependency**. With nominal typing, the implementer must know about every interface it might satisfy, creating tight coupling from the bottom of the dependency graph upward. With structural typing, the implementer knows nothing; the *consumer* defines the interface. This means:

- You can define an interface that matches types you do not own (from the standard library, from third-party code) and use them polymorphically.
- You can make a package depend only on a tiny local interface, not on a heavy concrete dependency — the essence of dependency inversion, achieved without a framework.
- Interfaces can be added *after the fact*, retrofitting abstraction onto code that was written concretely.

The cost is that the type–interface relationship is not written down at the implementer. Go accepts this and provides the `var _ Iface = T{}` idiom for cases where an explicit, enforced statement of intent is genuinely valuable.

### Common Mistakes

**Expecting an `implements` keyword.** Newcomers from Java or C# look for where to declare that a type implements an interface, and there is nowhere to write it. The answer is: you do not. Just write the methods. The absence feels unsettling at first.

**Subtle signature mismatches that silently fail satisfaction.** Because there is no declaration, a typo in a method signature does not produce an "incomplete implementation" error at the *method*. It produces a "does not implement" error far away, at the *assignment site* — and sometimes no error at all if you never assign to the interface. Writing `Write(p []byte) int` instead of `Write(p []byte) (int, error)` means your type silently fails to satisfy `io.Writer`, and you discover it only when you try to use it as one.

**Forgetting the compile-time assertion for library types.** If you write a type intended to implement `io.Writer` but only ever use it through concrete calls, a signature drift will not be caught until a consumer tries to use it as a `Writer`. Adding `var _ io.Writer = (*MyType)(nil)` turns that latent bug into an immediate build error.

**Confusing implicit satisfaction with duck typing in dynamic languages.** Python's duck typing is checked at *runtime*: if the method is missing, you get an `AttributeError` when you call it. Go's structural satisfaction is checked at *compile time* at every interface assignment. It is statically safe — you cannot accidentally pass a value that lacks the methods.

**Assuming `*T` and `T` are interchangeable for satisfaction.** A value `T` does not get pointer-receiver methods. If only `*T` satisfies the interface, you must pass `&value`, not `value`. The implicit nature of satisfaction does not relax the method-set rules.

### Key Takeaways

- A type satisfies an interface by having the matching methods — no `implements` keyword, no declaration, no import relationship.
- Satisfaction is structural and checked at compile time at each interface assignment, making it statically safe (unlike dynamic duck typing).
- Interfaces belong to the consumer: define a small interface where a behavior is *used*, and existing types satisfy it for free.
- Method signatures must match exactly; a subtle mismatch silently breaks satisfaction and surfaces as a confusing error far from the method.
- Use `var _ Iface = (*T)(nil)` as a compile-time assertion to lock in and document that a type implements an interface.
- The standard library's `Stringer`, `Reader`, `Writer`, and `error` all work through this mechanism — add the method and your type participates automatically.

---

## Broken Code

```go
// broken: the author THINKS Notifier is implemented, but a subtle signature
// mismatch means Email never satisfies it. There is no "implements" keyword
// to catch the mistake, so the failure surfaces far from the method.
package main

import "fmt"

type Notifier interface {
    Notify(message string) error
}

type Email struct {
    To string
}

// Bug: the signature is Notify(string) — it returns nothing, but Notifier
// requires Notify(string) error. Close, but NOT identical, so Email does
// not satisfy Notifier. Nothing here flags the error; it appears later.
func (e Email) Notify(message string) {
    fmt.Printf("emailing %s: %s\n", e.To, message)
}

func send(n Notifier, msg string) {
    n.Notify(msg)
}

func main() {
    // Compile error happens HERE, not at the method:
    //   Email does not implement Notifier
    //   (wrong type for method Notify: have func(string), want func(string) error)
    send(Email{To: "a@b.com"}, "hello")
}
```

---

## Correct Code

```go
// correct: implicit satisfaction done right, plus a compile-time assertion
// that locks in the contract so future signature drift fails the build.
package main

import (
	"errors"
	"fmt"
)

// Notifier is defined by the CONSUMER (the dispatch logic) describing exactly
// the behavior it needs. Implementers never reference this interface.
type Notifier interface {
	Notify(message string) error
}

type Email struct {
	To string
}

// Signature matches Notifier exactly: same name, same params, same results.
func (e Email) Notify(message string) error {
	if e.To == "" {
		return errors.New("email: empty recipient")
	}
	fmt.Printf("email -> %s: %s\n", e.To, message)
	return nil
}

type SMS struct {
	Number string
}

func (s SMS) Notify(message string) error {
	if s.Number == "" {
		return errors.New("sms: empty number")
	}
	fmt.Printf("sms   -> %s: %s\n", s.Number, message)
	return nil
}

// Compile-time assertions: these lines fail to build if Email or SMS ever
// stop satisfying Notifier. This is how Go makes implicit intent explicit.
var (
	_ Notifier = Email{}
	_ Notifier = SMS{}
)

// send depends ONLY on the small Notifier interface, not on concrete types.
func send(n Notifier, msg string) {
	if err := n.Notify(msg); err != nil {
		fmt.Println("send failed:", err)
	}
}

func main() {
	notifiers := []Notifier{
		Email{To: "ada@example.com"},
		SMS{Number: "+15551234"},
		Email{To: ""}, // triggers the error path
	}

	for _, n := range notifiers {
		send(n, "deploy finished")
	}
}
```

---

## Explanation

The broken version is a textbook illustration of why implicit satisfaction shifts *where* errors appear. The author intended `Email` to implement `Notifier`, and at a glance it looks correct — there is a `Notify` method that takes a `string`. But the interface requires `Notify(string) error`, and the method returns nothing. Because Go has no `implements` keyword, the compiler has no place to check "did you correctly implement everything you promised?" at the method definition. The mismatch is only discovered at the *use site*, when `Email{}` is passed where a `Notifier` is expected, producing an error that points at `send(...)` rather than at the flawed method. For large programs, that error can land far from its cause.

The correct version repairs the signature so it matches `Notifier` exactly, and then adds the crucial defensive idiom: `var _ Notifier = Email{}`. These throwaway assignments do nothing at runtime — they are erased — but they force the compiler to verify satisfaction *right next to the type*, turning any future signature drift into an immediate, local build failure. This restores some of the explicitness that nominal languages get for free, while keeping Go's decoupling.

Notice also how `Notifier` is defined by the *consumer*: the `send` function and the dispatch loop are what need the behavior, so the interface lives with them. `Email` and `SMS` know nothing about `Notifier`; they merely happen to have a matching method. Adding a third notifier later requires zero changes to `send` and zero references to the interface from the new type — the hallmark of implicit, structural satisfaction.

---

## Design Tradeoff

Implicit satisfaction trades *locality of error reporting* and *written-down intent* for *decoupling* and *retroactive abstraction*. In a nominal language, forgetting or mistyping a method yields an error at the class declaration — "you said you implement this interface but you don't" — right where the mistake lives. Go cannot offer that by default, because the type never claimed anything; the error necessarily surfaces at the point of use, which can be distant and initially confusing.

What Go buys in return is dependency inversion without ceremony. Consumers define the narrow interfaces they need, and any type — including ones from packages you cannot modify — satisfies them automatically. There is no edit-the-class-to-add-implements problem, no adapter boilerplate, no coupling from implementers up to interface definitions. The `var _ Iface = T{}` assertion lets you opt back into local, enforced intent exactly where it matters, so in practice you get the best of both worlds: loose coupling everywhere, with explicit guarantees wherever you choose to ask for them.

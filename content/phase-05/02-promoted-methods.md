---
id: promoted-methods
phase: 5
phase_title: Composition over Inheritance
sequence: 2
title: Promoted Methods
---

## Description

### Concept Overview

When you embed a type in a struct, the embedded type's **methods are promoted** to the outer struct. You can call them directly on the outer value, without naming the embedded field. More importantly, those promoted methods become part of the outer type's **method set** — which means the outer type can satisfy the same interfaces that the embedded type satisfies. This is how Go achieves the most powerful effect that inheritance gives in other languages — reusing behavior and slotting into existing abstractions — without ever introducing a type hierarchy.

But method promotion has precise rules. Whether a method is promoted, and whether it lands in the value method set or only the pointer method set, depends on the receiver type of the method and on whether you embedded by value or by pointer. Getting these rules wrong leads to the classic, baffling Go error: "type does not implement interface" even though the method "obviously" exists. This kata makes those rules concrete.

### Technical Explanation

A **method set** is the collection of methods that can be called on a given type, and it is exactly the set of methods used to decide interface satisfaction. There are two method sets for any type `T`:

- The method set of `T` (the value): includes all methods with **value receivers**.
- The method set of `*T` (the pointer): includes methods with **value receivers and pointer receivers**.

Promotion layers on top of this. Suppose `Outer` embeds `Inner`:

```go
type Inner struct{ name string }

func (i Inner) Describe() string  { return "inner: " + i.name } // value receiver
func (i *Inner) Rename(n string)  { i.name = n }                // pointer receiver
```

The promotion rules, depending on how you embed:

| Embedding | Promoted into method set of `Outer` (value) | Promoted into method set of `*Outer` (pointer) |
|-----------|---------------------------------------------|------------------------------------------------|
| `Inner` (value) | value-receiver methods of `Inner` | value- **and** pointer-receiver methods of `Inner` |
| `*Inner` (pointer) | value- **and** pointer-receiver methods of `Inner` | value- **and** pointer-receiver methods of `Inner` |

Read the table carefully. If you embed `Inner` **by value**, then `Rename` (a pointer-receiver method) is promoted only to `*Outer`, not to `Outer`. So a *value* of type `Outer` does **not** have `Rename` in its method set — and if some interface requires `Rename`, an `Outer` value will not satisfy it, while an `*Outer` will. If you embed `*Inner` **by pointer**, both `Describe` and `Rename` are promoted into both method sets, because a pointer receiver is always reachable through the embedded pointer.

**Promotion and interface satisfaction.** This is where promotion earns its keep:

```go
type Describer interface {
    Describe() string
}

type Outer struct {
    Inner // embedded
}

var d Describer = Outer{Inner{name: "x"}} // works: Describe is promoted
```

`Outer` never declares `Describe`, yet `Outer` satisfies `Describer` because the promoted `Describe` is in `Outer`'s method set. The interface check is performed on the method set *after* promotion.

**Overriding by re-declaring.** If `Outer` declares its own method with the same name and signature, that method **shadows** the promoted one. Calls to `outer.Describe()` use `Outer`'s version. Critically, this is *not* virtual dispatch: if a promoted `Inner` method internally calls `i.Describe()`, it calls `Inner.Describe`, **not** the outer override — because the receiver is the embedded `Inner`, which knows nothing about the `Outer` that wraps it. There is no `super`, and there is no upward dispatch.

```go
func (o Outer) Describe() string { return "outer override" }
// o.Describe() -> "outer override"
// o.Inner.Describe() -> "inner: ..."  (still reachable explicitly)
```

**Addressability and value receivers.** To call a pointer-receiver method (promoted or not), the receiver must be **addressable**. A value stored in a variable is addressable; a value returned from a function or read from a map is not. So `m["k"].Rename(...)` where the value is a struct with a pointer-receiver method is a compile error, even with promotion in play.

### Design Rationale

In Java, C++, or Python, inheritance gives a subclass two things at once: structural reuse (the base fields and methods) and substitutability (the subclass *is* the base, so it fits anywhere the base fits, with virtual dispatch routing calls to the most-derived override). Go deliberately splits these two concerns apart. **Embedding with method promotion** provides structural reuse. **Interfaces** provide substitutability. They are independent mechanisms, and you compose them as needed.

This split is what lets Go avoid virtual dispatch entirely while still feeling expressive. A promoted method is resolved *statically* — the compiler knows at compile time which concrete method runs and on which embedded receiver. There is no vtable lookup for promoted calls and no surprising "the override I forgot about got called instead." When a promoted `Inner` method calls another `Inner` method, it stays within `Inner`. In Java, the same pattern would dispatch back up to the subclass override (the "template method" behavior), which is powerful but a frequent source of fragile-base-class bugs where a base method's behavior silently changes because a subclass overrode a helper it calls.

Go's method-set rules — the distinction between the method set of `T` and of `*T` — also flow from the language's value semantics. A value receiver gets a *copy*; a pointer receiver can *mutate*. If pointer-receiver methods were always in the value method set, you could call a mutating method on a copy and silently lose the mutation. By keeping pointer-receiver methods out of the value method set, Go forces you to hold an addressable pointer when you intend to mutate — making the value/pointer decision visible at the call site and in interface satisfaction.

The tradeoff Go accepts is a steeper initial learning curve: newcomers hit "does not implement interface (Rename method has pointer receiver)" and are baffled. But once internalized, the rules are mechanical and never surprising, which is exactly the property Go optimizes for.

### Common Mistakes

**Embedding by value but needing pointer-receiver methods in the value's method set.** If `Rename` has a pointer receiver and you embed `Inner` by value, an `Outer` *value* does not satisfy an interface requiring `Rename`. The fix is to use a `*Outer` (take the address) or embed `*Inner`. The compiler error names the offending method's pointer receiver, but beginners rarely connect it to promotion.

**Expecting virtual dispatch / `super` behavior.** Overriding a promoted method by re-declaring it does not make promoted methods call the override. There is no upcall. If you rely on a promoted method invoking your override, your design assumes inheritance semantics Go does not have.

**Calling a pointer-receiver method on a non-addressable value.** Map elements and function return values are not addressable. Even with promotion, `things["a"].Rename("b")` fails to compile when `Rename` needs a pointer receiver. The value must live in an addressable variable first.

**Nil embedded pointer with promoted methods.** Embedding `*Inner` promotes its methods, but if the embedded pointer is `nil`, calling a promoted method dereferences nil and panics. Promotion makes the call look like it belongs to the outer type, hiding the nil hazard.

**Ambiguous promoted methods from two embeddings.** If `Outer` embeds two types that each define `Describe` at the same depth, `outer.Describe()` is a compile error (ambiguous selector), and — subtly — `Outer` then satisfies an interface requiring `Describe` only if you declare an explicit `Describe` on `Outer` to resolve the ambiguity.

### Key Takeaways

- Promoted methods become part of the outer type's method set, which is what lets the outer type satisfy interfaces the embedded type satisfies.
- Embedding by value promotes pointer-receiver methods only into the `*Outer` method set, not the `Outer` value method set; embedding by pointer promotes both kinds into both.
- Interface satisfaction is decided on the method set *after* promotion — the outer type need not declare the method itself.
- Re-declaring a method on the outer type shadows the promoted one, but there is no virtual dispatch or `super`: a promoted method that calls a sibling method stays within the embedded type.
- Pointer-receiver methods (promoted or not) require an addressable receiver; map elements and function results are not addressable.
- Ambiguous same-depth promotions are compile errors at the point of use and must be resolved by declaring the method explicitly on the outer type.

---

## Broken Code

```go
// broken: value embedding hides a pointer-receiver method from the
// value method set, so Outer does not satisfy the interface
package main

import "fmt"

type Counter struct {
    count int
}

// Pointer receiver: this method mutates, so it is in *Counter's method set.
func (c *Counter) Increment() {
    c.count++
}

func (c Counter) Value() int {
    return c.count
}

type Incrementer interface {
    Increment()
}

type Widget struct {
    Counter // embedded BY VALUE
    Name    string
}

func main() {
    w := Widget{Name: "gauge"}

    // broken: Increment has a pointer receiver, and Counter is embedded
    // by value, so Increment is NOT in Widget's (value) method set.
    // A Widget value does not satisfy Incrementer.
    var inc Incrementer = w
    inc.Increment()

    fmt.Println(w.Value())
}
```

---

## Correct Code

```go
// correct: promotion, method sets, interface satisfaction, and the
// absence of virtual dispatch — all made explicit
package main

import "fmt"

type Counter struct {
    count int
}

func (c *Counter) Increment() { c.count++ }
func (c Counter) Value() int  { return c.count }

type Incrementer interface {
    Increment()
}

type Describer interface {
    Describe() string
}

func (c Counter) Describe() string {
    return fmt.Sprintf("counter=%d", c.count)
}

type Widget struct {
    Counter // embedded by value
    Name    string
}

// Widget overrides the promoted Describe by re-declaring it.
// This SHADOWS Counter.Describe; it is NOT virtual dispatch.
func (w Widget) Describe() string {
    return fmt.Sprintf("widget %q [%s]", w.Name, w.Counter.Describe())
}

func main() {
    w := Widget{Name: "gauge"}

    // Increment has a pointer receiver. Because Counter is embedded by
    // value, Increment is promoted into *Widget's method set — so we
    // satisfy Incrementer with a *pointer* to an addressable Widget.
    var inc Incrementer = &w
    inc.Increment()
    inc.Increment()

    // Value() has a value receiver, so it is promoted to Widget's value
    // method set and is callable directly.
    fmt.Println("value:   ", w.Value()) // 2

    // Describe on Widget shadows the promoted one. Calling through the
    // Describer interface uses Widget's version (chosen statically).
    var d Describer = w
    fmt.Println("describe:", d.Describe())

    // The embedded method is still reachable explicitly — no override
    // hides it, because there is no hierarchy, only a real field.
    fmt.Println("inner:   ", w.Counter.Describe())

    // Calling the promoted pointer-receiver method directly works
    // because w is an addressable variable (Go takes its address).
    w.Increment()
    fmt.Println("value:   ", w.Value()) // 3
}
```

---

## Explanation

The broken version fails to compile with a message like "Widget does not implement Incrementer (Increment method has pointer receiver)." The cause is the method-set rule: `Increment` has a pointer receiver, so it lives in the method set of `*Counter`, not `Counter`. When `Counter` is embedded **by value**, that pointer-receiver method is promoted only into the method set of `*Widget`, never into the value method set of `Widget`. Therefore a `Widget` *value* does not satisfy `Incrementer`, and `var inc Incrementer = w` is rejected.

The correct version fixes this by assigning `&w` — a `*Widget` — to the interface. Because `w` is an addressable variable, taking its address is legal, and `*Widget`'s method set includes the promoted `Increment`. The mutation now persists, and `w.Value()` reflects it.

The kata also demonstrates the absence of virtual dispatch. `Widget` re-declares `Describe`, which *shadows* the promoted `Counter.Describe`. When we call `d.Describe()` through the `Describer` interface holding a `Widget`, we get `Widget`'s version — chosen by the static method set, not by any runtime hierarchy. Crucially, `Widget.Describe` explicitly calls `w.Counter.Describe()` to reach the inner behavior; nothing happens automatically. There is no `super`, and the embedded method, when called on its own, knows nothing about the `Widget` wrapping it. Finally, calling `w.Increment()` directly works because `w` is addressable, letting Go implicitly take `&w` to invoke the pointer-receiver method.

---

## Design Tradeoff

Method promotion gives you behavioral reuse and interface satisfaction without a class hierarchy, but it asks you to internalize Go's method-set rules — especially the value-versus-pointer asymmetry. The payoff is that method resolution is entirely static and predictable: you can always tell, by reading the receiver types and the embedding form, exactly which method runs and whether a type satisfies an interface. There are no vtables, no `super` chains, and no fragile-base-class surprises where overriding a helper silently rewires a base method's behavior.

The cost is the friction newcomers feel at the "does not implement interface" wall and the need to think deliberately about whether you hold a value or a pointer. Go accepts that friction on purpose. By making the value/pointer choice visible in method sets and interface satisfaction, the language keeps mutation explicit and keeps polymorphism (via interfaces) cleanly separated from reuse (via embedding). When you want substitutability, define a small interface and let promotion fill its method set; when you want shared behavior, embed. Keeping those tools distinct is what makes composition in Go both powerful and boringly predictable — exactly the property the language prizes.

---
id: struct-embedding
phase: 5
phase_title: Composition over Inheritance
sequence: 1
title: Struct Embedding
---

## Description

### Concept Overview

Go has no classes and no inheritance. Instead, Go gives you **struct embedding** — a mechanism for building larger types out of smaller ones by declaring a struct field with no name, only a type. When you embed one struct inside another, the embedded struct's fields and methods become accessible on the outer struct as if they were declared there directly. This is called **field promotion** and **method promotion**.

Embedding looks superficially like inheritance, and that resemblance is the single most dangerous thing about it. Embedding is **composition**: the outer type *has a* embedded value, not *is a* subtype of it. The embedded value is a real, addressable field that you can reach explicitly. Go simply offers syntactic convenience that lets you skip naming that field when you access what it contains. Understanding this distinction — that embedding is sugar over a plain "has-a" field — is the foundation for everything else in this phase.

### Technical Explanation

You embed a type by writing the type name as a field with no field name:

```go
type Engine struct {
    Horsepower int
}

func (e Engine) Start() string {
    return "engine started"
}

type Car struct {
    Engine // embedded — no field name, just the type
    Brand  string
}
```

The embedded field's *name* is the unqualified type name. So inside `Car`, the embedded `Engine` is accessible as the field `Engine`:

```go
c := Car{Engine: Engine{Horsepower: 250}, Brand: "Tesla"}

fmt.Println(c.Horsepower)     // promoted field access
fmt.Println(c.Engine.Horsepower) // explicit access — identical result
fmt.Println(c.Start())        // promoted method
fmt.Println(c.Engine.Start()) // explicit method call — identical result
```

Both `c.Horsepower` and `c.Engine.Horsepower` refer to *the same memory*. Promotion is not copying or flattening — it is a lookup rule. When you write `c.Horsepower`, the compiler searches the outer struct's own fields first; if no field named `Horsepower` exists there, it descends one level into embedded fields and finds it on `Engine`.

You can embed several types, and you can embed by pointer:

```go
type Logger struct{ prefix string }

type Service struct {
    *Logger // embedded pointer
    Engine  // embedded value
    Name    string
}
```

The promotion rules for value embedding versus pointer embedding:

| Embedding form | Storage | Promoted access | Notes |
|----------------|---------|-----------------|-------|
| `Engine` (value) | inline in outer struct | `outer.Field`, `outer.Method()` | copies move the whole embedded value |
| `*Engine` (pointer) | a pointer field | same syntax | embedded pointer can be `nil` — promoted access panics |

**Depth and shadowing.** Promotion happens at the *shallowest depth*. If the outer struct declares its own field named `Horsepower`, that field wins and the embedded one is **shadowed** — you must use `c.Engine.Horsepower` to reach the inner one. If two embedded types at the *same depth* both have a `Horsepower`, the reference is **ambiguous** and the compiler rejects the bare `c.Horsepower` — you must qualify it. The compiler only complains about ambiguity when you actually use the ambiguous selector, not at declaration time.

**Initialization.** In a composite literal, you initialize an embedded field using the type name as the key: `Car{Engine: Engine{...}}`. You cannot use the inner field names directly in the outer literal — `Car{Horsepower: 250}` is a compile error, because promotion applies to *selectors* (`x.Field`), not to *literal keys*.

### Design Rationale

Classical object-oriented languages — Java, C++, Python — give you inheritance: a subclass automatically *is a* kind of its superclass, inheriting state and behavior down a hierarchy. This creates tight coupling. A change to a base class ripples into every subclass, and the infamous "fragile base class problem" makes deep hierarchies brittle. C++ adds multiple inheritance, which brings the "diamond problem" and virtual base classes — complexity that the language has to solve for you with elaborate rules.

Go's designers deliberately rejected inheritance. Russ Cox and the Go team observed that the vast majority of inheritance in real codebases is used for *code reuse*, not for genuine subtyping — and code reuse is better served by composition. So Go offers embedding: you get the convenience of reaching an inner type's fields and methods without qualification, but you never get an *is-a* relationship. A `Car` is not an `Engine`. You cannot pass a `Car` where an `Engine` is expected (unless `Car` satisfies the same interface — and that happens through method sets, not through a type hierarchy).

Compared to **Java**, where `class Car extends Engine` would be both semantically wrong and structurally limiting (single inheritance, so `Car` can extend only one class), Go lets you embed as many types as you like, and the relationship stays honest: it is always "has-a." Compared to **C++**'s multiple inheritance, Go sidesteps the diamond problem by making ambiguity a *compile error you resolve explicitly*, rather than a silent resolution governed by virtual-base rules. Compared to **Python**'s MRO (method resolution order), Go has no linearization algorithm to memorize — the rule is simply "shallowest unambiguous match wins."

The result is a language where reuse is explicit, relationships are flat, and there is no hidden machinery deciding which method runs.

### Common Mistakes

**Treating embedding as inheritance (`is-a` thinking).** The most common error is believing that embedding `Engine` in `Car` makes `Car` a subtype of `Engine`. It does not. There is no polymorphic substitution between the outer and embedded *concrete* types. If your design depends on "a Car is an Engine," you are modeling the wrong relationship — and you will be surprised when you cannot assign a `Car` to an `Engine` variable.

**Forgetting to initialize an embedded pointer.** When you embed `*Logger` and leave it `nil`, any promoted access (`s.prefix` or a promoted method) dereferences a nil pointer and panics at runtime. The compiler will not catch this — promotion makes the call look safe. Embedded pointers must be initialized before promoted access, exactly like any other pointer.

**Expecting promotion in composite literals.** Writing `Car{Horsepower: 250}` does not compile. Promotion only applies to field/method *selection* (`car.Horsepower`), never to literal keys. You must write `Car{Engine: Engine{Horsepower: 250}}`.

**Silently shadowing a field.** If the outer struct declares a field with the same name as a promoted one, the inner field is shadowed without any warning. Code that meant to read the inner value will quietly read the outer one. This is legal and sometimes intentional, but it is a frequent source of "why is this value wrong?" bugs.

**Assuming ambiguity is reported at declaration.** Embedding two types that both have a `Name` field compiles fine. The error only appears when you write the ambiguous selector `s.Name`. Developers sometimes assume the struct itself is invalid and waste time looking in the wrong place.

### Key Takeaways

- Embedding is a struct field declared with a type but no name; it gives you composition with promoted access, not inheritance.
- Promoted fields and methods refer to the *same memory* as the embedded value — promotion is a lookup rule, not flattening or copying.
- The embedded field's name is its unqualified type name, so you can always reach it explicitly (`outer.Engine.Field`).
- Promotion resolves at the shallowest depth; an outer field shadows an inner one, and same-depth duplicates are an ambiguity error reported only at the point of use.
- Embedded pointers can be `nil`; promoted access through a nil embedded pointer panics at runtime.
- In composite literals you initialize an embedded field by its type name (`Car{Engine: Engine{...}}`); promotion does not apply to literal keys.

---

## Broken Code

```go
// broken: this treats embedding as inheritance and misuses literals
package main

import "fmt"

type Engine struct {
    Horsepower int
}

func (e Engine) Start() string {
    return "engine started"
}

type Car struct {
    Engine
    Brand string
}

func main() {
    // broken: promotion does NOT work in composite literals
    c := Car{Horsepower: 250, Brand: "Tesla"}

    // broken: a Car is NOT an Engine — there is no is-a relationship,
    // so this assignment does not compile
    var e Engine = c

    fmt.Println(e.Start())
}
```

---

## Correct Code

```go
// correct: embedding as composition with explicit, honest access
package main

import "fmt"

type Engine struct {
    Horsepower int
}

func (e Engine) Start() string {
    return fmt.Sprintf("engine started (%d hp)", e.Horsepower)
}

// Logger is embedded by pointer to show nil-safety requirements.
type Logger struct {
    prefix string
}

func (l *Logger) Log(msg string) string {
    return l.prefix + ": " + msg
}

type Car struct {
    Engine          // embedded value — Car HAS an Engine, it is not one
    *Logger         // embedded pointer — must be initialized before use
    Brand string
}

func main() {
    // Initialize embedded fields by their type name as the literal key.
    c := Car{
        Engine: Engine{Horsepower: 250},
        Logger: &Logger{prefix: "car"},
        Brand:  "Tesla",
    }

    // Promoted field access: c.Horsepower and c.Engine.Horsepower
    // name the same memory.
    fmt.Println("brand:        ", c.Brand)
    fmt.Println("promoted hp:  ", c.Horsepower)
    fmt.Println("explicit hp:  ", c.Engine.Horsepower)

    // Promoted methods read just like methods declared on Car.
    fmt.Println(c.Start())          // promoted from Engine
    fmt.Println(c.Log("ready"))     // promoted from *Logger

    // Mutating through the promoted field mutates the embedded value.
    c.Horsepower = 300
    fmt.Println("after change: ", c.Engine.Horsepower) // 300

    // The honest relationship: we can reach the embedded value directly,
    // because it is a real field — not a hidden base class.
    var e Engine = c.Engine
    fmt.Println("extracted:    ", e.Start())
}
```

---

## Explanation

The broken version makes two classic mistakes at once. First, `Car{Horsepower: 250, Brand: "Tesla"}` assumes that field promotion extends into composite literals. It does not. Promotion is a rule about *selecting* fields and methods on an existing value (`c.Horsepower`), not about how you write the literal. The literal must initialize the embedded `Engine` by its type-name key: `Engine: Engine{Horsepower: 250}`. Second, `var e Engine = c` assumes that embedding creates an *is-a* relationship — that a `Car` can stand in for an `Engine`. Go has no such relationship between concrete types. A `Car` *contains* an `Engine`; it is not a subtype of one. The assignment is a compile error.

The correct version models the same data as honest composition. The literal initializes each embedded field by its type name. Field access shows the central truth: `c.Horsepower` and `c.Engine.Horsepower` are the same memory, so mutating one is visible through the other. Methods like `Start` and `Log` are promoted and read as if they belonged to `Car`, yet they still run with the embedded value as their receiver.

The `*Logger` embedding demonstrates the nil-safety obligation: because it is a pointer, we must initialize it (`Logger: &Logger{...}`) before any promoted call, or `c.Log(...)` would dereference nil and panic. Finally, `var e Engine = c.Engine` shows the legitimate way to obtain the inner type — by reaching the real, addressable field — rather than pretending the outer type *is* the inner one.

---

## Design Tradeoff

Embedding trades the familiarity of inheritance for honesty and flatness. You give up the ability to say "a Car is an Engine" and to substitute one for the other polymorphically through a type hierarchy. In exchange, you get reuse without coupling: the outer type borrows the inner type's fields and methods for convenience, but the relationship never becomes a subtype contract that ripples changes downward through a hierarchy. There is no fragile base class, no diamond problem, and no method-resolution algorithm to memorize.

The cost is that the convenience of promotion can *look* like inheritance, tempting you to model "is-a" relationships with embedding. When you feel that pull, stop and ask whether you actually need substitutability — and if so, reach for an **interface** (behavior-based polymorphism) rather than embedding (structure-based reuse). Embedding answers "what does this type contain and reuse?"; interfaces answer "what can this type do?" Keeping those two questions separate is the heart of composition over inheritance, and the rest of this phase builds on it.

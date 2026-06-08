---
id: avoiding-inheritance-thinking
phase: 5
phase_title: Composition over Inheritance
sequence: 4
title: Avoiding Inheritance-Style Thinking
---

## Description

### Concept Overview

By now you can embed structs, promote methods, and assemble types from small parts. The hardest part of writing idiomatic Go is not learning these mechanics — it is *unlearning* the inheritance habits that other languages trained into you. Go has no classes, no `extends`, no `super`, no `virtual`, no abstract base classes, and no protected members. When you try to recreate those concepts with embedding and interfaces, you produce code that looks like Go but thinks like Java, and it fights the language at every turn.

This kata is about recognizing and dropping four inheritance reflexes: building deep type hierarchies, expecting `super`-style upcalls, designing abstract base classes, and using embedding to model *is-a* relationships. For each, there is an idiomatic Go alternative — usually a small interface, explicit delegation, or a flat composition. The goal is to internalize the mantra: **accept interfaces, return structs; model behavior, not lineage; prefer flat assembly over deep trees.**

### Technical Explanation

**There is no `super`.** In Java, an overriding method calls `super.method()` to invoke the parent's version. Go has no such keyword because there is no parent. If an outer type re-declares a promoted method, the embedded version is still reachable — but only by *explicit* qualification, and you must opt in:

```go
type Base struct{}
func (Base) Greet() string { return "hello" }

type Loud struct{ Base }
func (l Loud) Greet() string {
    return strings.ToUpper(l.Base.Greet()) // explicit delegation, not super
}
```

This is delegation by name (`l.Base.Greet()`), not an implicit upcall. The relationship is visible in the code.

**There is no virtual dispatch across embedding.** In Java, a base-class method that calls `this.helper()` dispatches to the *subclass* override of `helper` (the template-method pattern). In Go, a promoted `Base` method that calls a sibling method calls `Base`'s version — the embedded value has no knowledge of the `Loud` wrapping it. To get template-method behavior, you invert the design: define the variable step as an **interface** and inject it.

```go
type Step interface{ Do() string }

type Pipeline struct{ step Step } // the variable step is injected
func (p Pipeline) Run() string { return "before-" + p.step.Do() + "-after" }
```

Now `Run` calls whatever `Step` you composed in — polymorphism through an interface field, not through a class hierarchy.

**Abstract base classes become interfaces.** Java's abstract class bundles shared state, concrete helpers, and abstract methods. Go splits that bundle:

| Java abstract-class part | Idiomatic Go equivalent |
|--------------------------|--------------------------|
| abstract methods (the contract) | a small `interface` |
| concrete shared helpers | a struct with methods, embedded or held as a field |
| shared state/fields | a struct holding that state, injected |
| `protected` members | unexported fields in the same package |

**Is-a becomes behaves-as.** Go never asks "is X a kind of Y?" It asks "can X do what this function needs?" A function should accept the **smallest interface** describing the behavior it uses, and any type that has those methods qualifies — implicitly, with no declared relationship:

```go
func PrintAll(w io.Writer, lines []string) error {
    for _, l := range lines {
        if _, err := fmt.Fprintln(w, l); err != nil {
            return err
        }
    }
    return nil
}
```

`PrintAll` works with a file, a buffer, a network connection, or a test spy — none of which share an ancestor. They merely *behave as* writers.

**Flat over deep.** Inheritance encourages five-level trees (`Animal → Mammal → Carnivore → Feline → Cat`). Go encourages flat types that embed or reference exactly the one or two parts they need. There is no benefit to depth in Go and real cost: each embedding level adds promotion-ambiguity risk and obscures where behavior comes from.

### Design Rationale

Inheritance conflates several distinct ideas into one mechanism: subtyping (substitutability), code reuse, and dynamic dispatch. Decades of experience — captured in the Gang of Four's "favor composition over inheritance" and in the litany of fragile-base-class war stories — showed that fusing these ideas produces tight coupling and brittle hierarchies. When a base class changes, every subclass is at risk. When you need behavior from two bases, single inheritance blocks you. When a base method calls an overridable helper, subclasses can break it from a distance. Go's designers had lived these problems and chose to *not provide the mechanism that causes them.*

Instead Go offers the three ideas separately and lets you combine only what you need. Substitutability comes from **interfaces**, satisfied implicitly so you can make existing types fit contracts they were never declared against. Reuse comes from **composition** (embedding or named fields), with no hierarchy and therefore no fragile base. "Dynamic dispatch" comes only through interface values, and only for the methods in that interface — there is no surprising upward call into a wrapper. Because satisfaction is structural and implicit, Go also avoids the dependency inversion ceremony other languages need: a low-level package can satisfy a high-level package's interface without importing it or declaring any relationship.

This is why idiomatic Go advice is phrased as *behavior*: "accept interfaces, return structs." You return a concrete struct because callers want the full, real thing; you accept an interface because you want to use only the behavior you depend on and stay open to substitution. The whole design pushes you away from "what is this type?" and toward "what does this code need this value to do?" — which is the precise mental shift that "avoiding inheritance-style thinking" demands.

### Common Mistakes

**Recreating `super` with embedding and expecting implicit upcalls.** Overriding a promoted method does not make the embedded methods call your override. If your design needs the parent to call back into the child's behavior, you are reaching for template-method/virtual dispatch — invert it into an injected interface instead.

**Building deep embedding chains to share a little code.** Embedding three levels to reuse one helper method couples your type to a tower of structures and invites promotion ambiguity. Prefer a single small helper type as a field, or a free function, or a one-method interface.

**Designing an "abstract base struct" with unimplemented methods.** People write a `Base` struct with method stubs intending subtypes to "override" them. Go has no override mechanism, so the stubs just shadow silently or never get called. Use an interface for the contract and a separate struct for shared concrete behavior.

**Using embedding to assert is-a, then being unable to substitute.** Embedding `Animal` in `Dog` does not let you pass a `Dog` where an `Animal` is required (concrete types are not substitutable). If you need substitution, define an `Animal` *interface*; embedding the concrete type does not give you polymorphism.

**Designing fat interfaces to mirror a base class's full API.** Translating a 15-method abstract class into a 15-method interface defeats the purpose. Define many small interfaces and accept the narrowest one each function actually uses; let larger ones compose from smaller ones.

### Key Takeaways

- Go has no classes, `extends`, `super`, `virtual`, or abstract base classes — stop trying to recreate them with embedding.
- There is no implicit upcall or virtual dispatch across embedding; the embedded value never calls into the wrapper, so delegate explicitly (`outer.Inner.Method()`).
- For template-method-style polymorphism, inject an interface field rather than relying on a base method calling an overridden helper.
- Split a Java abstract class into an interface (the contract) plus a struct (shared concrete behavior and state) that you embed or inject.
- Model *behaves-as* (small interfaces, implicit satisfaction), not *is-a* (hierarchies); follow "accept interfaces, return structs."
- Prefer flat composition over deep embedding chains; depth adds ambiguity risk and hides where behavior originates, with no upside in Go.

---

## Broken Code

```go
// broken: this fakes a Java-style class hierarchy in Go — an "abstract"
// base struct, an expected super-call, and is-a substitution that Go
// does not support
package main

import "fmt"

// broken: an "abstract base" struct with a stub method meant to be
// "overridden" by subtypes. Go has no overriding or virtual dispatch.
type Animal struct {
    Name string
}

func (a Animal) Sound() string {
    return "..." // stub: expected to be "overridden"
}

// broken: Speak is meant to call the OVERRIDDEN Sound() of the subtype,
// Java template-method style. In Go it always calls Animal.Sound().
func (a Animal) Speak() string {
    return a.Name + " says " + a.Sound()
}

type Dog struct {
    Animal // pretending this is "Dog extends Animal"
}

// This does NOT override Animal.Sound for the promoted Speak — Speak
// still calls Animal.Sound, so a Dog "says ...".
func (d Dog) Sound() string {
    return "woof"
}

func main() {
    d := Dog{Animal{Name: "Rex"}}

    // Prints "Rex says ..." not "Rex says woof": no virtual dispatch.
    fmt.Println(d.Speak())

    // broken: a Dog is NOT an Animal subtype; this does not compile.
    var a Animal = d
    fmt.Println(a.Speak())
}
```

---

## Correct Code

```go
// correct: behavior via a small interface, explicit composition, and
// dependency injection instead of inheritance
package main

import (
    "fmt"
    "strings"
)

// The contract is an interface — the behavior, not a base class.
type Animal interface {
    Name() string
    Sound() string
}

// Speaker composes whatever Animal it is given. This replaces the
// "template method on a base class" with injection: Speak calls the
// injected behavior, achieving real polymorphism.
type Speaker struct {
    animal Animal
}

func (s Speaker) Speak() string {
    return fmt.Sprintf("%s says %s", s.animal.Name(), s.animal.Sound())
}

// Two concrete animals, with NO shared ancestor. They simply behave-as
// Animal by having the right methods.
type Dog struct{ name string }

func (d Dog) Name() string  { return d.name }
func (d Dog) Sound() string { return "woof" }

type Cat struct{ name string }

func (c Cat) Name() string  { return c.name }
func (c Cat) Sound() string { return "meow" }

// LoudDog shows explicit delegation instead of "super": it embeds Dog
// and re-declares Sound, calling the embedded version by name.
type LoudDog struct {
    Dog
}

func (l LoudDog) Sound() string {
    return strings.ToUpper(l.Dog.Sound()) + "!!" // explicit, not super
}

func main() {
    // Polymorphism through the interface field: the same Speaker works
    // for any Animal, chosen at composition time.
    animals := []Animal{
        Dog{name: "Rex"},
        Cat{name: "Milo"},
        LoudDog{Dog{name: "Bruno"}},
    }

    for _, a := range animals {
        s := Speaker{animal: a}
        fmt.Println(s.Speak())
    }

    // "accept interfaces": a function depending only on behavior works
    // for every type above, none of which share an ancestor.
    fmt.Println("loudest:", loudest(animals))
}

// loudest accepts the small Animal interface — behaves-as, not is-a.
func loudest(animals []Animal) string {
    var name string
    var max int
    for _, a := range animals {
        if n := len(a.Sound()); n > max {
            max, name = n, a.Name()
        }
    }
    return name
}
```

---

## Explanation

The broken version is Go syntax wrapped around a Java mental model, and it fails in two ways that perfectly illustrate the trap. First, `Animal.Speak` calls `a.Sound()` expecting *virtual dispatch* — expecting that when a `Dog` is involved, `Dog.Sound` runs. It never does. The promoted `Speak` runs with `Animal` as its receiver, and `Animal` knows nothing about the `Dog` embedding it, so `Sound()` resolves to `Animal.Sound` and "Rex says ...". There is no template-method behavior because there is no virtual dispatch across embedding. Second, `var a Animal = d` assumes a `Dog` *is an* `Animal` and can be assigned to one. Concrete types are not substitutable in Go, so the line does not compile. The whole design — an abstract base struct with a stub method intended to be overridden — has no foundation in the language.

The correct version rebuilds the same intent with Go's actual tools. `Animal` becomes a small **interface** describing behavior (`Name`, `Sound`). `Speaker` *composes* an `Animal` and calls it, so `Speak` is now genuinely polymorphic: it invokes whatever concrete behavior was injected. `Dog` and `Cat` share no ancestor; they qualify as `Animal` purely by having the right methods — *behaves-as*, not *is-a*. `LoudDog` shows the replacement for `super`: it embeds `Dog`, re-declares `Sound`, and reaches the embedded behavior **explicitly** with `l.Dog.Sound()`. Finally, `loudest` demonstrates "accept interfaces": it depends only on the `Animal` behavior and therefore works across every type, with no hierarchy in sight. The program runs, terminates immediately, and prints distinct sounds — including the loud variant — proving the polymorphism is real and explicit.

---

## Design Tradeoff

Dropping inheritance costs you a few conveniences that OO languages make cheap: there is no automatic `super` chain, no base method that magically calls your override, and no single keyword to inherit a whole API. You pay for polymorphism with an explicit interface and pay for shared behavior with explicit delegation or injection. For developers steeped in class hierarchies, this initially feels like more typing and more wiring to express ideas that `extends` handled in one line.

What you gain is the elimination of the failure modes those conveniences carry. With behavior modeled as interfaces and reuse as flat composition, there is no fragile base class whose change silently breaks descendants, no diamond problem, no hidden upcall rewiring a method from three levels away, and no rigidity from single inheritance. Every relationship is visible at the point of use: you can see which interface a function depends on and which concrete part a type composes. The discipline — accept interfaces, return structs; model behavior, not lineage; keep composition flat — trades a little inheritance sugar for code that stays decoupled, substitutable, and predictable as it grows. That trade is the entire thesis of this phase, and internalizing it is what turns Go-shaped syntax into genuinely idiomatic Go.

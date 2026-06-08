---
id: interface-satisfaction
phase: 4
phase_title: Interfaces (Core Abstraction)
sequence: 4
title: Interface Satisfaction
---

## Description

### Concept Overview

We have established that a Go type satisfies an interface by having the right methods. This kata drills into the *precise rules* of satisfaction, because the details trip up nearly everyone: the **method set** of a type, the asymmetry between **value receivers** and **pointer receivers**, and how to recover or test a concrete type from an interface using **type assertions** and **type switches**.

The governing rule is short but consequential: a type satisfies an interface if and only if the type's *method set* includes every method the interface requires. The subtlety is that **the method set of a value `T` and the method set of a pointer `*T` are different**. Get this wrong and you meet Go's most common interface error: "X does not implement Y (method has pointer receiver)." Get it right and you understand a rule that shapes how you store values in interfaces, pass them to functions, and design your APIs.

### Technical Explanation

**Method sets.** Every type has a method set — the collection of methods callable on values of that type. The rule is:

| Receiver declared as | In method set of `T`? | In method set of `*T`? |
|----------------------|-----------------------|------------------------|
| value receiver `(t T)`   | yes | yes |
| pointer receiver `(t *T)` | **no** | yes |

So `*T`'s method set is a *superset* of `T`'s. A pointer can call everything; a value can call only value-receiver methods *for the purpose of interface satisfaction*.

There is a convenience that confuses people: Go lets you *call* a pointer-receiver method on an addressable value directly — `c.Area()` works even if `Area` has a pointer receiver and `c` is a variable — because the compiler silently takes `&c`. But this auto-address convenience **does not apply to interface satisfaction**. When deciding whether `Circle` (the value type) satisfies an interface, only value-receiver methods count, because an interface might hold an unaddressable copy.

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ } // pointer receiver

var i Incrementer = Counter{} // ERROR: Counter value lacks Inc in its method set
var j Incrementer = &Counter{} // OK: *Counter has Inc
```

**Type assertions** recover the concrete (dynamic) type from an interface value:

```go
var s Shape = Circle{R: 2}

c := s.(Circle)          // single-result: panics if s is not a Circle
c, ok := s.(Circle)      // comma-ok: ok is false instead of panicking
```

Always prefer the comma-ok form unless you can *prove* the assertion holds; the single-result form panics on mismatch.

**Type assertions to an interface** test whether the dynamic type satisfies *another* interface:

```go
if rc, ok := r.(io.ReadCloser); ok {
    defer rc.Close() // r also knows how to Close
}
```

**Type switches** branch on the dynamic type, handling several possibilities cleanly:

```go
switch v := x.(type) {
case int:    fmt.Println("int", v)
case string: fmt.Println("string", v)
case Shape:  fmt.Println("a shape with area", v.Area())
default:     fmt.Printf("unhandled %T\n", v)
}
```

Inside each case, `v` has the matched type, so you can call its methods directly.

### Design Rationale

Why does Go distinguish the method sets of `T` and `*T` at all? Because of how interface values *store* data. When you assign a value to an interface, Go may copy it. If a pointer-receiver method were allowed on a stored value, the method could mutate a copy that no longer corresponds to the original — silently losing the change, or worse, operating on something unaddressable. By excluding pointer-receiver methods from the value's method set, Go guarantees that any mutation-capable method is only reachable through a pointer, which references a single shared instance. The rule is a *correctness* safeguard, not arbitrary pedantry.

Contrast the type-recovery story with other languages. **Java** and **C#** use `instanceof` / `is` plus a cast, and an invalid cast throws a `ClassCastException`/`InvalidCastException` at runtime. Go's single-result assertion behaves similarly (it panics), but Go also offers the *comma-ok* form, which folds the test and the extraction into one safe expression with no exception machinery — `v, ok := x.(T)`. This pushes programmers toward checking before trusting, in the same spirit as Go's explicit error returns.

**C++**'s `dynamic_cast` returns a null pointer on failure for pointer types, which is closest to the comma-ok idea, but requires RTTI and is widely considered a code smell. **TypeScript** uses type guards and narrowing, checked only at compile time and erased at runtime, so a "type assertion" there is an unchecked compile-time assertion — fundamentally weaker than Go's runtime-verified one. Go's type switch, by comparison, is a first-class statement designed for exactly this branching, with the matched value already bound to the right static type in each case.

The deeper rationale: Go wants the *common* path (using an interface polymorphically) to need no type information at all, and the *occasional* path (recovering the concrete type) to be explicit, safe, and visible. Type assertions and switches are deliberately a little verbose so that downcasting stands out as the exception, not the rule.

### Common Mistakes

**Storing a value when the interface needs pointer-receiver methods.** This is *the* classic error. You define `func (t *T) M()` and then write `var i Iface = T{}`. The value `T` does not have `M` in its method set, so it fails to satisfy `Iface`. The fix is `var i Iface = &T{}`. The compiler's message — "method has pointer receiver" — is the giveaway.

**Mixing value and pointer receivers on the same type.** If some methods use `(t T)` and others use `(t *T)`, then `T` satisfies only interfaces needing the value-receiver subset, while `*T` satisfies everything. This inconsistency causes "works with `&x` but not `x`" confusion. Convention: pick one receiver style per type and stick with it (use pointer receivers if any method mutates).

**Using the single-result assertion on an untrusted interface.** Writing `c := s.(Circle)` when `s` might hold a `Rectangle` panics at runtime. Unless you have already proven the type, use `c, ok := s.(Circle)` and handle `ok == false`.

**Forgetting the `default` case (or a nil case) in a type switch.** If the dynamic type is none of the listed cases, control falls through silently. For inputs of type `any`, always include a `default` to handle the unexpected, and remember a `case nil:` matches a nil interface value.

**Assuming the auto-address convenience extends to interfaces.** Because `c.Inc()` compiles on an addressable variable even with a pointer receiver, people assume `var i Iface = c` will too. It will not — interface satisfaction ignores the auto-address convenience entirely.

### Key Takeaways

- A type satisfies an interface iff its *method set* contains every required method; `*T`'s method set is a superset of `T`'s.
- Pointer-receiver methods are in the method set of `*T` only — a value `T` does **not** satisfy an interface that needs them, so store `&T{}`.
- The auto-address convenience that lets you call pointer methods on a variable does *not* apply to interface satisfaction.
- Recover concrete types with type assertions; prefer the safe comma-ok form `v, ok := x.(T)` over the panicking single-result form.
- Use a type switch (`switch v := x.(type)`) to branch on the dynamic type, ideally with a `default` (and possibly a `nil`) case.
- Pick one receiver style per type — use pointer receivers throughout if any method mutates — to avoid value/pointer satisfaction surprises.

---

## Broken Code

```go
// broken: Account uses a POINTER receiver for Deposit, so an Account VALUE
// does not satisfy Balancer. Storing a value into the interface fails, and
// the unchecked type assertion will panic on the wrong dynamic type.
package main

import "fmt"

type Balancer interface {
    Deposit(amount int)
    Balance() int
}

type Account struct {
    balance int
}

// Pointer receiver: Deposit must mutate, so it is in *Account's method set only.
func (a *Account) Deposit(amount int) { a.balance += amount }
func (a *Account) Balance() int       { return a.balance }

func main() {
    // Bug 1: Account VALUE does not satisfy Balancer (methods have pointer
    // receivers). Compiler: Account does not implement Balancer
    // (Deposit method has pointer receiver).
    var b Balancer = Account{}
    b.Deposit(100)

    // Bug 2: unchecked single-result assertion to the wrong type will PANIC.
    s := b.(fmt.Stringer) // Account is not a Stringer -> panic
    fmt.Println(s.String())
}
```

---

## Correct Code

```go
// correct: store a pointer so pointer-receiver methods satisfy the interface,
// and recover concrete/other-interface types with the safe comma-ok form and
// a type switch.
package main

import (
	"fmt"
)

type Balancer interface {
	Deposit(amount int)
	Balance() int
}

type Account struct {
	owner   string
	balance int
}

// Pointer receivers because Deposit mutates; for consistency Balance uses one too.
func (a *Account) Deposit(amount int) { a.balance += amount }
func (a *Account) Balance() int       { return a.balance }

// Stringer is satisfied by *Account, demonstrating an interface-to-interface assertion.
func (a *Account) String() string {
	return fmt.Sprintf("%s: $%d", a.owner, a.balance)
}

// audit recovers concrete/other-interface types safely.
func audit(b Balancer) {
	// Interface-to-interface assertion (comma-ok): does b also know String()?
	if s, ok := b.(fmt.Stringer); ok {
		fmt.Println("auditing", s.String())
	}

	// Type switch on the dynamic type.
	switch v := b.(type) {
	case *Account:
		fmt.Printf("  concrete *Account, owner=%q balance=%d\n", v.owner, v.balance)
	default:
		fmt.Printf("  some other Balancer: %T\n", v)
	}
}

func main() {
	// Store a POINTER: *Account's method set includes the pointer-receiver methods.
	var b Balancer = &Account{owner: "Ada"}

	b.Deposit(100)
	b.Deposit(50)
	fmt.Println("balance:", b.Balance())

	audit(b)

	// Safe recovery of the concrete type with comma-ok; never panics.
	if acct, ok := b.(*Account); ok {
		fmt.Printf("recovered concrete account for %q\n", acct.owner)
	}
}
```

---

## Explanation

The broken version fails on the most common interface mistake in Go. `Deposit` and `Balance` both use pointer receivers, which is correct because `Deposit` must mutate the account. But that places those methods in the method set of `*Account`, *not* `Account`. When the code writes `var b Balancer = Account{}`, it offers a *value*, whose method set lacks the required methods, so satisfaction fails with the tell-tale "Deposit method has pointer receiver" error. The second bug compounds it: even if the assignment compiled, `b.(fmt.Stringer)` uses the single-result assertion form on a dynamic type that does not implement `Stringer`, which panics at runtime rather than failing gracefully.

The correct version fixes both. It stores `&Account{}` so the interface holds a `*Account`, whose method set includes the pointer-receiver methods and therefore satisfies `Balancer`. It also adds a `String` method (on `*Account`) so the value additionally satisfies `fmt.Stringer`, which lets `audit` demonstrate a safe *interface-to-interface* assertion: `if s, ok := b.(fmt.Stringer); ok`. Because it uses comma-ok, a value that did not implement `Stringer` would simply skip the block instead of panicking.

The `audit` function then shows a type switch recovering the concrete dynamic type. Inside `case *Account:`, the bound variable `v` has type `*Account`, so its fields are directly accessible. Back in `main`, `b.(*Account)` with comma-ok safely recovers the concrete pointer. Together these illustrate the full satisfaction toolkit: store the right receiver form, assert safely, and switch on dynamic type when you must branch.

---

## Design Tradeoff

The value/pointer method-set distinction is the price Go pays for *safe, copy-friendly interface values*. By refusing to admit pointer-receiver methods into a value's method set, Go guarantees that any method capable of mutation is only reachable through a pointer to a single shared instance — never through a copy that might silently discard changes or be unaddressable. The cost is real friction: the rule is non-obvious, the error messages confuse newcomers, and the auto-address convenience for direct calls creates a false expectation that interfaces behave the same way. Many hours are lost to "why does `&x` work but `x` doesn't?"

Type assertions and switches embody a parallel tradeoff between *safety* and *brevity*. Go could have made downcasting implicit, but instead it makes recovering a concrete type an explicit, slightly verbose act — with a panicking form for when you are certain and a comma-ok form for when you are not. That verbosity is intentional: it keeps the common polymorphic path clean (no type info needed) while making the occasional escape hatch visible and, when you choose comma-ok, panic-free. As elsewhere in Go, the language optimizes the reader's ability to *see* where a program steps outside ordinary interface use, accepting a little extra typing to get it.

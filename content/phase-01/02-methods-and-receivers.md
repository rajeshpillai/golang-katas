---
id: methods-and-receivers
phase: 1
phase_title: Structs, Methods & Data Modeling
sequence: 2
title: Methods and Receivers
---

## Description

### Concept Overview

A method in Go is a function with a special extra parameter called the **receiver**, written before the method name. The receiver binds the function to a type, so the method can be called with dot notation: `account.Deposit(100)`. This is how Go attaches behavior to data. There is no `class` keyword, no method body living "inside" a type definition — instead, you declare a normal function and name the type it operates on.

The key insight is that **behavior is attached to data through methods, not through classes**. A method declaration sits at the package level, right alongside ordinary functions. The receiver `(a Account)` is what turns `func Deposit(...)` into `func (a Account) Deposit(...)` — a method on `Account`. This separation means a type's data definition and its behavior can live in different places (even different files in the same package), and it means you can define methods on many kinds of types, not just structs.

### Technical Explanation

**Anatomy of a method.** The receiver appears in parentheses between the `func` keyword and the method name:

```go
type Account struct {
    Owner   string
    Balance int
}

//      receiver        method name and parameters
//      ┌──────────┐    ┌────────────────────────┐
func (a Account) Describe() string {
    return fmt.Sprintf("%s has %d", a.Owner, a.Balance)
}
```

Inside the method, the receiver name (`a` here) refers to the value the method was called on. By convention the receiver name is short — one or two letters, usually the first letter of the type — and it is the *same* for every method on that type. You would not write `func (account Account)` on one method and `func (a Account)` on another.

**Calling a method** uses dot notation:

```go
acc := Account{Owner: "Ada", Balance: 100}
fmt.Println(acc.Describe()) // method call
```

**A method is just a function with rewired syntax.** Go even lets you call a method as a plain function through its *method expression*, which makes the receiver explicit as the first argument:

```go
describe := Account.Describe // method expression: func(Account) string
fmt.Println(describe(acc))   // identical to acc.Describe()
```

This reveals the truth: `acc.Describe()` is sugar for `Account.Describe(acc)`. The receiver is the first argument; the dot syntax just moves it to the front.

**Methods on non-struct types.** A receiver can be any type *defined in the same package* — not only structs. A common pattern is defining a named type over a primitive or a slice and attaching methods:

```go
type Celsius float64

func (c Celsius) Fahrenheit() Celsius {
    return c*9/5 + 32
}

temp := Celsius(100)
fmt.Println(temp.Fahrenheit()) // 212
```

You cannot, however, define a method on a type from *another* package (e.g., you cannot add a method to `time.Time` or to `int` directly). The receiver type's definition must live in your package. This rule keeps method sets predictable: a type's behavior is always defined alongside the type.

**Method sets and interfaces.** The set of methods a type has — its *method set* — is what determines which interfaces it satisfies. Methods are therefore the bridge between concrete data and Go's interface-based polymorphism, which comes later in the curriculum. For now, the point is that declaring a method is how you give a type a capability.

**Receivers can be values or pointers** (`func (a Account)` vs `func (a *Account)`), and the choice has important consequences for mutation and copying — that distinction is significant enough to be its own kata. This kata focuses on the mechanics of methods themselves.

### Design Rationale

Go's method design is deliberately minimal compared to class-based languages.

**Java and C++** bundle data and methods together inside a `class` block, with the methods physically nested in the type body. This creates a tight syntactic coupling and encourages inheritance hierarchies. Go separates the two: data is declared with `type ... struct`, and behavior is declared with free-standing `func (r T) ...` declarations. This means you can group methods however you like across files, and it makes the "a method is just a function" relationship explicit rather than hidden.

**Python** attaches methods inside the class body and passes `self` explicitly as the first parameter — `def deposit(self, amount):`. Go's receiver is the same idea (an explicit first parameter), but lifted out of any class block and given dedicated syntax. Go's version is arguably more honest: the method expression `Account.Describe` shows the receiver *is* the first argument, just as Python's `self` is.

**JavaScript** historically used prototype chains and `this`, where `this` is dynamically bound depending on how a function is called — a notorious source of bugs. Go's receiver is statically bound to the type at compile time; there is no dynamic `this` to lose track of. `a` always refers to the receiver, period.

By refusing classes and inheritance, Go nudges you toward composition (covered in Phase 5) and toward small, behavior-focused interfaces (Phase 4). Methods are the building block, but they are intentionally lightweight: a function with a receiver, nothing more.

### Common Mistakes

**Trying to add a method to a type from another package.** `func (t time.Time) MyHelper()` is a compile error: "cannot define new methods on non-local type." You may only define methods on types declared in your own package. The fix is to define a local named type (often via embedding or a wrapper) and add the method there.

**Inconsistent receiver names across a type's methods.** Using `a` on one method and `acct` on another is legal but jarring and flagged by linters. Pick one short receiver name per type and use it everywhere. Consistency makes the code scan as a unit.

**Confusing a method with a field that holds a function.** `a.Describe()` calls a method; `a.handler()` where `handler func()` is a struct field calls a stored closure. They look similar but behave differently — a method is part of the type's method set and participates in interface satisfaction, while a function-typed field does not. Beginners sometimes reach for function fields when a method is the idiomatic choice.

**Expecting method overloading.** Go does not support overloading — you cannot have two methods named `Add` with different parameter lists on the same type. Each method name must be unique within a type's method set. Coming from Java or C++, this surprises people. The idiomatic answer is distinct names (`AddInt`, `AddAll`) or variadic parameters.

**Forgetting that the receiver may be a copy.** When the receiver is a value type (not a pointer), the method operates on a *copy* of the data. Assigning to a field of a value receiver changes only the copy and is lost when the method returns. This is the central subject of the value-vs-pointer-receiver kata, but it bites people the first time they write a method intended to mutate state.

### Key Takeaways

- A method is a function with a receiver parameter that binds it to a type; `a.M()` is sugar for `T.M(a)`.
- The receiver appears between `func` and the method name; use a short, consistent receiver name across all methods on a type.
- Methods can be defined on any locally declared type — structs, named primitives, named slices — not only structs.
- You cannot define methods on types from other packages; the receiver type must be declared in your package.
- Go has no method overloading: each method name is unique within a type's method set.
- Methods (the type's method set) are the mechanism by which a concrete type satisfies interfaces.

---

## Broken Code

```go
// broken: a free function that should be a method, plus an illegal
// attempt to add a method to a type from another package.
package main

import (
    "fmt"
    "time"
)

type Account struct {
    Owner   string
    Balance int
}

// Awkward: behavior modeled as a free function instead of a method.
// It works, but it does not read as "an account describing itself,"
// and it cannot participate in any interface's method set.
func Describe(a Account) string {
    return fmt.Sprintf("%s has %d", a.Owner, a.Balance)
}

// Illegal: cannot define a method on time.Time — it is not a local type.
// Compile error: cannot define new methods on non-local type time.Time
func (t time.Time) IsWeekendDay() bool {
    return t.Weekday() == time.Saturday || t.Weekday() == time.Sunday
}

func main() {
    acc := Account{Owner: "Ada", Balance: 100}
    fmt.Println(Describe(acc)) // free-function call, not acc.Describe()
}
```

---

## Correct Code

```go
// correct: behavior attached to types via receivers, including a
// method on a locally defined wrapper around a non-local type.
package main

import (
    "fmt"
    "time"
)

type Account struct {
    Owner   string
    Balance int
}

// Describe is a method on Account: behavior attached to data.
func (a Account) Describe() string {
    return fmt.Sprintf("%s has %d", a.Owner, a.Balance)
}

// Day is a local named type wrapping time.Time, so we are allowed to
// give it methods. This is the idiomatic way to "extend" a foreign type.
type Day time.Time

func (d Day) IsWeekend() bool {
    wd := time.Time(d).Weekday()
    return wd == time.Saturday || wd == time.Sunday
}

func main() {
    acc := Account{Owner: "Ada", Balance: 100}

    // Idiomatic method call: the account describes itself.
    fmt.Println(acc.Describe())

    // A method is a function with a rewired receiver. The method
    // expression makes the receiver the explicit first argument.
    describe := Account.Describe
    fmt.Println(describe(acc)) // identical result

    // Method on our local wrapper type.
    sat := Day(time.Date(2026, time.June, 6, 0, 0, 0, 0, time.UTC))
    fmt.Println("is weekend:", sat.IsWeekend())
}
```

---

## Explanation

The broken version models an account's description as a free function `Describe(a Account)`. This compiles and runs, but it loses the benefits of methods: the call site reads `Describe(acc)` rather than `acc.Describe()`, the behavior is not part of `Account`'s method set, and it cannot satisfy any interface. It also attempts something genuinely illegal — adding an `IsWeekendDay` method directly to `time.Time`. Go rejects this with "cannot define new methods on non-local type," because methods may only be declared on types defined in the current package. This rule keeps a type's complete behavior discoverable in the package that owns it.

The correct version turns `Describe` into a method with the receiver `(a Account)`, so it can be called as `acc.Describe()` and becomes part of `Account`'s method set. To add behavior to `time.Time`, it defines a local named type `Day time.Time` and attaches `IsWeekend` to *that*. Converting back and forth (`time.Time(d)`) lets the wrapper reuse the underlying type's methods while exposing its own.

The example also demonstrates the method expression `Account.Describe`, which yields a plain `func(Account) string`. Calling `describe(acc)` produces the same result as `acc.Describe()`, making concrete the idea that a method is simply a function whose first argument is the receiver.

---

## Design Tradeoff

Separating data declaration from method declaration — rather than nesting methods inside a class body — keeps the language small and makes the receiver-as-first-argument relationship explicit. It frees you to organize methods across multiple files and steers the language away from inheritance toward composition and interfaces. The receiver is statically bound, so there is none of the dynamic-`this` confusion that plagues JavaScript, and the method expression gives you a clean escape hatch to treat any method as an ordinary function value.

The trade is reduced expressive shortcuts. There is no overloading, so families of related operations need distinct names or variadics. You cannot bolt methods onto types you do not own, so extending a standard-library or third-party type requires a local wrapper and explicit conversions. These constraints add a little ceremony, but in exchange a type's entire behavior is always defined in one package, method dispatch is predictable, and "what can this value do" is answered by a single, statically known method set.

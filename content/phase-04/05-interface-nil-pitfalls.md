---
id: interface-nil-pitfalls
phase: 4
phase_title: Interfaces (Core Abstraction)
sequence: 5
title: Interface Values and Nil Pitfalls
---

## Description

### Concept Overview

This is the kata every Go programmer eventually wishes they had read sooner. It explains the infamous **"my error is not nil even though I returned nil"** bug — the nil-interface-vs-nil-pointer trap. The root cause is a single fact about how interface values are represented: an interface value is a `(type, value)` pair, and **an interface is nil only when *both* the type and the value are nil**.

This means a non-nil interface can hold a nil *pointer*. The interface remembers a concrete type (say `*MyError`) and a value that happens to be a nil pointer. That interface is **not nil** — its type word is set — even though the data it points to is nil. Comparing it to `nil` returns `false`, and the classic bug is born: a function returns a typed nil pointer as an `error`, the caller checks `if err != nil`, and the check passes when the programmer expected it to fail.

Understanding the two-word representation of interface values is the only way to reason about this correctly. Once you see it, the bug becomes obvious and avoidable.

### Technical Explanation

**The two-word model.** An interface value occupies two machine words:

| Word | Holds |
|------|-------|
| type | a pointer to the dynamic type descriptor (or nil) |
| data | a pointer to (or the value of) the underlying data (or nil) |

A true nil interface has **both** words nil:

```go
var err error // type=nil, data=nil  -> err == nil is TRUE
```

Now consider a typed nil pointer stored in an interface:

```go
var p *MyError = nil      // p is a nil pointer
var err error = p         // type=*MyError, data=nil
fmt.Println(err == nil)   // FALSE — the type word is set!
```

The interface is not nil because its *type* word is `*MyError`, even though its *data* word is nil. The comparison `err == nil` checks whether *both* words are nil, and they are not.

**The canonical bug** appears when a function declares a concrete pointer error variable, leaves it nil, and returns it through an interface-typed result:

```go
func do() error {
    var e *MyError      // nil pointer
    if somethingFailed {
        e = &MyError{...}
    }
    return e            // BUG: always returns a NON-nil error interface,
}                       //      because the result type is error (interface)
```

Even on the success path where `e` stays nil, `return e` wraps a `(*MyError, nil)` pair into the `error` interface — non-nil. Every caller's `if err != nil` fires.

**The fix** is to return an untyped `nil` literal, or to type the variable as the interface from the start:

```go
func do() error {
    if somethingFailed {
        return &MyError{...} // non-nil error
    }
    return nil               // untyped nil -> a true nil interface
}
```

**Detecting it.** A type switch or assertion reveals the hidden type:

```go
fmt.Printf("%T\n", err) // prints *main.MyError even when "empty"
```

And `errors.Is` / comparisons behave according to the interface, not your mental model — so the discipline is: never let a typed nil pointer escape through an interface return.

### Design Rationale

Why does Go represent interfaces this way, knowing it creates this trap? Because the two-word `(type, data)` design is what makes interfaces work at all. The type word is *required* for dynamic dispatch: to call `s.Area()` on an interface, the runtime must know which concrete type's `Area` to invoke, and that information lives in the type word. To make the type word vanish whenever the data pointer happens to be nil would break the model — the interface would forget what it holds, and methods could not be dispatched. So Go is consistent: an interface is nil only when it holds *nothing at all*, type included.

Other languages dodge this specific trap by *not having* the value/reference duality in the same way. In **Java** and **C#**, references are uniformly nullable; there is no notion of a "typed nil reference boxed into an interface that is itself non-null" — a null reference is just null, and `instanceof`/`is` on null is false. They avoid Go's pitfall but at the cost of `NullPointerException`/`NullReferenceException` lurking behind *every* reference. **C++** has null pointers but no implicit boxing into interface values, so the trap does not arise in the same shape. **TypeScript**'s `null`/`undefined` are values checked structurally at compile time, again without runtime boxing.

Go's choice reflects its general philosophy: interfaces are explicit, runtime-typed values, and the language will not paper over the distinction between "an interface holding nothing" and "an interface holding a nil pointer of a known type." The two situations are genuinely different, and Go represents them differently. The pitfall is the cost of that honesty — and it is sharp precisely because the two situations *look* identical at the call site (`return nil` vs `return e` where `e` is a nil pointer) while behaving differently.

### Common Mistakes

**Returning a typed nil pointer as an error/interface.** The headline bug. A function with an `error` result returns a concrete `*SomeError` variable that is nil on the happy path. The returned interface is non-nil, every caller's `if err != nil` mistakenly fires, and the program reports failures that never happened. Fix: return the untyped `nil` literal on success, or type the variable as `error`.

**Declaring the variable as the concrete pointer type instead of the interface.** `var e *MyError` then `return e` is the setup for the trap. If you instead write `var err error` and only ever assign `&MyError{...}` to it on failure, the success path returns a genuinely nil interface.

**Assuming `x == nil` tells you the underlying data is nil.** It does not. It tells you both words are nil. An interface can be non-nil while pointing at nil data. If you truly need to know whether the *underlying* value is nil, you must type-assert to the concrete pointer and compare *that* to nil — but the better cure is to never create the situation.

**Storing a nil pointer in a `any`/`interface{}` and being surprised it is non-nil.** The same mechanic applies to every interface, not just `error`. `var i any = (*T)(nil)` gives `i != nil`. This bites generic code and reflection-based helpers.

**Calling a method on an interface holding a nil pointer and expecting a clean nil-interface panic.** It may *not* panic at the interface boundary — dispatch succeeds because the type is known — and instead panics *inside* the method when it dereferences the nil receiver (unless the method is written to tolerate a nil receiver). The panic location can be far from the assignment, obscuring the cause.

### Key Takeaways

- An interface value is a `(type, data)` pair and is nil **only when both words are nil**.
- A non-nil interface can hold a nil pointer: storing a typed nil pointer sets the type word, so `iface == nil` is false.
- The classic bug: returning a typed nil pointer through an `error`/interface result makes every `if err != nil` check fire on the success path.
- Fix it by returning the untyped `nil` literal on success, or by declaring the variable with the interface type and only assigning concrete values on failure.
- `x == nil` checks the interface, not the underlying data — use a concrete type assertion if you must inspect the data, but prefer to avoid the situation entirely.
- The trap applies to every interface (`any`, custom interfaces), not just `error`, and a method call on such a value can panic deep inside the method.

---

## Broken Code

```go
// broken: validate returns a TYPED nil pointer through an error result.
// On the success path it returns a (*ValidationError, nil) interface, which
// is NON-nil, so the caller's `if err != nil` fires even when nothing failed.
package main

import "fmt"

type ValidationError struct {
    Field string
}

func (e *ValidationError) Error() string {
    return "invalid field: " + e.Field
}

func validate(name string) error {
    var e *ValidationError // concrete nil pointer
    if name == "" {
        e = &ValidationError{Field: "name"}
    }
    // Bug: on success e is a nil *ValidationError, but wrapping it in the
    // error interface yields type=*ValidationError, data=nil -> NON-nil error.
    return e
}

func main() {
    err := validate("Ada") // valid input, expect no error
    if err != nil {
        // This WRONGLY prints, because err is a non-nil interface
        // wrapping a nil pointer.
        fmt.Println("unexpected error:", err)
    } else {
        fmt.Println("ok, no error")
    }
}
```

---

## Correct Code

```go
// correct: never let a typed nil pointer escape through an interface result.
// Return the untyped nil literal on success so the error interface is truly nil.
package main

import "fmt"

type ValidationError struct {
	Field string
}

func (e *ValidationError) Error() string {
	return "invalid field: " + e.Field
}

// Fix: return concrete errors only on the failure path; return untyped nil
// on success. The success path now yields a genuine nil error interface.
func validate(name string) error {
	if name == "" {
		return &ValidationError{Field: "name"}
	}
	return nil // untyped nil -> type=nil, data=nil -> truly nil interface
}

// Helper that demonstrates the two-word model directly.
func describe(label string, err error) {
	fmt.Printf("%-18s isNil=%-5t  dynamicType=%T\n", label, err == nil, err)
}

func main() {
	good := validate("Ada") // valid
	bad := validate("")     // invalid

	describe("good (valid):", good)
	describe("bad (invalid):", bad)

	if good == nil {
		fmt.Println("good -> correctly nil, no error")
	}
	if bad != nil {
		fmt.Println("bad  -> correctly non-nil:", bad)
	}

	// Demonstrate the trap explicitly so the mechanism is unmistakable.
	var typedNil *ValidationError = nil
	var asError error = typedNil
	fmt.Printf("\ntyped nil pointer stored in error interface: isNil=%t (type=%T)\n",
		asError == nil, asError)
	fmt.Println("note: the interface is NOT nil even though the pointer is nil")
}
```

---

## Explanation

The broken version is the canonical nil-interface trap distilled to its smallest form. Inside `validate`, the variable `e` is declared as a concrete `*ValidationError` and left nil on the success path. When the function executes `return e`, Go must convert that concrete pointer into the function's declared result type, `error` — an interface. The conversion produces an interface value whose *type* word is `*ValidationError` and whose *data* word is the nil pointer. Because the type word is set, the resulting interface is **not** nil. The caller's `if err != nil` therefore evaluates to true on perfectly valid input, and the program reports an error that never occurred.

The correct version refuses to let a typed nil pointer escape. `validate` returns a concrete `&ValidationError{}` only on the failure path; on success it returns the untyped literal `nil`. An untyped `nil` assigned to an interface result sets *both* words to nil, producing a genuinely nil error interface, so the caller's check behaves as intended. The `describe` helper prints `err == nil` alongside `%T` (the dynamic type) to make the two-word model visible: for the good case the dynamic type is `<nil>` and `isNil` is true; for the bad case the dynamic type is `*main.ValidationError` and `isNil` is false.

The final block in `main` reproduces the trap deliberately and in isolation: it stores an explicitly nil `*ValidationError` into an `error` variable and shows that `asError == nil` is `false` with dynamic type `*main.ValidationError`. Seeing the mechanism stripped of any control flow makes the rule concrete: an interface is nil only when it holds no type at all, and storing any typed pointer — even a nil one — sets the type word and makes the interface non-nil.

---

## Design Tradeoff

The nil-interface trap is the unavoidable cost of Go's two-word interface representation, and that representation is not negotiable — the type word is exactly what enables dynamic dispatch, so an interface that "forgot" its type whenever its data pointer was nil could not function. Go could have hidden the distinction by special-casing nil pointers during interface conversion, but that would make `error == nil` lie about what the interface actually holds and would introduce inconsistency between `error` and every other interface. Instead Go is rigorously honest: "an interface holding a typed nil pointer" and "an empty interface" are different things, and the language represents them differently even though they look alike at the call site.

The practical tradeoff, then, is *conceptual simplicity of the model* versus *ease of getting the common case right*. The model is beautifully simple — nil means both words nil — but the common case (returning errors) is easy to get subtly wrong, because `return e` and `return nil` look equivalent when `e` is a nil pointer yet behave differently. Go's answer is discipline rather than magic: declare error variables as the interface type, return the untyped `nil` literal on success, and never let a concrete nil pointer escape through an interface result. Master that one habit and the trap, sharp as it is, never closes on you.

---
id: custom-error-types
phase: 3
phase_title: Error Handling as Design
sequence: 2
title: Custom Error Types
---

## Description

### Concept Overview

A plain string error tells you *that* something went wrong. A custom error type tells you *what* went wrong in a way your code can inspect and act on. Because the `error` type in Go is just an interface — anything with an `Error() string` method — you can define your own struct, attach as many structured fields as you like (a status code, a field name, an offending value), and return it wherever an `error` is expected. The caller can then recover those fields with a type assertion or `errors.As` and make decisions based on real data rather than parsing text.

This is the moment Go error handling becomes *design* rather than just plumbing. When you model your errors as types, an error stops being an opaque message and becomes a first-class part of your API's contract. A `ValidationError` carries the field that failed and why. An `HTTPError` carries the status code. A `NotFoundError` carries the ID that was missing. Callers program against these structures, not against strings.

The key enabler is the same interface you met in the previous kata: `error` is defined entirely by the single method `Error() string`. Satisfying it is implicit — you never declare "implements error." You just give your type that method, and it *is* an error.

### Technical Explanation

**Defining a custom error type** means defining a struct (or any type) and giving it an `Error() string` method:

```go
type ValidationError struct {
    Field string
    Value any
    Rule  string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %q (value %v): %s",
        e.Field, e.Value, e.Rule)
}
```

Now `*ValidationError` satisfies the `error` interface and can be returned anywhere an `error` is expected:

```go
func validateAge(age int) error {
    if age < 0 {
        return &ValidationError{Field: "age", Value: age, Rule: "must be >= 0"}
    }
    return nil
}
```

**Pointer receiver vs value receiver.** Notice the method is defined on `*ValidationError` (pointer receiver), and we return `&ValidationError{...}`. This is the conventional choice for error types, for two reasons. First, errors are often compared by identity, and pointer identity is well-defined. Second, if the method is on the pointer type, only `*ValidationError` satisfies `error` — which keeps things consistent. You *can* use a value receiver, and for small, comparable errors it works fine, but pointer receivers are the common idiom.

**Recovering the structured data** at the call site is where the payoff lands. The modern, recommended tool is `errors.As`, which checks whether an error in the chain matches a target type and, if so, assigns it:

```go
err := validateAge(-3)
var ve *ValidationError
if errors.As(err, &ve) {
    fmt.Println("bad field:", ve.Field) // access the struct's fields
}
```

`errors.As` is preferred over a raw type assertion (`ve, ok := err.(*ValidationError)`) because it also looks *through wrapped* errors (covered in the next kata). With a raw assertion you only match the top-level error; with `errors.As` you match anywhere in the chain.

**Adding behavior, not just data.** Because a custom error is a real type, you can give it extra methods that callers use to make decisions:

```go
type APIError struct {
    Code int
    Msg  string
}

func (e *APIError) Error() string  { return fmt.Sprintf("api error %d: %s", e.Code, e.Msg) }
func (e *APIError) Temporary() bool { return e.Code >= 500 } // retry on 5xx
```

| Need | Approach |
|---|---|
| Just a message | `errors.New` / `fmt.Errorf` |
| Structured data the caller inspects | custom struct with `Error()` |
| Recover the type from an error value | `errors.As(err, &target)` |
| Behavioral hints (e.g. retryable) | add methods to the error type |

### Design Rationale

The reason custom error types are so natural in Go comes down to one decision: **interface satisfaction is implicit and structural**. In Java or C#, to create a custom exception you must `extends Exception` (or a subclass), inheriting a heavyweight class hierarchy, stack-trace capture, and constructor boilerplate. The exception *is* a class in a tree, and its position in that tree determines how `catch` clauses match it. This couples error handling to inheritance.

In Go there is no hierarchy. `error` is a one-method interface, and any type that provides `Error() string` joins the club automatically. Your error type can be a tiny struct, an `int`, or a slice — whatever models the failure best. There is no base class to extend, no `throws` declaration, and no required constructor. This is the same composition-over-inheritance philosophy that runs through all of Go.

Compare also with **C++**, where exceptions can be any type but the community converged on deriving from `std::exception` for `what()`. Go's `error` interface is essentially that convention promoted to a language-level standard: one method, `Error() string`, analogous to `what()`, but enforced by the type system rather than by discipline.

The structural-typing choice also explains why `errors.As` matters. Because errors are just values implementing an interface, the standard library can offer generic functions that walk a chain of error values and match them by *type*. You get exception-like "catch this specific kind of error" behavior, but built from plain values and ordinary type assertions rather than special syntax. The design keeps errors as data while still letting you discriminate among kinds of failure — the best of both worlds.

### Common Mistakes

**Comparing error strings instead of types.** Writing `if err.Error() == "not found"` to branch on a kind of error is brittle: a tiny wording change breaks the check, and translations or added context defeat it entirely. If callers need to react to a *kind* of error, give that kind a type and use `errors.As`.

**Using a raw type assertion when the error might be wrapped.** `ve, ok := err.(*ValidationError)` only matches if `err` is *exactly* a `*ValidationError` at the top level. Once someone wraps it with `fmt.Errorf("...: %w", err)`, the assertion fails. Use `errors.As(err, &ve)`, which unwraps the chain. (Wrapping is the subject of the next kata, but the habit starts here.)

**Mixing pointer and value receivers inconsistently.** If you define `Error()` on `*ValidationError` but then return a value `ValidationError{}` (not a pointer), that value does **not** satisfy `error`, and you will get a confusing compile error or a failed match. Pick pointer receivers and return pointers, consistently.

**Returning a typed nil pointer as an error.** A classic trap: a function declared to return `error` returns a `*ValidationError` that happens to be `nil`. The result is a non-nil `error` interface wrapping a nil pointer, so `if err != nil` is unexpectedly true. The fix is to return a literal `nil` (the untyped interface nil) on success, never a typed nil pointer. This pitfall is important enough to demonstrate in the broken code below.

**Over-engineering trivial errors.** Not every error needs a type. If no caller will ever inspect structured fields, `errors.New` or `fmt.Errorf` is clearer and lighter. Reach for a custom type when callers genuinely need to *act* on the specifics.

### Key Takeaways

- Any type with an `Error() string` method satisfies the `error` interface — no inheritance, no declaration, just the method.
- Custom error types let you attach structured data (codes, fields, values) that callers can inspect programmatically instead of parsing strings.
- Use `errors.As(err, &target)` to recover a custom type from an error, because it also searches through wrapped errors.
- Use pointer receivers and return pointers for error types, consistently, to keep interface satisfaction and identity well-defined.
- Beware the typed-nil trap: return a literal `nil` on success, never a nil pointer of your error type.
- Reach for a custom error type only when callers need to act on the specifics — otherwise `errors.New`/`fmt.Errorf` is simpler.

---

## Broken Code

```go
// broken: a function returns a typed nil pointer, so `err != nil` is unexpectedly true
package main

import "fmt"

type ValidationError struct {
    Field string
    Rule  string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %q: %s", e.Field, e.Rule)
}

// Bug: the return type is *ValidationError, not error. On success we return
// nil — but that nil is a *typed* nil pointer. When it is later assigned to
// an `error` interface, the interface is NON-nil (it has a type, *ValidationError,
// with a nil value), so `if err != nil` is true even though nothing went wrong.
func validate(age int) *ValidationError {
    if age < 0 {
        return &ValidationError{Field: "age", Rule: "must be >= 0"}
    }
    return nil // typed nil — the source of the bug
}

func main() {
    var err error = validate(42) // 42 is valid, so we expect "no error"

    if err != nil {
        // This branch runs even though validation PASSED.
        fmt.Println("unexpected error:", err) // panics: Error() called on nil receiver
    } else {
        fmt.Println("age is valid")
    }
}
```

---

## Correct Code

```go
// correct: custom error types carry structured data and are recovered with errors.As
package main

import (
    "errors"
    "fmt"
)

// ValidationError is a structured error: callers can read Field, Value, and Rule.
type ValidationError struct {
    Field string
    Value any
    Rule  string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %q (value %v): %s", e.Field, e.Value, e.Rule)
}

// APIError demonstrates an error type with extra *behavior*, not just data.
type APIError struct {
    Code int
    Msg  string
}

func (e *APIError) Error() string   { return fmt.Sprintf("api error %d: %s", e.Code, e.Msg) }
func (e *APIError) Temporary() bool { return e.Code >= 500 } // 5xx is worth retrying

// validateAge returns the error INTERFACE, so a successful return is a true nil.
func validateAge(age int) error {
    if age < 0 {
        return &ValidationError{Field: "age", Value: age, Rule: "must be >= 0"}
    }
    return nil
}

func fetch(code int) error {
    if code != 200 {
        return &APIError{Code: code, Msg: "request failed"}
    }
    return nil
}

func main() {
    // Recover structured fields with errors.As.
    if err := validateAge(-3); err != nil {
        var ve *ValidationError
        if errors.As(err, &ve) {
            fmt.Printf("invalid field %q -> rule: %s\n", ve.Field, ve.Rule)
        }
    }

    // A valid value returns a true nil interface — no false positive.
    if err := validateAge(30); err == nil {
        fmt.Println("age 30 is valid")
    }

    // Use error *behavior* to decide whether to retry.
    for _, code := range []int{200, 404, 503} {
        err := fetch(code)
        if err == nil {
            fmt.Printf("fetch %d: ok\n", code)
            continue
        }
        var ae *APIError
        if errors.As(err, &ae) && ae.Temporary() {
            fmt.Printf("fetch %d: %v (retryable)\n", code, ae)
        } else {
            fmt.Printf("fetch %d: %v (give up)\n", code, err)
        }
    }
}
```

---

## Explanation

The broken version showcases the most infamous trap with custom error types: the **typed nil**. The `validate` function is declared to return `*ValidationError`, and on the success path it returns `nil`. That `nil` is a nil *pointer*, but it carries a concrete type. The moment it is assigned to a variable of interface type `error`, the interface becomes non-nil, because a Go interface value is non-nil whenever it has a concrete type — even if the underlying pointer is nil. So `if err != nil` is true after a perfectly valid input, and calling `err.Error()` dereferences a nil receiver and panics. The cure is the one the correct code uses: declare the function to return `error` (the interface), so that returning `nil` produces a genuine nil interface.

The correct version shows custom error types doing their real job. `ValidationError` carries `Field`, `Value`, and `Rule`, and the caller pulls those fields out with `errors.As` to produce a precise, actionable message — no string parsing involved. `APIError` goes a step further by adding a `Temporary()` method, turning the error into something the caller can *query* to decide whether to retry. This is the essence of error-as-design: the error value is not a dead-end message but a structured participant in the program's logic.

Note the consistent use of `errors.As` rather than a raw type assertion. Even though nothing is wrapped in this example, using `errors.As` future-proofs the code: the moment any layer wraps these errors with `%w`, the same recovery code keeps working, because `errors.As` walks the entire chain.

---

## Design Tradeoff

Custom error types add power at the cost of coupling and ceremony. When you define a `ValidationError` and expose its fields, callers that inspect those fields become coupled to your error's shape — change the struct and you may break them, just as you would by changing any other part of your public API. There is also more code: a struct, an `Error()` method, and `errors.As` plumbing at every call site that cares. For an error no one inspects, that is pure overhead, and a one-line `fmt.Errorf` would communicate just as much.

The tradeoff is worth it precisely when callers need to *behave differently* depending on the kind of failure — retry on a 5xx, surface a specific field to a user, map a domain error to an HTTP status. In those cases, modeling the error as a type turns brittle, string-matching branch logic into robust, type-checked decisions, and lets the error grow behavior (methods) as the program's needs evolve. The Go philosophy is to start simple with `errors.New`/`fmt.Errorf` and graduate to a custom type only when the structure earns its keep — never abstracting an error before a caller actually needs to act on its internals.

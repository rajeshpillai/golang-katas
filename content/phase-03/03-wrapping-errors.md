---
id: wrapping-errors
phase: 3
phase_title: Error Handling as Design
sequence: 3
title: Wrapping Errors
---

## Description

### Concept Overview

When an error travels up through several layers of a program, each layer knows something the others do not. The database layer knows the SQL failed. The repository layer knows it was trying to load user 42. The HTTP handler knows it was serving `GET /users/42`. If each layer simply returns the error it received, the final message is detail-poor ("connection refused") and context-free. If each layer instead *replaces* the error with its own message, the original cause is lost. Error **wrapping** solves both problems: each layer adds its context *while preserving* the original error underneath, building a chain you can later inspect.

Go added first-class wrapping in version 1.13 with three pieces: the `%w` verb in `fmt.Errorf`, and the `errors.Is` and `errors.As` functions for inspecting a wrapped chain. Wrapping with `%w` produces a new error that carries a message *and* a link to the error it wraps. `errors.Is` walks that chain looking for a specific sentinel error; `errors.As` walks it looking for a specific error type. Together they let you add human-readable context at every layer without ever destroying the machine-readable cause.

The mental model is a linked list of errors, newest at the front. Wrapping prepends context; unwrapping (via `errors.Is`/`errors.As`, or the `Unwrap` method) walks back toward the root cause.

### Technical Explanation

**Wrapping with `%w`.** The `fmt.Errorf` function gained a special verb, `%w`, that wraps the error argument instead of just formatting it as text with `%v`:

```go
if err := loadUser(id); err != nil {
    return fmt.Errorf("getProfile: loading user %d: %w", id, err)
}
```

The returned error's `Error()` string concatenates the new context with the wrapped error's message. But unlike `%v`, the `%w` form also stores the wrapped error so it can be recovered later. You may use multiple `%w` verbs in one call (Go 1.20+) to wrap several errors at once.

**The `Unwrap` method.** Under the hood, `%w` produces an error type with a method `Unwrap() error` returning the wrapped error. Any custom type can join the chain by implementing `Unwrap`:

```go
type QueryError struct {
    Query string
    Err   error
}

func (e *QueryError) Error() string { return fmt.Sprintf("query %q: %v", e.Query, e.Err) }
func (e *QueryError) Unwrap() error { return e.Err } // makes it part of the chain
```

**Inspecting with `errors.Is`.** To check whether anything in the chain *is* a particular sentinel error, use `errors.Is`. It walks the chain calling `Unwrap` until it finds a match (or runs out):

```go
if errors.Is(err, sql.ErrNoRows) {
    // a sql.ErrNoRows is somewhere in the chain, however many layers deep
}
```

This is why you should never compare wrapped errors with `==`. `err == sql.ErrNoRows` is only true for the *unwrapped* sentinel; once wrapped, the direct comparison fails. `errors.Is` does the unwrapping for you.

**Inspecting with `errors.As`.** To recover a particular *type* from the chain, use `errors.As`:

```go
var qe *QueryError
if errors.As(err, &qe) {
    fmt.Println("failed query was:", qe.Query)
}
```

| Operation | Tool |
|---|---|
| Add context, keep cause | `fmt.Errorf("...: %w", err)` |
| Make a custom type unwrappable | implement `Unwrap() error` |
| Match a sentinel anywhere in chain | `errors.Is(err, target)` |
| Recover a type anywhere in chain | `errors.As(err, &target)` |
| Format text only, drop the link | `fmt.Errorf("...: %v", err)` |

**`%w` vs `%v`.** This is the crucial distinction. `%w` preserves the wrapped error for `errors.Is`/`errors.As`; `%v` only formats its message as text and severs the chain. Use `%w` when callers may need to inspect the cause; use `%v` when you deliberately want to hide it (for example, to avoid leaking an internal error type across an API boundary).

### Design Rationale

Before Go 1.13, the ecosystem had a problem the language did not solve: people wanted to add context to errors, but `fmt.Errorf("...: %v", err)` flattened everything into a string, destroying the ability to check for a specific underlying error. Third-party packages like `github.com/pkg/errors` filled the gap with `Wrap`/`Cause`, but having a community standard outside the language led to inconsistency. Go 1.13 absorbed the idea into the standard library with `%w`, `errors.Is`, and `errors.As`, making wrapping a built-in, universal convention.

The design reflects Go's core philosophy that **errors are values you program with**. A wrapped error is just a value that holds another value plus an `Unwrap` method — there is no special runtime machinery, no stack-unwinding, no exception-chaining object graph maintained by the VM. Contrast this with **Java's** exception chaining (`new IOException("context", cause)` plus `getCause()`): the idea is the same, but it is bolted onto the exception class hierarchy and the throw/catch control-flow model. Go achieves the equivalent with plain interfaces and functions, so the same tools that handle any error value also handle wrapped ones.

The split between `errors.Is` (match a *value/sentinel*) and `errors.As` (match a *type*) mirrors the two ways you naturally want to ask about an error: "is this *the* not-found error?" versus "is this *a kind of* validation error, and if so give me its fields?" By unwrapping automatically, both functions free you from caring how many layers of context were added along the way — a layer can wrap freely without breaking a caller's ability to detect the root cause. This decoupling is what makes wrapping safe to use liberally: adding context never hides the underlying cause from code that knows how to ask for it.

### Common Mistakes

**Using `%v` when you meant `%w`.** This is the single most common wrapping bug. `fmt.Errorf("loading config: %v", err)` produces a readable message but *breaks the chain* — `errors.Is`/`errors.As` can no longer see the original error. If any caller might need to detect the cause, you must use `%w`. The two verbs look almost identical, so this is easy to get wrong.

**Comparing wrapped errors with `==`.** Once an error is wrapped, `err == ErrNotFound` is false even though `ErrNotFound` is in the chain. Always use `errors.Is(err, ErrNotFound)` for sentinel comparison; reserve `==` for errors you know are unwrapped.

**Over-wrapping with redundant context.** Wrapping every error at every function with `"funcName: %w"` can produce comically long, repetitive messages like `a: b: c: d: connection refused`. Add context that tells the reader something new (an operation, an identifier), not just the function name. Wrap at meaningful boundaries, not mechanically at every return.

**Leaking internal errors across an API boundary.** Sometimes you *want* to sever the chain — for example, a library returning a generic error to callers without exposing its internal database driver's error type. In that case, `%v` (or a fresh sentinel) is correct, and `%w` would be a leak. Choosing `%w` vs `%v` is a deliberate API decision, not a default.

**Forgetting to implement `Unwrap` on a custom wrapper.** If you build your own error type that holds another error but do not give it an `Unwrap() error` method, `errors.Is`/`errors.As` cannot see past it — the chain stops at your type. Any custom error that contains a cause should implement `Unwrap`.

### Key Takeaways

- Wrapping adds context to an error while preserving the original cause, building an inspectable chain.
- Use `fmt.Errorf("...: %w", err)` to wrap; `%w` preserves the chain, `%v` flattens it to text and severs the link.
- `errors.Is(err, target)` searches the chain for a sentinel value; `errors.As(err, &target)` searches it for a type.
- Never compare wrapped errors with `==`; use `errors.Is`, which unwraps for you.
- Custom error types that hold a cause should implement `Unwrap() error` to participate in the chain.
- Choosing `%w` vs `%v` is an API decision: `%w` exposes the cause to callers, `%v` deliberately hides it across a boundary.

---

## Broken Code

```go
// broken: uses %v instead of %w, severing the chain so errors.Is can't find the cause
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func loadUser(id int) error {
    // The data layer reports a known sentinel error.
    return ErrNotFound
}

func getProfile(id int) error {
    if err := loadUser(id); err != nil {
        // Bug: %v formats the message as text but does NOT wrap the error.
        // The link to ErrNotFound is destroyed; only its string survives.
        return fmt.Errorf("getProfile: user %d: %v", id, err)
    }
    return nil
}

func main() {
    err := getProfile(42)

    // Bug compounded: comparing a (would-be) wrapped error with ==.
    // Even with %w this would be wrong; with %v it is doubly wrong.
    if err == ErrNotFound {
        fmt.Println("handled: user does not exist") // never runs
    } else if errors.Is(err, ErrNotFound) {
        // Also never runs, because %v already broke the chain.
        fmt.Println("handled via errors.Is")
    } else {
        fmt.Println("unhandled error:", err) // this runs — cause is lost
    }
}
```

---

## Correct Code

```go
// correct: %w preserves the cause; errors.Is and errors.As inspect the chain
package main

import (
    "errors"
    "fmt"
)

// A sentinel error the data layer reports and callers can detect.
var ErrNotFound = errors.New("not found")

// A custom wrapper that participates in the chain via Unwrap.
type QueryError struct {
    Query string
    Err   error
}

func (e *QueryError) Error() string { return fmt.Sprintf("query %q: %v", e.Query, e.Err) }
func (e *QueryError) Unwrap() error { return e.Err } // links Err into the chain

func loadUser(id int) error {
    // Wrap the sentinel in a custom type that carries the failing query.
    return &QueryError{
        Query: fmt.Sprintf("SELECT * FROM users WHERE id = %d", id),
        Err:   ErrNotFound,
    }
}

func getProfile(id int) error {
    if err := loadUser(id); err != nil {
        // %w preserves the whole chain (QueryError -> ErrNotFound) and adds context.
        return fmt.Errorf("getProfile: user %d: %w", id, err)
    }
    return nil
}

func main() {
    err := getProfile(42)
    fmt.Println("full message:", err)

    // errors.Is walks the chain and finds the sentinel three layers down.
    if errors.Is(err, ErrNotFound) {
        fmt.Println("detected: the user does not exist")
    }

    // errors.As recovers the custom type from the middle of the chain.
    var qe *QueryError
    if errors.As(err, &qe) {
        fmt.Println("the failing query was:", qe.Query)
    }

    // Demonstrate the success path too.
    if err := getProfileSucceeds(); err == nil {
        fmt.Println("profile loaded successfully")
    }
}

func getProfileSucceeds() error { return nil }
```

---

## Explanation

The broken version makes the most common wrapping mistake: it uses `%v` where it needed `%w`. The message `getProfile: user 42: not found` reads correctly, so at a glance everything looks fine. But `%v` only formats the wrapped error as text — it does not store the underlying error value. The chain is severed at that point, so `errors.Is(err, ErrNotFound)` returns false even though the failure genuinely *was* a not-found. The caller's careful handling logic falls through to the generic "unhandled error" branch, and the program cannot react specifically to a missing user. The `err == ErrNotFound` comparison is also wrong on principle: even a properly wrapped error is never `==` to the sentinel it wraps.

The correct version preserves the cause at every layer. `loadUser` wraps the `ErrNotFound` sentinel inside a `QueryError` that records the failing SQL, and `QueryError` implements `Unwrap` so it participates in the chain. `getProfile` then wraps *that* with `%w`, adding the user ID. The result is a three-link chain: the `getProfile` context, then the `QueryError`, then the root `ErrNotFound`. In `main`, `errors.Is` walks all the way down and detects the sentinel, while `errors.As` reaches into the middle of the chain to recover the `QueryError` and report which query failed. Every layer added context; no layer destroyed information.

This is the whole point of wrapping. The human-readable message grows richer as the error travels up, and simultaneously the machine-readable structure stays intact so that code far from the origin can still ask "was this fundamentally a not-found?" and "what query was involved?" — and get correct answers.

---

## Design Tradeoff

Wrapping trades message verbosity and a small amount of coupling for diagnosability. A fully wrapped error message can get long, and every `%w` site introduces a soft dependency: callers may now rely on `errors.Is`/`errors.As` finding a particular sentinel or type in the chain, which means that sentinel or type becomes part of your effective API contract. Wrap too aggressively and you both clutter the message and expose internals you might later wish to change.

The opposing force is the value of context. An unwrapped `connection refused` bubbling up from deep in a service tells an operator almost nothing; a wrapped `handling GET /users/42: loading profile: query "SELECT ...": connection refused` tells them exactly what failed and why, while still letting code detect the root cause. The right balance is to wrap at meaningful boundaries — where you can add a genuinely new piece of context (an operation name, an identifier, a request) — and to make a conscious choice between `%w` (expose the cause) and `%v` (hide it) at each API edge. Used with that discipline, wrapping gives Go programs the rich, layered diagnostics of exception chaining without leaving the simple world of error values.

---
id: sentinel-vs-typed-errors
phase: 3
phase_title: Error Handling as Design
sequence: 4
title: Sentinel Errors vs Typed Errors
---

## Description

### Concept Overview

There are two fundamentally different ways to let a caller recognize a specific kind of failure in Go, and choosing between them is a real design decision. A **sentinel error** is a single, predeclared error *value* — like `io.EOF` or `sql.ErrNoRows` — that you compare against with `errors.Is`. A **typed error** is a custom error *type* — like a `*ValidationError` — that you recover with `errors.As` to read its fields. Sentinels answer the yes/no question *"is this that specific error?"*. Typed errors answer the richer question *"is this a kind of error, and if so, what are its details?"*.

This kata is about knowing which tool fits which situation. A sentinel is perfect when the error has no payload — there is nothing to report beyond "this exact thing happened." A typed error is the right choice when the caller needs data: which field was invalid, what value was rejected, what status code the server returned. Picking the wrong one leads either to data-less errors that force callers to guess, or to heavyweight types where a single shared value would have been clearer.

Both approaches plug into the same inspection machinery from the wrapping kata — `errors.Is` for sentinels, `errors.As` for types — and both keep working even when the error is wrapped in layers of context.

### Technical Explanation

**Sentinel errors** are package-level variables, conventionally named with an `Err` prefix and created once with `errors.New`:

```go
package store

import "errors"

var ErrNotFound = errors.New("store: item not found")
var ErrClosed   = errors.New("store: connection closed")
```

A function returns the sentinel directly (often wrapped with `%w` for context), and callers detect it with `errors.Is`:

```go
err := store.Get(id)
if errors.Is(err, store.ErrNotFound) {
    // handle the specific "not found" case
}
```

The identity of the sentinel *is* the signal. `errors.Is` compares by value identity (and unwraps the chain), so the same `ErrNotFound` value must be shared by producer and consumer. That is why sentinels are exported package variables.

**Typed errors** are structs (or other types) implementing `error`, recovered with `errors.As`:

```go
type ValidationError struct {
    Field string
    Value any
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("invalid %s: %v", e.Field, e.Value)
}

// caller:
var ve *ValidationError
if errors.As(err, &ve) {
    fmt.Println("offending field:", ve.Field) // structured data, not a string
}
```

The *type* is the signal, and the struct's fields carry the payload.

**Decision guide:**

| Question | Use a sentinel | Use a typed error |
|---|---|---|
| Does the caller need extra data? | No | Yes |
| Is it a single, fixed condition? | Yes | Often a family of cases |
| How does the caller detect it? | `errors.Is` | `errors.As` |
| Example from stdlib | `io.EOF`, `sql.ErrNoRows` | `*os.PathError`, `*json.SyntaxError` |
| Comparison mechanism | value identity | type identity |

**They compose.** You can wrap a typed error around a sentinel, or vice versa, and both inspection styles still work on the same chain (as the previous kata showed). A function can also offer both: a sentinel for the common simple case and a typed error when richer detail is available.

**A subtle cost of sentinels:** because a sentinel is an exported value that callers compare against, it becomes part of your package's public API. Renaming it, removing it, or changing what it represents is a breaking change. The same is true of an exported typed error's fields. Both choices create an API contract — they just expose different things.

### Design Rationale

Go's standard library itself uses both patterns deliberately, which is the best evidence for when each fits. `io.EOF` is a sentinel: reaching the end of a stream carries no extra information — it either happened or it did not — so a single shared value is exactly right, and a `Read` loop checks `errors.Is(err, io.EOF)`. By contrast, `*os.PathError` is a typed error: when a file operation fails, the caller often wants to know the operation (`"open"`), the path, and the underlying OS error, so the failure is modeled as a struct with those fields. The library chose sentinel-or-type case by case, based on whether the failure has a payload.

This two-pronged design exists because Go errors are *values implementing an interface*, which gives you two natural axes of identity: identity-by-value and identity-by-type. **Java's** exception model collapses these into one axis — the class hierarchy — so even a payload-free condition like end-of-stream is a *class* (`EOFException`), and you distinguish errors solely by `catch (SomeType e)`. Go separates the axes: when there is no payload, a value (sentinel) is lighter and clearer than minting a whole type; when there is a payload, a type carries it cleanly. Giving the programmer both tools, rather than forcing every error into a type hierarchy, is a direct consequence of treating errors as plain values.

The rationale also explains the `errors.Is` / `errors.As` split introduced in Go 1.13. `Is` is built for sentinels (value matching); `As` is built for typed errors (type matching). The standard library deliberately provided one inspection function per pattern, signaling that *both* patterns are first-class and supported — neither is a hack or an afterthought. Choosing between them is meant to be a normal part of API design, not a sign you picked the "wrong" style.

### Common Mistakes

**Reaching for a typed error when a sentinel would do.** If a failure carries no data — "the cache is empty," "the stream ended" — defining a whole struct type with an `Error()` method is overkill. A single `errors.New` sentinel is lighter, clearer, and matched with a one-line `errors.Is`. Do not manufacture types that hold nothing.

**Using a sentinel when callers need details.** The opposite mistake. If you return a bare `ErrInvalid` but callers actually need to know *which field* was invalid, they are stuck parsing your message string. When the caller needs data, model the error as a type. A sentinel cannot carry a payload.

**Comparing sentinels with `==` instead of `errors.Is`.** Once any layer wraps the error with `%w`, `err == ErrNotFound` becomes false even though the sentinel is in the chain. Always detect sentinels with `errors.Is`, which unwraps for you. This is the same trap as in the wrapping kata, and it bites hardest with sentinels.

**Defining sentinels with `var Err = fmt.Errorf(...)` that includes runtime data.** A sentinel must be a fixed, shared value. If you build it with formatted runtime data, every call produces a *different* value, and `errors.Is` will not match. Sentinels are static; use `errors.New` with a constant message, and add runtime context by *wrapping* the sentinel, not by baking data into it.

**Forgetting that exported sentinels and typed-error fields are API.** Callers depend on `store.ErrNotFound` and on a typed error's public fields. Renaming or removing them, or changing their meaning, breaks downstream code silently (no compile error for a changed *meaning*). Treat both as part of your public contract and evolve them carefully.

### Key Takeaways

- A **sentinel error** is a single shared value (`var ErrX = errors.New(...)`) detected with `errors.Is`; use it when the failure carries no extra data.
- A **typed error** is a custom type recovered with `errors.As`; use it when the caller needs structured details about the failure.
- Detect sentinels with `errors.Is`, never `==`, so detection survives wrapping.
- Sentinels must be static values created once with `errors.New` — do not bake runtime data into them; add context by wrapping.
- The standard library uses both (`io.EOF` is a sentinel, `*os.PathError` is typed) — choose per case based on whether there is a payload.
- Both exported sentinels and exported typed-error fields become part of your public API contract and must be evolved carefully.

---

## Broken Code

```go
// broken: a sentinel is rebuilt per-call with fmt.Errorf, so errors.Is never matches;
// and the caller compares with == against a wrapped error
package main

import (
    "errors"
    "fmt"
)

// Bug: this is NOT a stable sentinel. Each call to notFound() returns a brand
// new error value, so errors.Is comparisons against any single instance fail.
func notFound(id int) error {
    return fmt.Errorf("item %d not found", id) // different value every time
}

func get(id int) error {
    if err := notFound(id); err != nil {
        // Wrapped for context — fine in principle...
        return fmt.Errorf("get: %w", err)
    }
    return nil
}

func main() {
    err := get(7)

    // We try to recognize the "not found" condition, but there is no stable
    // sentinel to compare against. We invent one here, which can never match
    // the per-call value produced above.
    sentinel := errors.New("item 7 not found")

    if err == sentinel {
        fmt.Println("handled via ==") // never: == on wrapped error, different value
    } else if errors.Is(err, sentinel) {
        fmt.Println("handled via errors.Is") // never: not the same value
    } else {
        fmt.Println("could not classify error:", err) // always runs
    }
}
```

---

## Correct Code

```go
// correct: a stable sentinel for the payload-free case and a typed error for the
// case that needs structured data; both detected through a wrapped chain
package main

import (
    "errors"
    "fmt"
)

// Sentinel: a single, shared, static value. Detected with errors.Is.
var ErrNotFound = errors.New("not found")

// Typed error: carries structured data. Recovered with errors.As.
type ValidationError struct {
    Field string
    Value any
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("invalid %s: %v", e.Field, e.Value)
}

// lookup returns the sentinel (the failure has no payload), wrapped for context.
func lookup(id int) error {
    if id == 7 {
        return fmt.Errorf("lookup: id %d: %w", id, ErrNotFound)
    }
    return nil
}

// save returns a typed error (the caller needs to know which field was bad),
// also wrapped for context.
func save(age int) error {
    if age < 0 {
        ve := &ValidationError{Field: "age", Value: age}
        return fmt.Errorf("save: %w", ve)
    }
    return nil
}

func main() {
    // Sentinel detection through the wrapped chain.
    if err := lookup(7); err != nil {
        if errors.Is(err, ErrNotFound) {
            fmt.Println("classified: not found (sentinel matched through wrapping)")
        } else {
            fmt.Println("unexpected:", err)
        }
    }

    // Typed-error recovery through the wrapped chain.
    if err := save(-5); err != nil {
        var ve *ValidationError
        if errors.As(err, &ve) {
            fmt.Printf("classified: validation error on %q (value %v)\n", ve.Field, ve.Value)
        } else {
            fmt.Println("unexpected:", err)
        }
    }

    // Success paths return a true nil.
    if err := lookup(1); err == nil {
        fmt.Println("lookup(1): found")
    }
    if err := save(30); err == nil {
        fmt.Println("save(30): ok")
    }
}
```

---

## Explanation

The broken version fails because it confuses a *formatted message* with a *sentinel*. A sentinel error works only if producer and consumer share the exact same value, because `errors.Is` ultimately matches by identity. But `notFound` builds a fresh error with `fmt.Errorf` on every call, so there is no stable value to compare against. The caller, having no real sentinel to reference, conjures one with `errors.New("item 7 not found")` — a different value entirely — and naturally neither `==` nor `errors.Is` matches. The error cannot be classified, even though semantically it clearly *is* a not-found. The lesson: a sentinel must be one shared, static value, created once with `errors.New`.

The correct version shows both patterns applied to the cases that suit them. The not-found condition has no payload — there is nothing useful to report beyond "this happened" — so it is modeled as the sentinel `ErrNotFound`, declared once at package level and detected with `errors.Is`. The validation failure *does* have a payload — the caller wants to know the field and value — so it is modeled as the typed `*ValidationError`, recovered with `errors.As`. Crucially, both functions wrap their errors with `%w` to add context, and both inspections still succeed, because `errors.Is` and `errors.As` walk the entire chain. Wrapping for humans and classifying for machines coexist.

Side by side, the two patterns make the design rule concrete: choose a sentinel when the answer is a simple "yes, that specific thing," and a typed error when the caller needs to ask "what exactly went wrong?" and read the details.

---

## Design Tradeoff

The choice between sentinels and typed errors trades simplicity against richness, and each direction has a cost. Sentinels are minimal — one value, one `errors.Is` check — but they can carry no data, so if requirements later grow ("we now need to know *which* item was not found, with metadata"), a sentinel forces an awkward migration to a type. Typed errors are richer but heavier: a struct, an `Error()` method, exported fields that become API, and `errors.As` plumbing at every call site that cares. Over-applying types turns trivial conditions into ceremony; over-applying sentinels leaves callers data-starved and tempted to parse message strings.

The guiding principle is to match the tool to the information content of the failure. If the failure is fully described by its identity, a sentinel is the clearest possible expression of it. If the failure carries detail the caller must act on, a type is the honest model. Because Go gives you both `errors.Is` and `errors.As`, and because the two compose freely within a single wrapped chain, you are not locked in: a package can expose a sentinel for the common case and a typed error for the detailed case, and even start with a sentinel and graduate to a type when a real need appears. Designing errors well means making that judgment deliberately, per failure, rather than defaulting every error to one style.

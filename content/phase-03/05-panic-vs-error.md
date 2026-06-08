---
id: panic-vs-error
phase: 3
phase_title: Error Handling as Design
sequence: 5
title: When to Panic vs Return Error
---

## Description

### Concept Overview

Go gives you two mechanisms for signaling that something went wrong, and they are *not* interchangeable. Returning an `error` is for **expected, recoverable** failures — the file might not exist, the input might be malformed, the network might be down. These are ordinary outcomes that a well-written program anticipates and handles. `panic` is for **unexpected, programmer-level** failures — a bug, a violated invariant, an impossible state. A panic says "this should never happen; the program is in a state it was never designed to be in."

The defining rule of idiomatic Go is: **return errors for things that can go wrong; panic for things that should never go wrong.** A missing config file is an error. Indexing past the end of a slice is a panic. Confusing the two is one of the most common mistakes programmers bring from exception-based languages, where `throw` is used for *all* failures. In Go, reaching for `panic` to handle a routine failure is a code smell — it turns a recoverable situation into a program-ending event and bypasses the explicit, caller-visible error handling that makes Go programs robust.

This kata also covers `recover`, the mechanism that can stop a panic from crashing the program, and the narrow, legitimate situations where it belongs.

### Technical Explanation

**What `panic` does.** Calling `panic(v)` immediately stops the normal flow of the current function. It runs any deferred functions in the current goroutine, then propagates up the call stack, running deferreds at each level, until either a `recover` catches it or it reaches the top of the goroutine — at which point the program prints the panic value and a stack trace and exits with a non-zero status.

```go
func mustPositive(n int) {
    if n <= 0 {
        panic(fmt.Sprintf("mustPositive: got %d, want > 0", n)) // unwinds the stack
    }
}
```

**What `recover` does.** `recover` is a built-in that stops a panicking sequence and returns the value passed to `panic`. It only has an effect when called *directly inside a deferred function*. Outside a deferred function (or when there is no active panic), it returns `nil` and does nothing.

```go
func safeRun(work func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            // Convert the panic into an ordinary error at a boundary.
            err = fmt.Errorf("recovered from panic: %v", r)
        }
    }()
    work()
    return nil
}
```

This `defer`/`recover` pattern is how you convert a panic back into an error at a controlled boundary — for example, an HTTP server that recovers from a handler panic so one bad request does not crash the whole server.

**Where panics legitimately occur:**

| Situation | Why it panics |
|---|---|
| Out-of-range slice/array index | Memory-safety violation — a bug |
| Nil map write, nil pointer deref | Invalid operation on uninitialized data |
| Integer divide by zero | Undefined arithmetic |
| Type assertion `x.(T)` that fails (one-value form) | Wrong assumption about a type |
| Explicit `panic` for a violated invariant | "impossible" state reached |

**The `Must` convention.** A small idiom: helpers prefixed with `Must` (like `regexp.MustCompile`, `template.Must`) panic instead of returning an error, and are intended *only* for package-level initialization where a failure means the program is fundamentally misconfigured and cannot run. `regexp.MustCompile` is fine for a constant pattern at startup; it would be wrong for a user-supplied pattern, which should return an error.

**Panics and goroutines.** A panic that is not recovered *in the same goroutine* crashes the entire program — you cannot recover a panic from goroutine A in goroutine B. This is why long-lived worker goroutines that run untrusted or risky code often have their own top-level `defer`/`recover`.

### Design Rationale

Go deliberately makes `panic` awkward to use for routine errors so that programmers do not reach for it the way they reach for exceptions elsewhere. In **Java**, **Python**, **C++**, and **C#**, `throw` is the *primary* error mechanism: file-not-found, bad input, and genuine bugs all surface as exceptions, distinguished only by type. The result is that "normal" failures and "this is a bug" failures look identical at the call site, and the happy path hides every failure mode. Go splits these into two visibly different mechanisms on purpose: returned errors for the expected failures that pervade real programs, and panic for the rare programmer-error case.

This split reinforces Go's central theme that **errors are values and failure should be explicit**. If routine failures were panics, they would propagate invisibly up the stack like exceptions, defeating the whole point of putting `error` in function signatures. By reserving panic for bugs and invariant violations, Go keeps the common failure path explicit and local (the `if err != nil` you check at the call site) while still providing a stack-unwinding escape hatch for the truly exceptional. The asymmetry is intentional: you should *feel* that panicking is a heavier, more drastic act than returning an error.

`recover` exists not to emulate `try/catch` but to let you draw a **boundary** around code that might panic — the top of a request handler, a plugin host, a worker loop — so a single unexpected failure degrades gracefully (drop one request) instead of catastrophically (crash the server). The fact that `recover` only works inside a deferred function, and only in the panicking goroutine, keeps this boundary explicit and prevents `recover` from being scattered around as a general control-flow tool. Go's designers built panic/recover to be *possible* but *inconvenient* for everyday use, precisely so the language's culture would settle on returned errors as the default.

### Common Mistakes

**Panicking on expected failures.** The biggest mistake: `panic`-ing when a file is missing, input is invalid, or a network call fails. These are normal, anticipated outcomes that callers should handle. Panicking turns a recoverable situation into a crash and removes the caller's ability to respond. Return an `error`.

**Using `panic`/`recover` as `try`/`catch`.** Programmers from exception languages sometimes panic deep in a call stack and recover high up, using it as general control flow. This is non-idiomatic, hides failures from signatures, and surprises every Go reader. Reserve recover for genuine boundaries, not routine branching.

**Calling `recover` outside a deferred function.** `recover` only stops a panic when called *directly* inside a `defer`. Calling it in the normal body, or inside a function called by the deferred function, returns `nil` and does nothing — the panic keeps propagating. The pattern must be `defer func() { if r := recover(); r != nil { ... } }()`.

**Expecting to recover a panic from another goroutine.** A panic in a goroutine can only be recovered within that same goroutine. A `recover` in `main` will not catch a panic in a goroutine you launched; that panic crashes the whole program. Each risky goroutine needs its own deferred recover.

**Overusing the `Must` idiom.** `MustCompile`-style helpers are fine for fixed, program-defined values at startup, where failure means the binary is broken. Using them on runtime or user-supplied data turns a normal validation failure into a crash. If the input can vary at runtime, use the error-returning variant.

### Key Takeaways

- Return an `error` for expected, recoverable failures; use `panic` only for bugs, violated invariants, and truly impossible states.
- A panic unwinds the stack running deferreds and, if not recovered, crashes the program with a stack trace.
- `recover` only works when called directly inside a deferred function, and only catches panics in the *same* goroutine.
- Use `defer`/`recover` to convert a panic into an error at a controlled boundary (server handler, worker loop), not as general `try`/`catch`.
- The `Must` idiom (panic on failure) is for fixed startup values only — never for runtime or user-supplied data.
- Panicking on routine failures is a code smell: it removes the caller's ability to handle the situation and breaks Go's explicit error model.

---

## Broken Code

```go
// broken: panics on an expected, recoverable failure and tries to recover it
// in a way that doesn't even work, instead of just returning an error
package main

import (
    "fmt"
    "strconv"
)

// Bug: parsing user input is an EXPECTED failure. Panicking on it removes the
// caller's ability to handle a bad value and threatens to crash the program.
func parsePort(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        panic("invalid port: " + s) // wrong: this is a routine, recoverable error
    }
    return n
}

func main() {
    // Bug: recover() called OUTSIDE a deferred function does nothing.
    // This looks like it guards the call, but it cannot stop the panic.
    if r := recover(); r != nil {
        fmt.Println("recovered:", r) // never runs — no active panic here yet
    }

    port := parsePort("not-a-port") // panics, unwinds, and crashes the program
    fmt.Println("listening on port", port)
}
```

---

## Correct Code

```go
// correct: return errors for expected failures; reserve panic for invariant
// violations; use defer/recover only at a controlled boundary
package main

import (
    "errors"
    "fmt"
)

var ErrInvalidPort = errors.New("invalid port")

// parsePort treats a bad value as an EXPECTED failure and returns an error.
func parsePort(s string) (int, error) {
    n := 0
    for _, c := range s {
        if c < '0' || c > '9' {
            return 0, fmt.Errorf("parsePort %q: %w", s, ErrInvalidPort)
        }
        n = n*10 + int(c-'0')
    }
    if s == "" || n < 1 || n > 65535 {
        return 0, fmt.Errorf("parsePort %q: %w", s, ErrInvalidPort)
    }
    return n, nil
}

// mustIndex panics on a violated invariant: callers promise i is in range.
// A failure here means a BUG in the caller, not a recoverable runtime condition.
func mustIndex(data []int, i int) int {
    if i < 0 || i >= len(data) {
        panic(fmt.Sprintf("mustIndex: index %d out of range for len %d", i, len(data)))
    }
    return data[i]
}

// safeRun draws a boundary: it converts any panic from work into an error,
// so one buggy unit of work does not crash the whole program.
func safeRun(work func()) (err error) {
    defer func() {
        if r := recover(); r != nil { // recover MUST be inside the deferred func
            err = fmt.Errorf("safeRun recovered: %v", r)
        }
    }()
    work()
    return nil
}

func main() {
    // Expected failure -> handled as a value, no crash.
    for _, in := range []string{"8080", "not-a-port"} {
        port, err := parsePort(in)
        if err != nil {
            if errors.Is(err, ErrInvalidPort) {
                fmt.Printf("rejecting %q: invalid port\n", in)
            }
            continue
        }
        fmt.Println("would listen on port", port)
    }

    // Invariant violation -> panic, but contained at a boundary by safeRun.
    err := safeRun(func() {
        data := []int{10, 20, 30}
        _ = mustIndex(data, 99) // caller bug: panics
    })
    if err != nil {
        fmt.Println("contained a bug:", err)
    }

    fmt.Println("program continues normally")
}
```

---

## Explanation

The broken version makes two classic panic mistakes. First, it panics on a *parse failure* — but malformed input is an entirely expected, recoverable situation. By panicking, `parsePort` strips the caller of any chance to respond gracefully; a single bad value crashes the program. The correct response to bad input is to return an `error`, leaving the decision of how to react to the caller. Second, it tries to guard the call with a bare `recover()` in `main`'s normal body. But `recover` only does anything when called *directly inside a deferred function* during an active panic. Here there is no `defer` and no panic yet, so `recover()` returns `nil`, the guard does nothing, and the subsequent panic sails right past it and crashes.

The correct version draws the line where Go intends it. `parsePort` treats invalid input as an expected failure and returns an `ErrInvalidPort`-wrapped error, which `main` inspects with `errors.Is` and handles by simply rejecting the value — no crash, full control. `mustIndex`, by contrast, panics, but only on a *violated invariant*: its contract requires the caller to pass an in-range index, so an out-of-range index is a *bug*, not a runtime condition to negotiate. Finally, `safeRun` shows the legitimate use of `defer`/`recover`: it wraps a unit of work in a boundary that converts any panic into an ordinary error, so even a buggy callback degrades into a handled error instead of taking down the process. The program prints "program continues normally" because the panic was contained at exactly the right place.

The throughline is intent. Errors communicate *anticipated* failure to callers as values they must handle. Panics announce *unanticipated* failure — a broken assumption — and crash unless explicitly contained at a boundary you chose deliberately.

---

## Design Tradeoff

The panic-versus-error distinction trades a small loss of convenience for a large gain in clarity about *what a failure means*. It would be easier, in the moment, to `panic` everywhere — no return values to thread, no `if err != nil` to write, just throw and forget, the way exception-based languages encourage. Go rejects that ease on purpose. By making panic the heavy, drastic option and errors the lightweight, routine one, the language pushes you to categorize every failure: is this a normal outcome the caller should handle, or a bug that means the program's assumptions are broken? That categorization is itself valuable design information, encoded directly in whether you return or panic.

The cost is that you must keep the discipline, and the boundary cases require judgment — when is an invariant truly "impossible" versus merely "unlikely"? Lean toward returning errors: an error gives the caller options, while a panic takes them away, and an error wrongly chosen merely adds a branch, whereas a panic wrongly chosen can crash a production service. Reserve panic for genuine programmer errors and reserve `recover` for explicit boundaries where graceful degradation matters more than a clean crash. Held to consistently, this division keeps the common path explicit and recoverable while still allowing the program to fail loudly and immediately when it reaches a state it was never designed to handle — which is exactly when failing loud is the safest thing to do.

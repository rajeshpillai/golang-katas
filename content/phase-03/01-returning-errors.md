---
id: returning-errors
phase: 3
phase_title: Error Handling as Design
sequence: 1
title: Returning Errors
---

## Description

### Concept Overview

In Go, errors are values. They are not exceptions that unwind the stack, not special control-flow constructs, and not magic objects handled by an invisible runtime mechanism. An error in Go is simply a value that a function returns alongside its normal results. The convention is universal: a function that can fail returns an `error` as its **last** return value, and the caller checks it explicitly.

This is the foundational idea of error handling in Go. Before you can build custom error types, wrap errors, or decide when to panic, you must internalize the basic shape: failure is communicated by returning a value, and the caller is responsible for inspecting that value. There is no `try`, no `catch`, no `throw`. There is only `return err` and `if err != nil`.

The `error` type itself is an interface — the smallest meaningful interface in the standard library. Any value that has an `Error() string` method satisfies it. This means errors are ordinary data: you can store them, compare them, pass them around, and build new ones. Treating errors as values is what makes Go's error handling explicit, composable, and impossible to ignore by accident.

### Technical Explanation

**The `error` interface** is defined in the Go builtin package as:

```go
type error interface {
    Error() string
}
```

That is the entire definition. Any type with a method `Error() string` is an `error`. The standard library provides two convenient constructors for the common case where you just need a message:

```go
import (
    "errors"
    "fmt"
)

err1 := errors.New("file not found")
err2 := fmt.Errorf("could not open %q: code %d", "data.txt", 404)
```

`errors.New` creates a simple error from a static string. `fmt.Errorf` formats a message like `fmt.Sprintf` and returns it as an error — useful when the message needs runtime data.

**The return convention** places the error last:

```go
func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}
```

Two things are critical here. First, when there *is* an error, the other return values should be their zero values (or otherwise unusable) — the caller must not trust them. Second, when there is *no* error, you return `nil` for the error. `nil` is the zero value of the `error` interface, and it means "success."

**The caller's obligation** is the matching half of the convention:

```go
result, err := divide(10, 0)
if err != nil {
    // handle the failure — do not use result
    fmt.Println("error:", err)
    return
}
fmt.Println("result:", result) // safe to use only here
```

The `if err != nil` check is the single most common pattern in Go code. It appears everywhere, and that ubiquity is intentional. The error is right there in the return signature, and the compiler-friendly convention makes it natural to handle failure immediately, at the call site, where you have the most context.

| Concept | Go form |
|---|---|
| Error type | `error` interface (`Error() string`) |
| Create from string | `errors.New("...")` |
| Create with formatting | `fmt.Errorf("...%d", n)` |
| Success sentinel | `return value, nil` |
| Caller check | `if err != nil { ... }` |

### Design Rationale

Go deliberately rejected exceptions for ordinary error handling, and the choice is one of the most debated aspects of the language. Compare with the alternatives:

**Java**, **C++**, and **C#** use exceptions. A method that fails `throw`s, and the exception propagates up the call stack until some `catch` block handles it — or the program crashes. The problem is that exceptions are *invisible* in a function's signature (in Java, checked exceptions try to fix this, but they are widely disliked and often suppressed). When you call a method, you usually cannot tell from the call site whether it might throw, what it might throw, or where it will be caught. Control flow jumps across many stack frames invisibly. This makes reasoning about failure paths hard, and it makes it easy to write code that looks correct but leaks resources or leaves state half-updated when an exception fires.

**C** returns error codes (often an `int` or a special return value like `-1` or `NULL`), with the actual error detail stashed in a global `errno`. This is explicit, but error and value share one return slot, so conventions are inconsistent and the detail is decoupled from the call. It is also trivially easy to ignore a return code with no warning.

**Go's** approach keeps the explicitness of C's return codes but fixes their weaknesses: the error is a real, structured value (not a global), it occupies its own return slot (so the normal result is unambiguous), and it is part of the function signature for all to see. There is no hidden control flow. When you read a Go function call, you can see immediately that it can fail, because it returns an `error`. The cost is verbosity — the famous `if err != nil` repetition — but Go's designers chose that verbosity deliberately. As Rob Pike put it, *"errors are values,"* and treating them as values means you can program with them: inspect them, combine them, and handle them with ordinary code rather than a separate exception sublanguage.

### Common Mistakes

**Ignoring the returned error.** The most dangerous mistake is writing `result, _ := mightFail()` and using `result` anyway. The `_` blank identifier silently discards the error, and you proceed as if nothing went wrong — but `result` may be a zero value or garbage. Tools like `errcheck` and `go vet` exist precisely because this is so easy to do. Ignore an error only when you have a deliberate, documented reason.

**Using return values when the error is non-nil.** When a function returns `(value, err)` and `err != nil`, the `value` is generally meaningless. Writing code that uses `result` *before* checking `err` is a logic bug. The idiom is always: check the error first, then use the value only in the success branch.

**Returning a non-nil error together with a valid result.** The flip side of the above. If your function succeeds, return `nil` for the error. Returning a partially-valid result alongside a non-nil error confuses callers, because the contract is "non-nil error means the result is not usable." Pick one outcome per call.

**Putting the error anywhere but last.** Go convention is rigid: the error is the final return value. Writing `func f() (error, int)` compiles, but it violates every reader's expectation and breaks idiomatic patterns like `v, err := f()`. Always put `error` last.

**Comparing errors with string matching.** Beginners sometimes write `if err.Error() == "file not found"`. This is fragile — the message can change, and it ignores Go's structured comparison tools (`errors.Is`, `errors.As`, covered in later katas). Treat the error message as human-readable text, not a machine-readable key.

### Key Takeaways

- An `error` in Go is just a value: any type with an `Error() string` method satisfies the built-in `error` interface.
- Functions that can fail return `error` as their **last** return value; success is signaled by returning `nil`.
- The caller must check `if err != nil` and only use the other return values in the success path.
- Use `errors.New` for static messages and `fmt.Errorf` when the message needs runtime data.
- Go uses returned error values instead of exceptions so that failure is explicit, visible in the signature, and free of hidden control flow.
- Never silently discard an error with `_` unless you have a deliberate, documented reason.

---

## Broken Code

```go
// broken: this program ignores the returned error and uses a result it must not trust
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // strconv.Atoi returns (int, error). Here we discard the error with _.
    // When parsing fails, n is 0 (the zero value), but we proceed as if it succeeded.
    n, _ := strconv.Atoi("not-a-number")

    // Bug: n is 0 because parsing FAILED, not because the input was "0".
    // We have no way to tell the difference, and the program silently
    // produces a wrong answer instead of reporting the failure.
    fmt.Println("doubled:", n*2) // prints "doubled: 0" — looks fine, is wrong

    // The same mistake, hand-rolled: using the result before checking the error.
    result, err := divide(10, 0)
    fmt.Println("result before check:", result) // uses result regardless of err
    if err != nil {
        fmt.Println("error:", err)
    }
}

func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, fmt.Errorf("cannot divide %d by zero", a)
    }
    return a / b, nil
}
```

---

## Correct Code

```go
// correct: errors are returned as values and checked explicitly before use
package main

import (
    "errors"
    "fmt"
    "strconv"
)

// divide returns an error as its last return value. On failure, the int
// result is the zero value and must not be used by the caller.
func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

// parseAndDouble shows propagating an error from a standard library call.
// fmt.Errorf adds context (the offending input) to the underlying failure.
func parseAndDouble(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parseAndDouble: %q is not a valid integer", s)
    }
    return n * 2, nil
}

func main() {
    // Success path: error is nil, so the result is safe to use.
    if q, err := divide(10, 2); err != nil {
        fmt.Println("divide error:", err)
    } else {
        fmt.Println("10 / 2 =", q)
    }

    // Failure path: we check the error FIRST and never touch the result.
    if q, err := divide(10, 0); err != nil {
        fmt.Println("divide error:", err)
    } else {
        fmt.Println("10 / 0 =", q) // unreachable on failure
    }

    // Propagated error from strconv via parseAndDouble.
    for _, in := range []string{"21", "not-a-number"} {
        d, err := parseAndDouble(in)
        if err != nil {
            fmt.Println("parse error:", err)
            continue
        }
        fmt.Printf("doubled %q -> %d\n", in, d)
    }
}
```

---

## Explanation

The broken version commits the two most common error-handling sins at once. First, it discards the error from `strconv.Atoi` using the blank identifier `_`. When `"not-a-number"` fails to parse, `Atoi` returns `(0, someError)` — but because the error is thrown away, the program treats the `0` as if it were a successfully parsed value. The output `doubled: 0` looks perfectly reasonable, which is exactly what makes the bug dangerous: nothing crashes, nothing complains, and the wrong answer flows silently downstream. Second, it prints `result` from `divide` *before* checking `err`, using a value the contract says is meaningless when the error is non-nil.

The correct version follows the Go convention precisely. Every function that can fail returns `error` last and returns `nil` on success. Every caller checks the error before touching the result. In `parseAndDouble`, notice how we do not just pass `strconv`'s error along blindly — we use `fmt.Errorf` to add context (`%q is not a valid integer`) so the eventual reader knows *which* operation failed and on *what* input. This is the seed of error wrapping, which the later katas develop further.

The structural discipline here — error last, check immediately, use the value only in the success branch — is not bureaucracy. It is what makes Go programs robust. Because the failure path is visible at every call site, you are constantly reminded to handle it, and the compiler-friendly idiom makes handling it the path of least resistance.

---

## Design Tradeoff

Returning errors as values trades brevity for clarity. A Go program that handles errors properly is more verbose than the equivalent exception-based program, where the happy path reads cleanly and failures are dealt with far away in a `catch` block. Critics of Go point to the endless `if err != nil { return err }` blocks as noise. There is truth to this: in code with many sequential fallible operations, the error checks can outnumber the business logic.

But the tradeoff buys something valuable. Because errors are ordinary return values, failure is impossible to overlook at the call site, control flow never jumps invisibly across stack frames, and you can reason about every function's failure modes just by reading its signature. You can also program *with* errors — store them, compare them, wrap them, and build richer error values — using the same language tools you use for everything else, rather than a separate exception mechanism. Go's designers bet that the readability and local reasoning gained from explicit error values are worth the extra lines, especially in the large, long-lived codebases Go targets, where code is read far more often than it is written.

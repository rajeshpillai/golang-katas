---
id: testing-package
phase: 8
phase_title: Testing & Tooling
sequence: 1
title: The testing Package
---

## Description

### Concept Overview

Testing in Go is not an afterthought bolted on with a third-party library — it is part of the language toolchain. The `testing` package ships with the standard library, and the `go test` command knows how to find, compile, and run your tests without any configuration. There is no test runner to install, no XML configuration, no annotations, and no assertion DSL to learn. A test in Go is just a function with a specific signature in a file ending in `_test.go`.

The contract is simple and rigid. A test function must be named with a `Test` prefix followed by a capitalized word, and it must accept a single parameter of type `*testing.T`. Inside that function, you call your code, compare the result to what you expect, and if it is wrong, you call a method on the `*testing.T` value to record the failure. That is the entire model. Go deliberately gives you no `assertEquals`, no `should`, no `expect` — just plain Go code and a handful of methods like `t.Errorf` and `t.Fatalf`.

### Technical Explanation

A test lives in a file whose name ends in `_test.go`. These files are compiled only when you run `go test` and are excluded from normal `go build` output, so test code never ships in your binary. Test files conventionally live in the same package as the code they test (white-box testing), or in a `package foo_test` companion package (black-box testing, which can only touch exported identifiers).

A test function has this exact signature:

```go
func TestAdd(t *testing.T) {
    got := Add(2, 3)
    want := 5
    if got != want {
        t.Errorf("Add(2, 3) = %d; want %d", got, want)
    }
}
```

The `*testing.T` value is your handle into the test framework. Its most important methods fall into two groups:

- **Non-fatal failures** — `t.Error` and `t.Errorf` mark the test as failed but let the rest of the function continue running. Use these when subsequent checks are still meaningful after one fails.
- **Fatal failures** — `t.Fatal` and `t.Fatalf` mark the test as failed and immediately stop the current test function by calling `runtime.Goexit`. Use these when continuing makes no sense, for example after a setup step that returns an error and a `nil` value you are about to dereference.

Other useful methods on `*testing.T`:

- `t.Log` / `t.Logf` record output that is shown only when the test fails or when you pass `-v` (verbose). This keeps passing runs quiet.
- `t.Run(name, fn)` launches a subtest (covered in its own kata).
- `t.Helper()` marks a function as a test helper so that failure line numbers point at the caller, not the helper.
- `t.Cleanup(fn)` registers a function to run when the test finishes, even if it fails — the idiomatic replacement for `defer` in tests.
- `t.Skip` / `t.Skipf` skip a test at runtime (e.g. when an environment variable is missing).
- `t.Parallel()` signals that this test can run concurrently with other parallel tests.

The companion type `*testing.B` drives benchmarks (its own kata), and `*testing.M` lets you write a `TestMain(m *testing.M)` function to run setup and teardown around the whole test binary. The `go vet` tool understands the `testing` package well enough to warn you about mistakes like a `Test` function with the wrong signature, or a printf-style format string that does not match its arguments.

A real assertion-style test compares a computed value to an expected one. Because Go has no built-in assertion library, the idiomatic pattern is the explicit `if got != want { t.Errorf(...) }`. The error message you write is the diagnostic — Go encourages you to print both the inputs and the `got`/`want` values so a failure is self-explanatory without a debugger.

### Design Rationale

Most languages relegate testing to a framework: Java has JUnit, Python has `unittest` and `pytest`, Ruby has RSpec, C# has NUnit and xUnit. These frameworks are powerful but they fragment the ecosystem — different projects pick different runners, different assertion libraries, and different conventions, so every codebase tests differently. Go's designers decided that testing is so fundamental that it belongs in the standard toolchain, the same way the compiler and formatter do. The result is that *every* Go project tests the same way. You can open any Go repository and immediately know how to run and read its tests.

Go also deliberately omits an assertion DSL. Frameworks like JUnit accumulate dozens of matcher methods (`assertEquals`, `assertThat`, `assertNotNull`, `assertThrows`), each with its own failure formatting. Go's position is that you already know how to write a comparison in Go — `if got != want` — so a separate vocabulary is just one more thing to learn and one more layer between you and the failure. The cost is slightly more verbose tests; the benefit is that a test is just ordinary Go code, fully debuggable and obvious to any Go programmer. When the comparison is genuinely complex (deep structs, slices), the standard library gives you `reflect.DeepEqual`, and the wider ecosystem offers `google/go-cmp` for readable diffs.

### Common Mistakes

**Misnaming the test function.** `go test` only runs functions matching `Test[A-Z]...` with the `*testing.T` parameter. Writing `func testAdd(t *testing.T)` (lowercase `t`) or `func TestAdd()` (missing the parameter) means the function is silently never run. There is no error — your "passing" test suite simply never executed that test. `go vet` catches some of these, which is why running `go vet` alongside `go test` matters.

**Using `t.Fatal` from a goroutine.** `t.Fatal` calls `runtime.Goexit`, which only stops the goroutine it runs in. If you call it from a goroutine you spawned, it kills that goroutine but the test keeps running and may report a false pass. Failures from goroutines must be reported with `t.Error`, ideally coordinated back to the main test goroutine.

**Forgetting that `t.Log` output is hidden on success.** Beginners add `t.Log` for debugging, see nothing, and assume it did not run. By design, log output appears only on failure or under `-v`. This keeps a green test run clean, but it surprises people expecting `println`-style behavior.

**Continuing after a fatal-worthy error with `t.Error`.** If a setup call returns `(nil, err)` and you log with `t.Error` but keep going, the next line dereferences `nil` and the test panics with a confusing stack trace instead of a clean failure. Use `t.Fatal` when the value you got back is unusable.

**Shipping test helpers without `t.Helper()`.** When an assertion lives in a shared helper, failures report the helper's line number, not the test's. Without `t.Helper()`, every failure points at the same unhelpful line inside the helper.

### Key Takeaways

- A Go test is a function `func TestXxx(t *testing.T)` in a `_test.go` file — no framework, no annotations, no runner to install.
- `t.Error`/`t.Errorf` fail but continue; `t.Fatal`/`t.Fatalf` fail and stop the current test function immediately.
- `t.Log`/`t.Logf` output is hidden on success and shown only on failure or with `-v`.
- Go ships no assertion library on purpose — write `if got != want { t.Errorf(...) }` and make the message self-explanatory with inputs and `got`/`want`.
- Test files are compiled only by `go test` and never ship in your production binary.
- Run `go vet` alongside `go test` to catch misnamed tests and bad format strings the compiler accepts.

---

## Broken Code

```go
// broken: this "test" never runs and never asserts anything
package mathx

import "testing"

// Bug 1: lowercase "test" prefix — go test ignores this entirely.
// Bug 2: no failure is ever recorded; even if it ran it would always pass.
func testAdd(t *testing.T) {
    got := Add(2, 3)
    want := 5
    if got == want {
        // logs nothing useful, and on mismatch does NOT fail the test
        t.Log("values matched")
    }
}

// Bug 3: wrong signature — no *testing.T parameter, so it is not a test.
func TestSubtract() {
    if Subtract(5, 3) != 2 {
        panic("subtract is wrong") // panicking is not how you report a test failure
    }
}

func Add(a, b int) int      { return a + b }
func Subtract(a, b int) int { return a - b }
```

---

## Correct Code

```go
// correct: runnable demonstration of the testing model.
// NOTE: the platform runs this with `go run`, so we mimic what *testing.T does
// using inline PASS/FAIL checks. The real test form is shown in the Description.
package main

import "fmt"

// Add and Subtract are the functions under test.
func Add(a, b int) int      { return a + b }
func Subtract(a, b int) int { return a - b }

// check mimics the explicit `if got != want { t.Errorf(...) }` pattern that a
// real func TestXxx(t *testing.T) would use. It returns whether the case passed.
func check(name string, got, want int) bool {
    if got != want {
        fmt.Printf("FAIL: %s = %d; want %d\n", name, got, want)
        return false
    }
    fmt.Printf("PASS: %s = %d\n", name, got)
    return true
}

func main() {
    allPassed := true

    // Each call below is the body of what a single TestXxx function would do.
    allPassed = check("Add(2, 3)", Add(2, 3), 5) && allPassed
    allPassed = check("Add(-1, 1)", Add(-1, 1), 0) && allPassed
    allPassed = check("Subtract(5, 3)", Subtract(5, 3), 2) && allPassed
    allPassed = check("Subtract(0, 4)", Subtract(0, 4), -4) && allPassed

    fmt.Println()
    if allPassed {
        fmt.Println("ALL CHECKS PASSED")
    } else {
        fmt.Println("SOME CHECKS FAILED")
    }
}
```

---

## Explanation

The broken version fails in three ways that the Go toolchain will not save you from at compile time. First, `testAdd` uses a lowercase prefix, so `go test` does not recognize it as a test and never runs it — the test suite reports success while silently skipping your check. Second, even if it ran, its logic is inverted: it only logs on a match and never calls `t.Error` on a mismatch, so it can never fail. Third, `TestSubtract` has the wrong signature (no `*testing.T`), so it too is invisible to `go test`, and its use of `panic` is the wrong tool — a panic produces a crash with a stack trace rather than a clean, attributable test failure.

The correct version shows the mental model that a real test encodes. In a genuine `_test.go` file you would write `func TestAdd(t *testing.T)` and call `t.Errorf("Add(2, 3) = %d; want %d", got, want)` on mismatch. Because this platform executes the snippet with `go run`, we reproduce that logic with a small `check` helper that prints `PASS`/`FAIL` and an explicit message containing the inputs, the computed value, and the expected value — exactly the information a good `t.Errorf` message carries.

Notice that the message format is the whole point. Go gives you no assertion library, so the quality of your failure diagnostics depends entirely on the string you write. A message of `"Add(2, 3) = %d; want %d"` tells you immediately what was tested, what came back, and what should have. That discipline — print the inputs and the got/want pair — is the single most valuable habit in Go testing.

---

## Design Tradeoff

By putting testing in the standard toolchain and refusing to add an assertion DSL, Go trades terseness for uniformity and transparency. A `pytest` or RSpec test can be a one-liner like `expect(add(2, 3)).to eq(5)`, which is shorter than Go's explicit `if got != want { t.Errorf(...) }`. Go accepts that verbosity deliberately: a test is just Go code, so there is nothing new to learn, nothing to debug through a matcher layer, and every Go project — from the standard library to your service — tests in the same recognizable shape.

The cost lands on you as the author of failure messages. Without `assertEquals` formatting the diff for free, a lazy `t.Error("wrong")` gives a useless failure. The benefit is that when you invest in a good message, the failure is fully self-describing and portable across editors, CI logs, and grep. Go bets that the long-term clarity of "tests are ordinary code with explicit, hand-written diagnostics" outweighs the short-term convenience of a clever assertion vocabulary.

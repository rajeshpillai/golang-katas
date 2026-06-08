---
id: subtests
phase: 8
phase_title: Testing & Tooling
sequence: 3
title: Subtests
---

## Description

### Concept Overview

A subtest is a test nested inside another test, created by calling `t.Run(name, fn)`. It turns a single `TestXxx` function into a tree of named, independently reported, independently runnable cases. Subtests are what make table-driven tests scale: each row of the table becomes its own subtest with its own name, so a failure tells you exactly which case broke, and you can rerun just that case from the command line.

The mechanism is small but powerful. `t.Run` takes a name and a function `func(t *testing.T)`, and it runs that function as a child test. The child gets its own `*testing.T`, so a `t.Fatal` inside one subtest stops only that subtest — the siblings still run. The framework composes the parent and child names with a slash (`TestParse/empty_input`), which becomes a selector you can pass to `go test -run`. Subtests also enable controlled parallelism and shared setup/teardown in a way that flat test functions cannot.

### Technical Explanation

`t.Run` has the signature `func (t *testing.T) Run(name string, f func(t *testing.T)) bool`. It returns `true` if the subtest passed. The `name` is sanitized for use in the test path — spaces become underscores, so `t.Run("empty input", ...)` is addressable as `TestParse/empty_input`.

The most common use is to give each table row a name:

```go
func TestParse(t *testing.T) {
    tests := []struct {
        name    string
        in      string
        want    int
        wantErr bool
    }{
        {name: "valid", in: "42", want: 42},
        {name: "empty", in: "", wantErr: true},
        {name: "letters", in: "abc", wantErr: true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := Parse(tt.in)
            if (err != nil) != tt.wantErr {
                t.Fatalf("Parse(%q) err = %v; wantErr %v", tt.in, err, tt.wantErr)
            }
            if got != tt.want {
                t.Errorf("Parse(%q) = %d; want %d", tt.in, got, tt.want)
            }
        })
    }
}
```

Key behaviors that subtests unlock:

- **Isolation of fatal failures.** A `t.Fatal`/`t.Fatalf` inside a subtest aborts only that subtest. In a flat loop, the first `t.Fatal` would abort the whole function and skip every remaining case. With subtests, one bad case does not hide the others.
- **Selective execution.** `go test -run TestParse/empty` runs only the subtest whose path matches the regular expression `empty`. The `-run` flag is a slash-separated regexp: `-run TestParse/valid` targets one case; `-run /empty` targets any subtest named `empty` under any parent.
- **Shared setup and teardown.** You can do expensive setup once in the parent, then run many subtests against it. `t.Cleanup(fn)` (preferred over `defer` in tests) registers teardown that runs when the subtest finishes, even on failure, and runs in LIFO order.
- **Parallelism.** Calling `t.Parallel()` inside a subtest pauses it until the parent test function returns, then runs it concurrently with other parallel subtests. A common idiom is a parent that sets up shared state, spawns parallel subtests, and relies on the fact that the parent does not complete (and its `Cleanup` does not fire) until all its parallel children finish.
- **Grouping.** Subtests can nest arbitrarily — `t.Run("group", func(t *testing.T){ t.Run("case", ...) })` — producing paths like `TestX/group/case` for hierarchical organization.

The `t.Helper()` method pairs naturally with subtests: when a subtest calls a shared assertion helper, marking that helper with `t.Helper()` makes failures report the subtest's line, not the helper's.

### Design Rationale

Before subtests landed in Go 1.7, the only way to get per-case reporting and per-case execution was to write a separate `TestXxx` function for every case — verbose, and impossible for cases generated from data. The `testing.T.Run` API brought the granularity of many test functions to a single one, while keeping the table-driven loop that Go already favored. The design is deliberately minimal: it is just a method that runs a function, not a new framework concept. There is no `describe`/`it` DSL as in RSpec or Jest, no `TestSuite` base class as in JUnit — just `t.Run` taking a name and a closure, which is ordinary Go.

This minimalism buys real capabilities that framework-heavy languages bolt on with extra machinery. Selective rerun (`-run TestX/case`) is the equivalent of IDE "run this one test" but driven by the plain test binary and a regexp. Per-subtest isolation gives you the failure containment that xUnit gets from running each test method in a fresh instance, but without the framework reconstructing objects. And parallelism is opt-in per subtest via `t.Parallel()`, making concurrency explicit rather than a runner configuration. The throughline is Go's usual stance: expose a small, composable primitive (`Run` plus a closure) and let the programmer build structure from it, instead of shipping a large opinionated test framework.

### Common Mistakes

**Not naming subtests, or giving them duplicate names.** If two subtests share a name, the framework disambiguates by appending `#01`, `#02`, which makes `-run` selectors ambiguous and failures harder to read. Derive names from the case data so they are unique and meaningful, e.g. the input value or a descriptive label.

**Expecting `t.Fatal` in a subtest to stop the whole test.** A `t.Fatal` inside `t.Run` stops only that subtest's closure; the parent continues launching the next subtest. That is usually what you want, but it surprises people who expect a hard stop. If you genuinely need to abort everything, fail in the parent before the loop.

**Capturing the loop variable in parallel subtests (pre-Go 1.22).** When subtests call `t.Parallel()`, they run after the loop has finished. Before Go 1.22, every parallel subtest then observed the final value of the shared loop variable, so they all tested the same case. The remedy was `tt := tt` at the top of the loop. Go 1.22 made each iteration's variable distinct, removing the trap for new code.

**Using `defer` for teardown instead of `t.Cleanup`.** A `defer` in the parent runs when the parent function returns — which, with parallel subtests, may be *before* those subtests finish, tearing down state they still need. `t.Cleanup` is scheduled correctly relative to subtest completion and also runs on `t.Fatal`, where a misplaced `defer` after the fatal line never runs at all.

**Putting slashes or spaces in names and being surprised by the path.** Names are sanitized: spaces become underscores and the name participates in a slash-delimited path. If you embed a slash in a name, you create an unintended nesting level that changes how `-run` matches.

### Key Takeaways

- `t.Run(name, func(t *testing.T){...})` creates a subtest — a named, isolated, independently runnable child of the current test.
- A `t.Fatal` inside a subtest aborts only that subtest, so one failing case no longer hides the rest of the table.
- Subtest names compose into a slash path (`TestX/case`) that you target with `go test -run TestX/case`.
- Prefer `t.Cleanup` over `defer` for teardown — it runs on failure and at the correct time relative to parallel subtests.
- `t.Parallel()` inside a subtest opts that case into concurrent execution after the parent returns.
- Subtests are the engine that makes table-driven tests report and rerun per case — pair them with your table's `name` field.

---

## Broken Code

```go
// broken: a flat loop with no subtests — one fatal case hides all the rest
package parsex

import (
    "strconv"
    "testing"
)

func Parse(s string) (int, error) {
    return strconv.Atoi(s)
}

func TestParse(t *testing.T) {
    tests := []struct {
        in      string
        want    int
        wantErr bool
    }{
        {in: "42", want: 42},
        {in: "", wantErr: true},
        {in: "abc", wantErr: true},
        {in: "7", want: 7},
    }

    for _, tt := range tests {
        got, err := Parse(tt.in)
        if (err != nil) != tt.wantErr {
            // Bug: t.Fatalf aborts the ENTIRE TestParse on the first bad case,
            // so later cases never run and you cannot tell which case failed.
            // There is also no name, so failures are anonymous.
            t.Fatalf("Parse(%q) err = %v; wantErr %v", tt.in, err, tt.wantErr)
        }
        if got != tt.want {
            t.Errorf("got %d want %d", got, tt.want) // no input, no case name
        }
    }
}
```

---

## Correct Code

```go
// correct: runnable demonstration of subtest behavior.
// NOTE: run with `go run`. We mimic t.Run by giving each case a name and
// isolating its outcome so one "fatal" case does not hide the others.
package main

import (
    "fmt"
    "strconv"
)

// Parse is the function under test.
func Parse(s string) (int, error) {
    return strconv.Atoi(s)
}

// runCase mimics a single t.Run subtest: it is self-contained, named, and a
// fatal-style failure inside it returns from THIS case only — siblings run on.
func runCase(name, in string, want int, wantErr bool) bool {
    got, err := Parse(in)

    // Fatal-style check: if the error expectation is wrong, this case stops
    // here (return), but the caller keeps running the remaining cases.
    if (err != nil) != wantErr {
        fmt.Printf("FAIL: %-7s Parse(%q) err = %v; wantErr %v\n", name, in, err, wantErr)
        return false
    }
    if !wantErr && got != want {
        fmt.Printf("FAIL: %-7s Parse(%q) = %d; want %d\n", name, in, got, want)
        return false
    }
    fmt.Printf("PASS: %-7s Parse(%q)\n", name, in)
    return true
}

func main() {
    tests := []struct {
        name    string
        in      string
        want    int
        wantErr bool
    }{
        {name: "valid", in: "42", want: 42},
        {name: "empty", in: "", wantErr: true},
        {name: "letters", in: "abc", wantErr: true},
        {name: "single", in: "7", want: 7},
    }

    allPassed := true
    for _, tt := range tests {
        // Each iteration is an isolated "subtest": its failure does not abort
        // the loop, exactly as t.Run isolates a real subtest.
        ok := runCase(tt.name, tt.in, tt.want, tt.wantErr)
        allPassed = ok && allPassed
    }

    fmt.Println()
    if allPassed {
        fmt.Println("ALL SUBTESTS PASSED")
    } else {
        fmt.Println("SOME SUBTESTS FAILED")
    }
}
```

---

## Explanation

The broken version loops over a table but never wraps each case in a subtest, and it uses `t.Fatalf` directly in the loop body. That combination is the worst of both worlds. The `t.Fatalf` aborts the *entire* `TestParse` function the instant any case has the wrong error expectation, so every case after the first failure simply never runs — you fix one problem, rerun, and discover another, one painful round-trip at a time. And because the cases are anonymous, the failure message cannot tell you which row broke beyond the input it happens to print.

The correct version restores isolation. Each case runs through `runCase`, which is self-contained and named, so a fatal-style failure returns from that one case while the loop carries on to the next. This mirrors exactly what `t.Run` does in a real test: the subtest's `*testing.T` confines a `t.Fatal` to that subtest, the parent keeps launching siblings, and every case reports its own PASS or FAIL under its own name. In a genuine `_test.go` file the body of `runCase` would live inside `t.Run(tt.name, func(t *testing.T) { ... })`, and the names would compose into selectable paths like `TestParse/empty`.

The output makes the benefit concrete: one run shows the verdict for every case, each tagged with a name and its input. You can see at a glance that `empty` and `letters` are expected to error and `valid` and `single` are expected to parse — and if one regressed, you would know precisely which one, instead of being stopped at the first failure with no idea what lies behind it.

---

## Design Tradeoff

Subtests add a layer of nesting and a closure for every case, which is marginally more code and one more level of indentation than a flat loop. In exchange you get failure isolation, per-case naming, selective reruns, and opt-in parallelism — capabilities that other ecosystems provide only through heavier machinery like RSpec's `describe`/`it` blocks or JUnit's nested test classes. Go's bet is that a single composable primitive, `t.Run` taking a name and a closure, delivers all of that with nothing new to learn, because a subtest is just a function call.

The tradeoff sharpens around parallelism and teardown. The moment you call `t.Parallel()`, the timing of when subtests run relative to the parent changes, and naive `defer`-based teardown or pre-1.22 loop-variable capture will bite you. That is the price of the flexibility: subtests give you precise control over isolation and concurrency, but they ask you to understand the ordering rules (use `t.Cleanup`, give each case a distinct name, shadow the loop variable on older Go). For most table-driven suites the rules are simple and the payoff — clear, granular, individually runnable cases — is well worth the small amount of extra structure.

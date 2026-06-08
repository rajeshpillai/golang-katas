---
id: go-test-vet-fmt
phase: 8
phase_title: Testing & Tooling
sequence: 5
title: go test, go vet, go fmt
---

## Description

### Concept Overview

Go ships its quality tooling in the same binary as the compiler. Three commands form the backbone of everyday Go hygiene: `go fmt` rewrites your code into the one canonical format, `go vet` reports suspicious constructs that compile but are probably bugs, and `go test` builds and runs your tests and benchmarks. None of these requires installation, configuration files, or a plugin. They are part of the standard distribution, so every Go developer and every CI pipeline has them, and they behave identically everywhere.

The deeper idea is that Go treats formatting, static analysis, and testing as solved problems with a single blessed answer. There is no debate about brace style because `gofmt` decides it. There is no argument over which linter to adopt for the basics because `go vet` ships the high-signal checks. There is no test-runner bikeshedding because `go test` is the runner. This uniformity is a feature: any Go codebase is formatted the same way, analyzed by the same checks, and tested by the same command.

### Technical Explanation

**`go fmt`** runs `gofmt` over the named packages and rewrites files in place to Go's canonical style: tabs for indentation, specific spacing, aligned struct tags, sorted import groups, and a fixed brace placement. `gofmt` is not configurable by design — there are no options for indentation width or brace style. Related: `gofmt -d` prints a diff instead of rewriting, `gofmt -l` lists files that are not formatted (useful in CI to fail on unformatted code), and `goimports` is a superset that also adds and removes import statements based on what the file uses.

```
go fmt ./...      # format every package in the module, rewriting in place
gofmt -l ./...    # list files that would change — exit nonzero in CI if any
```

**`go vet`** performs static analysis that the compiler intentionally does not. The compiler's job is to reject programs that are not valid Go; `vet`'s job is to flag programs that are valid but suspicious. High-value vet checks include:

- **Printf format mismatches** — `fmt.Printf("%d", "hello")` compiles fine but `vet` flags the type mismatch between `%d` and a string.
- **Struct tag syntax** — malformed `json:"..."` tags that would silently fail at runtime.
- **Unreachable code** and **lost return values**.
- **Copying a value containing a `sync.Mutex`** by value, which silently breaks locking.
- **Suspicious test signatures** — a function named `TestXxx` whose parameter is not `*testing.T`, which would otherwise never run.
- **Loop variable capture** issues and **shadowed errors** in some configurations.

```
go vet ./...      # analyze every package; nonzero exit on any finding
```

Note that `go test` automatically runs a subset of `go vet` before running tests, so some vet findings surface during testing. `go vet` itself is built on the `golang.org/x/tools/go/analysis` framework, the same foundation third-party linters (staticcheck, golangci-lint) extend.

**`go test`** compiles the package together with its `_test.go` files into a temporary test binary and runs it. Key flags:

- `go test ./...` — run all tests in the module.
- `-v` — verbose; print each test/subtest name and any `t.Log` output even on success.
- `-run <regexp>` — run only tests whose name matches; combine with subtest paths like `-run TestParse/empty`.
- `-bench <regexp>` — run benchmarks (add `-run=^$` to skip tests); `-benchmem` adds allocation stats.
- `-race` — enable the race detector, which instruments memory access to find data races at runtime. Essential for concurrent code.
- `-cover` — report statement coverage; `-coverprofile=c.out` writes a profile that `go tool cover -html=c.out` renders as an annotated source view.
- `-count=1` — disable test result caching (Go caches passing test results keyed by inputs); `-count=5` runs each test five times.
- `-timeout 30s` — fail the run if it hangs past the deadline.

A typical pre-commit or CI sequence is `go fmt ./... && go vet ./... && go test -race -cover ./...`: format, analyze, then test under the race detector with coverage.

### Design Rationale

The decision to ship one canonical formatter is one of Go's most influential choices. Rob Pike's line — "gofmt's style is no one's favorite, yet gofmt is everyone's favorite" — captures the bargain: by removing the *option* to argue about formatting, Go removed the *argument*. In ecosystems with configurable formatters (Prettier configs, `.clang-format`, Black's few knobs, ESLint style rules), teams spend real effort negotiating and enforcing a house style, and diffs get polluted by reformatting churn when styles drift. `gofmt`'s rigidity means every Go file in the world is formatted the same way, code review never discusses whitespace, and tooling (diffs, merges, code generation) can rely on a stable shape.

Splitting `vet` from the compiler reflects a clear separation of concerns. The compiler enforces the language; `vet` enforces good sense. Many languages blur these — Java compilers emit a flood of warnings of varying value, and C compilers need `-Wall -Wextra` plus a separate static analyzer to approach what `vet` does out of the box. By keeping the compiler strict but narrow and putting heuristic, occasionally-false-positive checks in `vet`, Go keeps build errors meaningful while still catching the bugs that "compile but lie" — the classic `Printf` format mismatch being the poster child. Bundling `vet` into `go test` means those checks run as part of normal development, not as an optional extra someone forgets.

Finally, making `go test` the universal runner extends the same uniformity to verification. Where JUnit/Maven/Gradle, pytest/tox, and Jest each layer configuration and plugins, Go offers one command with a small set of orthogonal flags. The result is that `go test ./...` works on any module, the race detector and coverage are one flag away, and CI configuration is a single line. The throughline across all three tools is Go's conviction that consistency at the ecosystem level is worth more than per-project flexibility.

### Common Mistakes

**Treating `go vet` findings as style nits and ignoring them.** Vet has a deliberately low false-positive rate; a `Printf` format warning or a "copies lock value" warning is almost always a real bug. Suppressing or skipping vet hides defects that compile cleanly and fail at runtime, which is exactly the class of bug vet exists to catch.

**Forgetting that `go test` caches results.** Go caches passing test results keyed on the test binary and inputs, so re-running an unchanged package prints `(cached)` and does not actually execute. Developers debugging flakiness or external dependencies sometimes think their changes had no effect; pass `-count=1` to force a real run.

**Running tests without `-race` on concurrent code.** Data races are undefined behavior that may pass thousands of times and then corrupt memory in production. The race detector finds them deterministically when the racy access happens during the run, but only if you enable `-race`. Concurrent code untested under `-race` is effectively untested for its hardest bugs.

**Committing unformatted code because the editor did not auto-format.** If `gofmt` does not run on save, formatting drifts and pull requests fill with whitespace noise. CI should run `gofmt -l` (or `test -run=^$` with a fmt check) and fail when files are not formatted, making the canonical format non-optional.

**Confusing compiler errors with vet findings.** Beginners expect `go vet` to catch everything or expect the compiler to warn about format strings. The compiler only rejects invalid Go; it will happily compile `Printf("%d", "x")`. You must run `go vet` (or rely on `go test` running it) to catch that. Knowing which tool catches which class of problem is part of using Go well.

### Key Takeaways

- `go fmt` enforces one non-configurable canonical style — formatting is settled, not debated; use `gofmt -l` in CI to fail on unformatted code.
- `go vet` flags code that compiles but is probably wrong (format mismatches, lock copies, bad test signatures); its findings are high-signal and should be fixed, not ignored.
- `go test` builds and runs tests/benchmarks; learn the flags `-v`, `-run`, `-bench`, `-race`, `-cover`, and `-count=1`.
- `go test` runs a subset of `go vet` automatically and caches passing results — use `-count=1` to bypass the cache.
- Always run concurrent code under `-race`; data races pass silently until they do not.
- A solid CI/pre-commit pipeline is `go fmt ./... && go vet ./... && go test -race -cover ./...` — all from the standard toolchain, no plugins.

---

## Broken Code

```go
// broken: code that COMPILES but go vet and go fmt would both object to,
// and a test that go test silently never runs.
package report

import (
    "fmt"
    "sync"
    "testing"
)

type Counter struct {
    mu    sync.Mutex
    value int
}

// Bug (go vet): receiver takes Counter BY VALUE, copying the embedded Mutex.
// The lock protects a copy, so it does nothing. vet reports "copies lock value".
func (c Counter) Inc() {
    c.mu.Lock()
    c.value++
    c.mu.Unlock()
}

func Format(n int) string {
    // Bug (go vet): %d format verb with a string argument. Compiles fine;
    // vet flags the mismatch; at runtime it prints %!d(string=...).
    return fmt.Sprintf("count is %d", "many")
}

// Bug (go test): wrong parameter type, so this is NOT recognized as a test
// and never runs — yet the suite reports success.
func TestFormat(t *testing.B) {
    if Format(3) == "" {
        t.Fatal("empty")
    }
}

// Formatting note: misaligned, gofmt would rewrite spacing/indentation here.
var Defaults = map[string]int{ "low":1,"high":  10 }
```

---

## Correct Code

```go
// correct: runnable demonstration of what go fmt/go vet/go test enforce.
// NOTE: run with `go run`. This file is gofmt-clean, vet-clean, and mimics the
// test-runner's PASS/FAIL reporting inline.
package main

import (
	"fmt"
	"sync"
)

// Counter uses a pointer receiver so Inc locks the real Mutex, not a copy.
// A value receiver here would trigger go vet's "copies lock value" warning.
type Counter struct {
	mu    sync.Mutex
	value int
}

func (c *Counter) Inc() {
	c.mu.Lock()
	c.value++
	c.mu.Unlock()
}

func (c *Counter) Value() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.value
}

// Format uses the %d verb with an int argument, so go vet is satisfied.
func Format(n int) string {
	return fmt.Sprintf("count is %d", n)
}

// check mimics the explicit assertion a real test performs.
func check(name string, cond bool) bool {
	if !cond {
		fmt.Printf("FAIL: %s\n", name)
		return false
	}
	fmt.Printf("PASS: %s\n", name)
	return true
}

func main() {
	allPassed := true

	// Exercise Format — the analogue of TestFormat.
	allPassed = check("Format(3) == \"count is 3\"", Format(3) == "count is 3") && allPassed

	// Exercise the lock-safe Counter across goroutines, the kind of code you
	// would run under `go test -race`.
	c := &Counter{}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.Inc()
		}()
	}
	wg.Wait()

	allPassed = check("Counter.Value() == 100 after 100 concurrent Inc", c.Value() == 100) && allPassed

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

The broken version is a tour of problems the compiler waves through but the tooling catches. `Counter.Inc` takes its receiver by value, so each call locks a *copy* of the mutex and the protection is an illusion — `go vet` reports "Inc passes lock by value: copies lock value." `Format` writes `Sprintf("count is %d", "many")`, mixing the integer verb `%d` with a string; this compiles and prints garbage like `%!d(string=many)` at runtime, and `go vet` flags it before it ever runs. `TestFormat` declares its parameter as `*testing.B` instead of `*testing.T`, so `go test` does not see it as a test and silently never runs it, while the suite still reports green. And the `Defaults` map literal is misformatted, so `gofmt` would rewrite its spacing and alignment. Every one of these passes `go build`; none of them survives `go fmt`, `go vet`, and a careful `go test`.

The correct version is what the tools want. `Counter` uses a pointer receiver, so `Inc` locks the genuine mutex and the lock actually protects `value` — exactly the code you would validate under `go test -race`. `Format` pairs `%d` with an `int`, satisfying `vet`. The file is `gofmt`-clean (note the tab indentation and aligned struct fields). Because the platform runs the snippet with `go run`, the test logic is expressed as inline `check` calls that print PASS/FAIL, mirroring what `TestFormat` and a concurrency test would assert. The concurrent `Inc` loop demonstrates the very situation the race detector exists for: a hundred goroutines incrementing a shared counter, correct only because the mutex is real.

The takeaway is the division of labor. The compiler guarantees the program is valid Go; `gofmt` guarantees it looks like every other Go program; `go vet` guarantees it avoids the constructs that compile but lie; and `go test` (ideally with `-race` and `-cover`) guarantees it behaves. Skipping any of these leaves a category of defect unguarded.

---

## Design Tradeoff

The central tradeoff in Go's tooling is uniformity over flexibility. By shipping one non-configurable formatter, one bundled analyzer, and one test runner, Go forecloses the customization that other ecosystems prize — you cannot set your preferred indentation, swap in a different blessed linter for the basics, or replace the test runner. For a developer with strong personal style preferences, that rigidity can chafe. But the payoff is enormous at the ecosystem scale: every Go codebase is formatted identically, analyzed by the same high-signal checks, and tested by the same command, so a developer moving between projects carries zero tooling overhead and code review never spends a word on whitespace.

The second tradeoff is that the tools are powerful only if you actually run them. The compiler is mandatory, but `go vet`, `-race`, and `gofmt`-in-CI are not — Go will happily build code with copied locks, broken format strings, and data races if you never invoke the analyzers. Go's design leans on convention and CI discipline rather than forcing these checks at build time, betting that a culture of "fmt, vet, test with -race" is better than a compiler that second-guesses every suspicious-but-legal construct. That bet keeps build errors meaningful and fast while pushing the heuristic checks into commands you choose to run — which makes wiring `go fmt ./... && go vet ./... && go test -race -cover ./...` into your pipeline the single highest-leverage habit in Go engineering.

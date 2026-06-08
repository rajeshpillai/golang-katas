---
id: table-driven-tests
phase: 8
phase_title: Testing & Tooling
sequence: 2
title: Table-Driven Tests
---

## Description

### Concept Overview

A table-driven test expresses many test cases as data — a slice of structs — and runs them through a single shared assertion loop. Instead of copying the same three lines of "call, compare, report" for every input you care about, you list the inputs and expected outputs in a table and let one loop do the work. This is the single most idiomatic testing pattern in Go. Open the standard library's own test files and you will see it everywhere.

The shape is always the same: define a slice of anonymous structs where each struct holds the inputs, the expected output, and a human-readable name; then iterate over the slice, calling the function under test and comparing `got` to `want`. Adding a new case becomes a one-line edit to the table rather than a copy-pasted block of code. The test logic lives in exactly one place, so a bug in the assertion is fixed once, not in every duplicated case.

### Technical Explanation

The canonical form combines a table with subtests (`t.Run`). Here is the idiomatic shape as it appears in a real `_test.go` file:

```go
func TestAbs(t *testing.T) {
    tests := []struct {
        name string
        in   int
        want int
    }{
        {name: "positive", in: 3, want: 3},
        {name: "negative", in: -3, want: 3},
        {name: "zero", in: 0, want: 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Abs(tt.in)
            if got != tt.want {
                t.Errorf("Abs(%d) = %d; want %d", tt.in, got, tt.want)
            }
        })
    }
}
```

Several details make this idiomatic:

- **The anonymous struct slice** keeps all cases visible in one block. The fields are typically `name`, the inputs, and `want`. When the function can return an error, add a `wantErr bool` (or a specific sentinel) field.
- **The `name` field** feeds `t.Run`, which gives each case its own subtest with an addressable name like `TestAbs/negative`. That lets you run a single case with `go test -run TestAbs/negative` and produces clean per-case failure reporting.
- **The loop variable `tt`** is conventionally named `tt` (for "table test"). In Go 1.22 and later, each loop iteration gets a fresh `tt`, so the old "capture the loop variable" bug is gone; before 1.22 you needed `tt := tt` inside the loop to avoid all parallel subtests sharing the last value.
- **The assertion** is the same explicit `if got != tt.want { t.Errorf(...) }` from the basic testing kata — the table does not change how you compare, only how many inputs you feed in.

For functions that return errors, the table carries the error expectation:

```go
tests := []struct {
    name    string
    in      string
    want    int
    wantErr bool
}{
    {name: "valid", in: "42", want: 42, wantErr: false},
    {name: "empty", in: "", want: 0, wantErr: true},
    {name: "letters", in: "abc", want: 0, wantErr: true},
}
// inside the loop:
got, err := Parse(tt.in)
if (err != nil) != tt.wantErr {
    t.Fatalf("Parse(%q) error = %v; wantErr %v", tt.in, err, tt.wantErr)
}
if got != tt.want {
    t.Errorf("Parse(%q) = %d; want %d", tt.in, got, tt.want)
}
```

When the expected value is a composite type (struct, slice, map), `==` will not compile or will not compare deeply. Use `reflect.DeepEqual(got, tt.want)` from the standard library, or `cmp.Diff` from `google/go-cmp` for a readable diff. The tooling story is unchanged: `go test` runs the table, `go vet` checks your format strings, and `go test -run` filters by subtest name.

### Design Rationale

Go's designers favor table-driven tests because they exploit the language's strengths — composite literals, anonymous structs, and ranging over slices — to remove duplication without introducing a framework. In xUnit-style frameworks, the equivalent of running one logic path over many inputs is "parameterized tests": JUnit has `@ParameterizedTest` with `@ValueSource`/`@MethodSource`, pytest has `@pytest.mark.parametrize`. Those rely on decorators and reflection-driven magic that inject arguments into your test method. Go achieves the same outcome with nothing but a `for` loop and a struct literal — no annotations, no special runner, no hidden injection. The mechanism is fully visible: you can read the loop and know exactly what runs.

The pattern is idiomatic for a deeper reason: it separates *what to test* (the data) from *how to test* (the loop). When the cases are data, reviewers can scan the table and immediately see coverage — which inputs are exercised, which edge cases are present, which are missing. Adding a regression test for a newly found bug is a one-line table entry, which lowers the friction of testing and so increases how much testing actually happens. Combined with `t.Run`, each row becomes an independently named, independently runnable subtest, giving you the granular reporting of many test functions with the conciseness of one.

### Common Mistakes

**Not using `t.Run` for each case.** Without subtests, the loop reports all failures from one flat test function, and you cannot tell which row failed without reading the message. Worse, if you use `t.Fatal` inside a bare loop, the first failing case aborts the entire loop and you never learn whether the remaining cases pass. Wrapping each case in `t.Run` isolates it.

**Forgetting to include the input in the failure message.** A message like `t.Errorf("got %d want %d", got, tt.want)` omits which case failed. Always include the input (and ideally `tt.name`) so the failure is attributable: `t.Errorf("Abs(%d) = %d; want %d", tt.in, got, tt.want)`.

**Capturing the loop variable in parallel subtests (pre-Go 1.22).** Before Go 1.22, `t.Run(tt.name, func(t *testing.T) { ... })` combined with `t.Parallel()` made every subtest see the final `tt` because the closure captured the shared loop variable. The fix was `tt := tt` at the top of the loop body. Go 1.22 changed loop semantics so each iteration has its own variable — but code targeting older versions still needs the shadow.

**Using `==` on composite expected values.** Comparing slices or maps with `==` is a compile error; comparing structs with unexported or incomparable fields can panic or mislead. Reach for `reflect.DeepEqual` or `go-cmp` when `want` is not a simple comparable type.

**Making cases depend on each other.** Each table row should be self-contained. If one case mutates shared state that a later case reads, you have coupled them, and running a single case with `-run` will behave differently than running the whole table.

### Key Takeaways

- A table-driven test stores cases as a slice of structs (`name`, inputs, `want`) and runs them through one shared assertion loop — the most idiomatic Go test pattern.
- Wrap each row in `t.Run(tt.name, ...)` so cases are isolated, independently named, and individually runnable with `go test -run`.
- Always put the input and the `got`/`want` values in the failure message so a failing row is self-describing.
- For error-returning functions, carry a `wantErr` field and check `(err != nil) != tt.wantErr` before comparing values.
- Use `reflect.DeepEqual` or `go-cmp` when the expected value is a slice, map, or struct rather than a comparable scalar.
- Adding a new case should be a one-line edit to the table — that low friction is the whole point.

---

## Broken Code

```go
// broken: copy-pasted cases with duplicated, drifting assertion logic
package mathx

import "testing"

func Abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}

// Three near-identical functions. The logic is duplicated, so when one drifts
// (note TestAbsZero asserts the WRONG thing) nothing forces them to agree.
func TestAbsPositive(t *testing.T) {
    if Abs(3) != 3 {
        t.Errorf("wrong") // no input, no got/want — useless on failure
    }
}

func TestAbsNegative(t *testing.T) {
    if Abs(-3) != 3 {
        t.Errorf("wrong")
    }
}

func TestAbsZero(t *testing.T) {
    // Bug: asserts the wrong expected value, and there is no shared loop
    // that would have surfaced the inconsistency.
    if Abs(0) != 1 {
        t.Errorf("wrong")
    }
}
```

---

## Correct Code

```go
// correct: runnable demonstration of the table-driven pattern.
// NOTE: run with `go run`. A real test would use t.Run + t.Errorf; here we
// mimic that with an inline loop printing PASS/FAIL per row.
package main

import "fmt"

// Abs is the function under test.
func Abs(n int) int {
    if n < 0 {
        return -n
    }
    return n
}

func main() {
    // The "table": all cases as data, in one readable block.
    tests := []struct {
        name string
        in   int
        want int
    }{
        {name: "positive", in: 3, want: 3},
        {name: "negative", in: -3, want: 3},
        {name: "zero", in: 0, want: 0},
        {name: "min-edge", in: -100, want: 100},
    }

    allPassed := true

    // One shared assertion loop drives every case. In a real test this body
    // would live inside t.Run(tt.name, func(t *testing.T){ ... }).
    for _, tt := range tests {
        got := Abs(tt.in)
        if got != tt.want {
            fmt.Printf("FAIL: %-9s Abs(%d) = %d; want %d\n", tt.name, tt.in, got, tt.want)
            allPassed = false
            continue
        }
        fmt.Printf("PASS: %-9s Abs(%d) = %d\n", tt.name, tt.in, got)
    }

    fmt.Println()
    if allPassed {
        fmt.Println("ALL CASES PASSED")
    } else {
        fmt.Println("SOME CASES FAILED")
    }
}
```

---

## Explanation

The broken version spreads three cases across three nearly identical functions. The duplication is not just ugly — it is dangerous. Because each function carries its own copy of the comparison, the cases can drift apart: `TestAbsZero` asserts `Abs(0) != 1`, an obviously wrong expectation, and nothing in the structure forces it to agree with its siblings. The failure messages are also useless: `t.Errorf("wrong")` tells you neither the input, the value you got, nor the value you wanted. When this suite fails, you are left guessing.

The correct version collapses all of that into a table plus one loop. The cases become data — a slice where each row names itself and states its input and expected output. The assertion logic exists exactly once, so it cannot drift; if the comparison is right for one row, it is right for all of them. Adding the `min-edge` case took a single line. In a genuine `_test.go` file, the loop body would sit inside `t.Run(tt.name, func(t *testing.T) { ... })` so each row becomes its own named subtest, but the `go run` version here preserves the essential structure: iterate the table, compare `got` to `tt.want`, and report a per-row PASS or FAIL with the input embedded in the message.

The payoff is visible in the output. Each line ties a case name to its input and result, so a failure is immediately attributable. That is the discipline the broken version threw away: when your assertion lives in one place and your data lives in a table, both your code and your failures become self-explanatory.

---

## Design Tradeoff

Table-driven tests trade a small amount of upfront structure for a large, compounding reduction in duplication. Writing the struct definition and the loop is more ceremony than dashing off a single two-line test, so for a function with exactly one interesting input the table can feel like overkill. The pattern pays off the moment you have a second case, and it pays off enormously as the case count grows: the assertion logic stays in one place, coverage becomes scannable as data, and new regression cases cost one line each.

The main risk is over-tabling — forcing fundamentally different behaviors into one table with a tangle of optional fields and conditional branches inside the loop. When cases need genuinely different setup or assertions, splitting them into separate tables (or separate test functions) keeps each loop simple. Go's idiom is to reach for the table when the cases share one logic path over varying data, and to resist bending the table to cover paths that do not actually share that logic.

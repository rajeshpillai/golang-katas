---
id: functions-and-multiple-returns
phase: 0
phase_title: Go as a Language
sequence: 6
title: Functions and Multiple Returns
---

## Description

### Concept Overview

Go functions can return multiple values. This is not a convenience feature bolted on as an afterthought — it is the foundation of Go's entire error handling strategy. Instead of throwing exceptions that unwind the call stack, Go functions return a pair of values: the result and an error. The caller is expected to inspect the error before using the result. This simple mechanism replaces try/catch blocks, exception hierarchies, and the invisible control flow disruptions that exceptions create. Understanding multiple return values is not just learning syntax — it is learning how Go thinks about failure.

### Technical Explanation

A Go function is declared with the `func` keyword, followed by the function name, parameters, and return types. When a function returns multiple values, the return types are listed in parentheses:

```go
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, fmt.Errorf("cannot divide by zero")
    }
    return a / b, nil
}
```

The caller must handle both return values:

```go
result, err := divide(10, 3)
if err != nil {
    log.Fatal(err)
}
fmt.Println(result)
```

Go supports **named return values**, where you give names to the return parameters in the function signature. Named returns are pre-initialized to their zero values and can be returned implicitly with a bare `return` statement:

```go
func divide(a, b float64) (result float64, err error) {
    if b == 0 {
        err = fmt.Errorf("cannot divide by zero")
        return  // returns result=0.0, err=<the error>
    }
    result = a / b
    return  // returns result=<computed value>, err=nil
}
```

Named returns can improve clarity in short functions, especially when the names make the return values self-documenting. However, in longer functions they reduce readability because the reader must mentally track what values the names hold at each `return` point. The Go community convention is to use named returns sparingly — primarily in short functions or when they enable deferred error handling patterns.

**Variadic functions** accept a variable number of arguments using the `...` syntax:

```go
func sum(numbers ...int) int {
    total := 0
    for _, n := range numbers {
        total += n
    }
    return total
}

// Called as:
sum(1, 2, 3)
sum(1, 2, 3, 4, 5)
```

The variadic parameter is received as a slice inside the function. You can also expand an existing slice into a variadic call with `...`:

```go
nums := []int{1, 2, 3}
sum(nums...)
```

**Functions are first-class values** in Go. You can assign them to variables, pass them as arguments, and return them from other functions:

```go
add := func(a, b int) int { return a + b }
fmt.Println(add(3, 4))  // 7
```

**Closures** capture variables from their enclosing scope. The closure holds a reference to the variable, not a copy — so mutations to the variable inside the closure are visible outside, and vice versa:

```go
func counter() func() int {
    count := 0
    return func() int {
        count++
        return count
    }
}

c := counter()
fmt.Println(c())  // 1
fmt.Println(c())  // 2
fmt.Println(c())  // 3
```

The **`defer` keyword** schedules a function call to run when the enclosing function returns. Deferred calls execute in last-in, first-out (LIFO) order. `defer` is primarily used for cleanup operations — closing files, releasing locks, closing network connections:

```go
func readFile(path string) (string, error) {
    f, err := os.Open(path)
    if err != nil {
        return "", err
    }
    defer f.Close()  // f.Close() will run when readFile returns

    data, err := io.ReadAll(f)
    if err != nil {
        return "", err
    }
    return string(data), nil
}
```

The arguments to a deferred call are evaluated immediately (at the point where `defer` is written), but the call itself is executed later. This is an important subtlety — if you defer a call with a variable, the variable's value at the time of the `defer` statement is captured, not its value at the time of return.

### Design Rationale

Go's use of multiple return values instead of exceptions is one of its most consequential design decisions. In languages with exceptions (Java, Python, JavaScript), any function call might throw an exception that the caller did not anticipate. The caller must either wrap the call in try/catch or let the exception propagate up the stack. This creates invisible control flow: reading a function's code, you cannot tell which calls might throw and which are safe.

Go takes the opposite approach. Errors are just values — they are returned like any other value, and the caller handles them with ordinary `if` statements. There is no hidden control flow, no stack unwinding, no need for try/catch blocks. Every potential failure point is visible in the code:

```go
data, err := os.ReadFile("config.json")
if err != nil {
    return fmt.Errorf("reading config: %w", err)
}
```

This approach has a cost: error handling code in Go is verbose. You will write `if err != nil` hundreds of times in a project. Go programmers accept this cost because the alternative — hidden exception paths — is worse in large systems. When you read Go code, you can see every failure path. When you read Java code, you cannot.

**Java** uses checked exceptions, which attempt to make exception handling explicit but lead to try/catch boilerplate and a temptation to catch-and-ignore. Unchecked exceptions bypass the system entirely. **Python** uses try/except with no enforcement — any function can raise any exception at any time, and nothing forces the caller to handle it. **Rust** uses the `Result<T, E>` type, which is conceptually similar to Go's `(result, error)` pattern but enforced by the type system — you cannot access the value without handling the error case first. Go's approach is simpler than Rust's (no sum types, no `?` operator) but relies on programmer discipline to check errors rather than compiler enforcement.

The `defer` keyword reflects Go's philosophy that resource cleanup should be written close to resource acquisition. Instead of putting cleanup code at the end of a function (where it might be missed) or in a `finally` block (which separates it from the resource it manages), `defer` lets you write the cleanup immediately after the acquisition. This makes it nearly impossible to forget cleanup and makes the intent obvious.

### Common Mistakes

**Ignoring error returns with `_`.** This is the single most dangerous anti-pattern in Go. When you write `result, _ := someFunction()`, you are silently discarding an error that the function explicitly told you about. The result may be a zero value, a partial result, or complete garbage when the error is non-nil. Go makes it easy to ignore errors — the `_` blank identifier exists for exactly this purpose — but using it to discard errors is almost always wrong. The only acceptable case is when you have genuinely reasoned about the function and determined that the error cannot occur in your context, or when the function's documentation explicitly says the error can be safely ignored in certain cases.

```go
// DANGEROUS: If Atoi fails, val is 0 and we proceed with wrong data
val, _ := strconv.Atoi(userInput)
price := val * 100  // Could be 0 * 100 = 0, silently wrong
```

**Not checking errors before using the result.** Even when you capture the error, using the result before checking the error is a bug:

```go
// BUG: Using result before checking error
f, err := os.Open("data.txt")
data, readErr := io.ReadAll(f)  // f might be nil if Open failed!
if err != nil {
    return err
}
```

The correct pattern is to always check the error immediately after the call, before touching the result.

**Overusing named returns in long functions.** Named returns are useful in short functions (under 10 lines) where the names add clarity. In longer functions, they become a liability because the reader must track which names have been assigned at each return point. Bare `return` in a 50-line function forces the reader to trace backward through the function to determine what is being returned. Prefer explicit return values in long functions:

```go
// Prefer this in long functions:
return result, nil

// Over this:
return  // bare return — what are we returning?
```

**Forgetting that named returns are initialized to zero values.** If your function has `(result int, err error)` as named returns and you hit a bare `return`, the result is 0 and err is nil. This can mask bugs if you forget to assign the result in some code path.

**Misunderstanding defer argument evaluation.** The arguments to a deferred function are evaluated at the `defer` statement, not at the point of execution:

```go
x := 10
defer fmt.Println(x)  // Will print 10, not 20
x = 20
```

If you need the deferred call to use the current value at the time of return, use a closure:

```go
x := 10
defer func() { fmt.Println(x) }()  // Will print 20
x = 20
```

### Key Takeaways

- Multiple return values are not a convenience — they are Go's error handling mechanism.
- The `(result, error)` pattern is the most important idiom in Go. Learn it deeply.
- Always check errors before using results. Never discard errors with `_` unless you have a strong reason.
- Named returns add clarity in short functions but hurt readability in long ones. Use them sparingly.
- `defer` ties cleanup to acquisition. Use it for closing files, releasing locks, and similar cleanup.
- Functions are first-class values. Closures capture variables by reference.
- Go's verbosity in error handling is a feature, not a bug — it makes every failure path visible.

---

## Broken Code

```go
package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	// BUG: Ignoring the error return from Atoi
	// If the input is not a valid number, val will be 0
	// and the program proceeds with incorrect data
	val, _ := strconv.Atoi("not-a-number")
	fmt.Println("Parsed value:", val)
	fmt.Println("Doubled:", val*2)

	// BUG: Using the file before checking the error
	f, err := os.Open("nonexistent-file.txt")
	contents := readAll(f) // f is nil because Open failed!
	if err != nil {
		fmt.Println("Error:", err)
	}
	fmt.Println("Contents:", contents)

	// BUG: Ignoring error from a function that signals failure
	result := unsafeDivide(10, 0)
	fmt.Println("Result:", result)
}

// This function returns an error, but the caller ignores it
func unsafeDivide(a, b int) int {
	if b == 0 {
		// The programmer wanted to signal an error but the function
		// signature only returns int — the error information is lost
		fmt.Println("Warning: division by zero")
		return 0
	}
	return a / b
}

// Simulates reading all content from a file
// In real code this would be io.ReadAll, but we simplify here
func readAll(f *os.File) string {
	if f == nil {
		return "" // silent failure — caller has no idea this failed
	}
	// ... read file contents ...
	return "file contents"
}
```

---

## Correct Code

```go
package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	// CORRECT: Check the error before using the result
	val, err := strconv.Atoi("not-a-number")
	if err != nil {
		fmt.Println("Failed to parse number:", err)
		// Handle the error — do not use val
	} else {
		fmt.Println("Parsed value:", val)
		fmt.Println("Doubled:", val*2)
	}

	// CORRECT: Check the error immediately, before using the file
	f, err := os.Open("nonexistent-file.txt")
	if err != nil {
		fmt.Println("Failed to open file:", err)
		// Do not attempt to read from f — it is nil
	} else {
		defer f.Close() // Clean up when done
		contents, err := readAllSafe(f)
		if err != nil {
			fmt.Println("Failed to read file:", err)
		} else {
			fmt.Println("Contents:", contents)
		}
	}

	// CORRECT: Function returns (result, error) and caller checks both
	result, err := safeDivide(10, 0)
	if err != nil {
		fmt.Println("Division failed:", err)
	} else {
		fmt.Println("Result:", result)
	}

	result, err = safeDivide(10, 3)
	if err != nil {
		fmt.Println("Division failed:", err)
	} else {
		fmt.Println("Result:", result)
	}
}

// CORRECT: Returns (result, error) so the caller can handle failure
func safeDivide(a, b int) (int, error) {
	if b == 0 {
		return 0, fmt.Errorf("cannot divide %d by zero", a)
	}
	return a / b, nil
}

// CORRECT: Returns (result, error) instead of silently returning empty string
func readAllSafe(f *os.File) (string, error) {
	if f == nil {
		return "", fmt.Errorf("file is nil")
	}
	// In real code, use io.ReadAll(f)
	return "file contents", nil
}
```

---

## Explanation

The broken code demonstrates the most common and most dangerous mistake in Go programming: ignoring errors. In the first case, `strconv.Atoi("not-a-number")` returns `0` and a non-nil error. By discarding the error with `_`, the program silently proceeds with the wrong value. The output says "Parsed value: 0" and "Doubled: 0" — no crash, no warning, just silently incorrect behavior. This is worse than an exception-based language where the program would crash and tell you what went wrong.

The second bug is subtler but equally dangerous: the program uses the file handle `f` before checking whether `os.Open` succeeded. When Open fails, `f` is nil, and passing a nil pointer to a function that dereferences it would cause a panic at runtime. The error check comes too late — the damage is already done.

The third case shows a function that detects a failure condition (division by zero) but has no way to communicate it to the caller because it only returns a single `int`. The function resorts to printing a warning and returning 0, which the caller cannot distinguish from a legitimate result of 0.

The correct code fixes all three issues by following Go's cardinal rule: always check errors before using results. The `safeDivide` function returns `(int, error)`, giving the caller explicit information about success or failure. The file operations check errors immediately after each call. Every failure path is visible and handled.

---

## Design Tradeoff

Go's `(result, error)` convention trades **conciseness for visibility**. In a Python or Java program, you write the happy path and handle errors separately in a catch block. This makes the happy path clean but hides the error paths. In Go, error handling is interleaved with the main logic, which makes the code longer but makes every failure point immediately visible.

This tradeoff becomes most apparent in functions that perform several operations in sequence. In Python, you might write:

```python
try:
    data = read_file(path)
    parsed = parse_data(data)
    result = process(parsed)
except Exception as e:
    handle_error(e)
```

The equivalent Go code is:

```go
data, err := readFile(path)
if err != nil {
    return fmt.Errorf("reading file: %w", err)
}
parsed, err := parseData(data)
if err != nil {
    return fmt.Errorf("parsing data: %w", err)
}
result, err := process(parsed)
if err != nil {
    return fmt.Errorf("processing: %w", err)
}
```

The Go version is three times longer. But it has three advantages: you can see every failure point, you can add context to each error (which file? what data?), and there are no hidden exception paths. When this function fails in production, the error message tells you exactly which step failed and why. The Python version tells you that something in the try block raised an exception — you have to read the traceback to figure out which line.

Go's approach demands discipline. The language does not force you to handle errors — you can always use `_` to discard them. This is a deliberate choice: Go trusts programmers to do the right thing rather than burdening the type system with enforcement (as Rust does with `Result`). Whether this trust is well-placed depends on the team and the codebase, but the Go community has strong conventions around error handling that serve as social enforcement where the compiler does not.

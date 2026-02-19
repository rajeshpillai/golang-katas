---
id: short-variable-declarations
phase: 0
phase_title: Go as a Language
sequence: 4
title: Short Variable Declarations
---

## Description

### Concept Overview

The `:=` operator is Go's shorthand for declaring and initializing variables in a single statement. Instead of writing the verbose `var x int = 42`, you can write `x := 42` and let the compiler infer the type from the right-hand side. This operator can only be used inside functions — it is not available at the package level. Understanding when to use `:=` versus `var` is one of the first decisions a Go programmer must make, and getting it right signals that you understand Go's philosophy of balancing convenience with explicitness.

### Technical Explanation

The `:=` operator performs two operations simultaneously: it declares a new variable and assigns it a value. The type of the variable is inferred from the expression on the right-hand side. For example, `name := "Alice"` creates a variable of type `string`, `count := 42` creates an `int`, and `ratio := 3.14` creates a `float64`. The compiler determines the type at compile time — this is not dynamic typing. Once a variable is declared with `:=`, its type is fixed and cannot change.

You can declare multiple variables at once with `:=`:

```go
x, y := 10, 20
name, age := "Bob", 30
```

There is an important **redeclaration rule** for multi-variable `:=` statements. When you use `:=` with multiple variables on the left side, at least one of the variables must be new. The others can be existing variables, in which case they are simply reassigned. This is often encountered with error handling:

```go
val, err := strconv.Atoi("42")    // both val and err are new
val2, err := strconv.Atoi("100")  // val2 is new, err is reassigned
```

This redeclaration rule is convenient but it also opens the door to one of Go's most subtle bugs: **variable shadowing**. When you use `:=` inside an inner scope (such as inside an `if` block, a `for` loop, or a nested function), you create a new variable that shadows the outer variable with the same name. The outer variable remains unchanged, which can lead to unexpected behavior that is difficult to debug.

```go
x := 10
if true {
    x := 20  // This is a NEW variable, not the outer x
    fmt.Println(x)  // Prints 20
}
fmt.Println(x)  // Prints 10 — the outer x was never modified
```

It is critical to understand the difference between `=` and `:=`. The `=` operator is **assignment only** — it assigns a value to an already-declared variable. The `:=` operator is **declaration plus assignment** — it creates a new variable. If you use `=` on an undeclared variable, the compiler will reject it. If you use `:=` when you intended to reassign an existing variable, you may accidentally create a new variable in the current scope, shadowing the outer one.

The `:=` operator cannot be used at the package level (outside of any function). Package-level variables must be declared with `var`. This is a deliberate restriction — package-level declarations are visible across files and sometimes across packages, so Go requires you to be explicit about their types. Inside functions, where scope is limited and types are usually obvious from context, the shorthand is permitted.

### Design Rationale

Go provides both `var` and `:=` because they serve different purposes in different contexts. The `var` keyword is the explicit, general-purpose declaration that works everywhere — at the package level, inside functions, with or without an initial value. The `:=` operator is the concise, ergonomic shorthand designed specifically for the common case inside functions where you are declaring a variable and immediately initializing it.

The restriction of `:=` to function scope is intentional. Package-level variables form part of a package's API or internal state. They persist for the lifetime of the program. Making their declarations explicit (with `var` and an explicit type) ensures that anyone reading the code can immediately understand the type and intent without having to reason about what the right-hand side evaluates to. Inside functions, variables are short-lived and local, so the convenience of type inference outweighs the cost of implicitness.

This approach sits in an interesting middle ground compared to other languages. In **Python**, there is no variable declaration at all — you just assign to a name and it exists. This is maximally convenient but makes it impossible to catch typos at compile time (`username` vs `user_name` are both valid). In **Rust**, `let` declarations use type inference extensively, similar to Go's `:=`, but Rust requires `let mut` for mutable variables, adding another dimension of explicitness. In **TypeScript**, you choose between `const`, `let`, and optional type annotations — the system is more flexible but also more complex. Go's two-option system (`var` for explicit, `:=` for inferred) is characteristically Go: simple, predictable, and clear about when each form is appropriate.

### Common Mistakes

**Using `:=` at package level.** This is a compiler error, not just a style issue. New Go programmers who come from Python or JavaScript sometimes try to write `x := 42` outside of any function. Go will reject this. The fix is to use `var x = 42` or `var x int = 42` at package level.

**Accidentally shadowing variables with `:=` in inner scopes.** This is the most dangerous pitfall of `:=`. It compiles without error and produces no warnings in standard Go tooling. It is especially common in `if` blocks with error handling:

```go
var err error
if condition {
    result, err := doSomething()  // This err is NEW, not the outer err
    // ...
}
// outer err is still nil here, even if doSomething() returned an error
```

The fix is to pre-declare variables when you need to use them across scopes, and use `=` (not `:=`) for assignment inside the inner scope.

**Trying to use `:=` with no new variables.** If all variables on the left side of `:=` already exist in the current scope, the compiler will report an error: "no new variables on left side of :=". You must introduce at least one new variable, or switch to `=` for pure reassignment.

**Confusion about default numeric types.** When you write `x := 42`, the type is `int`, not `int32` or `int64`. When you write `x := 3.14`, the type is `float64`, not `float32`. This is usually what you want, but it can cause type mismatch errors when passing values to functions that expect specific numeric types. If you need a specific type, use `var x float32 = 3.14` or a conversion like `x := float32(3.14)`.

### Key Takeaways

- `:=` declares and initializes a variable with an inferred type. It only works inside functions.
- `var` is the explicit declaration form that works everywhere. Use it at package level and when you want to declare a variable without an initial value (it gets the zero value).
- In multi-variable `:=`, at least one variable on the left must be new. Existing variables are reassigned.
- Variable shadowing with `:=` in inner scopes is a real and common source of bugs. Be vigilant.
- Go's type inference is compile-time — `:=` does not make Go dynamically typed.

---

## Broken Code

```go
package main

import "fmt"

// BUG: Attempting to use := at package level
message := "Hello from package level"

func main() {
	count := 10
	fmt.Println("Initial count:", count)

	// BUG: Variable shadowing — the inner count is a new variable
	if true {
		count := count + 5
		fmt.Println("Inner count:", count) // prints 15
	}

	// The outer count was never modified
	fmt.Println("Final count:", count) // prints 10, not 15 — unexpected!

	// BUG: Shadowed error variable hides a real error
	var err error
	if true {
		_, err := fmt.Println("doing work")
		if err != nil {
			fmt.Println("error caught inside:", err)
		}
	}
	// The outer err is still nil regardless of what happened inside
	fmt.Println("outer err is nil:", err == nil) // always true
}
```

---

## Correct Code

```go
package main

import "fmt"

// CORRECT: Use var at package level
var message = "Hello from package level"

func main() {
	count := 10
	fmt.Println("Initial count:", count)

	// CORRECT: Use = (assignment) to modify the outer variable
	if true {
		count = count + 5
		fmt.Println("Inner count:", count) // prints 15
	}

	// Now the outer count reflects the change
	fmt.Println("Final count:", count) // prints 15 as expected

	// CORRECT: Declare err before the if block, use = inside
	var err error
	if true {
		_, err = fmt.Println("doing work")
		if err != nil {
			fmt.Println("error caught inside:", err)
		}
	}
	// The outer err now correctly reflects any error from inside
	fmt.Println("outer err is nil:", err == nil)

	// CORRECT: := is fine when you genuinely want a new local variable
	name := "Alice"
	age := 30
	fmt.Printf("%s is %d years old\n", name, age)

	// CORRECT: Multi-variable := with redeclaration
	val, parseErr := 42, error(nil)
	val2, parseErr := 100, error(nil)
	fmt.Println(val, val2, parseErr)

	fmt.Println(message)
}
```

---

## Explanation

The broken code demonstrates two common mistakes with `:=`. First, it tries to use `:=` at the package level, which is a compile error — Go requires `var` for package-level declarations because those variables have broader visibility and longer lifetimes, so explicitness about their types is important.

Second, and more dangerously, it demonstrates variable shadowing. Inside the `if` block, `count := count + 5` creates a brand-new `count` variable that exists only within that block. The outer `count` is never modified, so the final print shows the original value of 10 instead of the expected 15. The same problem occurs with the `err` variable — the `:=` inside the `if` block creates a new `err` that shadows the outer one, so any error information is lost when the block ends.

The correct code fixes both issues. It uses `var` at the package level and uses plain `=` (assignment) inside inner scopes when the intent is to modify an existing variable rather than create a new one.

---

## Design Tradeoff

Go's `:=` operator represents a deliberate balance between **convenience** and **safety**. The convenience is clear: inside functions, you rarely need to spell out types when the compiler can infer them. The safety concern is equally real: `:=` can accidentally create new variables when you meant to reassign, especially in nested scopes.

Go chose not to add a compiler warning for shadowing because there are legitimate cases where shadowing is intentional (for example, deliberately narrowing a variable's scope). This means the burden falls on the programmer to be aware of scope boundaries. Tools like `go vet` and linters such as `shadow` from `golang.org/x/tools` can help catch unintentional shadowing, and experienced Go developers learn to be cautious with `:=` near scope boundaries.

The restriction of `:=` to function scope reflects Go's broader philosophy: global state should be declared deliberately, while local state can be declared conveniently. This asymmetry is not accidental — it nudges programmers toward smaller functions with local variables and away from sprawling global state.

---
id: variables-and-zero-values
phase: 0
phase_title: Go as a Language
sequence: 2
title: Variables and Zero Values
---

## Description

### Concept Overview

In Go, every variable always has a value. There is no concept of an "uninitialized" variable. When you declare a variable without assigning it, Go automatically assigns it the **zero value** for its type. This is not a default value that you configure — it is a guarantee built into the language specification. An `int` is `0`. A `string` is `""`. A `bool` is `false`. A pointer is `nil`. Always. Without exception.

This means that in Go, you can declare a variable and immediately use it without any setup. You will never encounter undefined behavior from reading an uninitialized variable. The zero value is always safe to use — it might not be the value you want, but it is always a valid value for the type.

### Technical Explanation

**The `var` keyword** is the standard way to declare variables in Go. It can be used in several forms:

```go
// Declare a single variable with explicit type
var name string

// Declare a single variable with explicit type and initial value
var age int = 30

// Declare multiple variables of the same type
var x, y, z int

// Declare multiple variables in a block
var (
    firstName string
    lastName  string
    age       int
    active    bool
)
```

When you declare a variable with `var` and do not assign a value, Go assigns the zero value. The zero values for all basic types are precisely defined:

| Type | Zero Value |
|------|-----------|
| `int`, `int8`, `int16`, `int32`, `int64` | `0` |
| `uint`, `uint8`, `uint16`, `uint32`, `uint64` | `0` |
| `float32`, `float64` | `0.0` |
| `complex64`, `complex128` | `(0+0i)` |
| `bool` | `false` |
| `string` | `""` (empty string, not nil) |
| Pointer types | `nil` |
| Slice types | `nil` |
| Map types | `nil` |
| Channel types | `nil` |
| Interface types | `nil` |
| Function types | `nil` |
| Struct types | All fields set to their respective zero values |
| Array types | All elements set to their respective zero values |

**How zero values work at the memory level**: When Go allocates memory for a variable, it zeroes out the entire block of memory before you ever see it. This is not a runtime check — it is part of Go's memory allocation strategy. The `runtime` package ensures that all newly allocated memory is zero-filled. This means that the zero value is not "assigned" to the variable in the way you might assign `x = 0`. Instead, the memory itself starts at zero, and the zero value is simply what that zeroed memory looks like when interpreted as a given type. An `int` stored in zeroed memory is `0`. A `bool` stored in zeroed memory is `false`. A `string` stored in zeroed memory is an empty string (its internal pointer is nil and its length is 0).

This is a performance optimization as well as a safety guarantee. The operating system typically provides zero-filled memory pages, and Go takes advantage of this. You get safety and performance in one design decision.

**Variable declaration blocks** let you group related declarations together, which improves readability:

```go
var (
    host     string
    port     int
    maxRetry int
    verbose  bool
)
```

After this declaration, `host` is `""`, `port` is `0`, `maxRetry` is `0`, and `verbose` is `false`. All of these are immediately usable. You do not need to check if they are "set" — they are always set.

### Design Rationale

Go's zero value design is a deliberate response to decades of bugs caused by uninitialized variables in other languages. Consider the alternatives:

**C** does not initialize local variables. A freshly declared `int x;` in C contains whatever garbage was already in that memory location. Reading it is undefined behavior — the program might crash, produce wrong results, or appear to work correctly until it suddenly does not. This is one of the most common sources of security vulnerabilities in C programs. Buffer overflows, information leaks, and logic errors all trace back to uninitialized memory.

**Java** partially addresses this with null references. Reference types default to `null`, and primitive types default to zero-like values (`0` for int, `false` for boolean). But `null` is a trap. Tony Hoare, who invented null references, called them his "billion-dollar mistake." In Java, any reference variable might be `null`, and accessing a method on a `null` reference throws a `NullPointerException` at runtime. Java programmers spend enormous effort guarding against `null` — writing defensive checks, using `Optional`, and adopting null-safety annotations. The language gives you a "default" that is actively dangerous.

**JavaScript** has two flavors of "nothing": `undefined` and `null`. A variable that has been declared but not assigned is `undefined`. A variable that has been explicitly set to "no value" is `null`. This distinction confuses beginners and experts alike. `undefined` is not a value you chose — it is the absence of a value. But JavaScript will happily let you do arithmetic with `undefined` (producing `NaN`), compare it to `null` (which is `true` with `==` but `false` with `===`), and pass it to functions that do not expect it. The result is an entire category of runtime errors that do not exist in Go.

Go's zero value design eliminates all of these problems. There is no `null` for value types. There is no `undefined`. There is no garbage memory. Every variable has a well-defined, type-appropriate starting value. You can declare an `int` and add to it immediately. You can declare a `string` and append to it immediately. You can declare a `bool` and branch on it immediately. The zero value is always a valid, usable value.

This design also enables a powerful pattern: **useful zero values**. Many Go standard library types are designed so that their zero value is a fully functional instance. `sync.Mutex{}` is an unlocked mutex ready to use. `bytes.Buffer{}` is an empty buffer ready to receive data. You do not need a constructor — the zero value works. This is a design principle that Go library authors are encouraged to follow: design your types so that the zero value is useful.

### Common Mistakes

**Assuming a variable is nil or undefined when it is zero-valued**: Programmers coming from languages with `null` or `undefined` often write code that checks "is this variable set?" by comparing to `nil`. But value types in Go cannot be `nil`. An `int` cannot be `nil` — it is `0`. A `string` cannot be `nil` — it is `""`. A `bool` cannot be `nil` — it is `false`. If you need to distinguish between "not set" and "set to the zero value," you need to use a pointer type (`*int`, `*string`) or a sentinel value. This is a deliberate design choice — Go forces you to think about whether the distinction matters.

**Not understanding that strings have a zero value of `""` (not nil)**: This trips up developers from Java and other languages where strings are reference types that default to `null`. In Go, `string` is a value type. Its zero value is the empty string `""`, which has a length of `0` and is perfectly valid. You can compare it, concatenate to it, and iterate over it. It is not `nil`, and you cannot compare a `string` to `nil` — the compiler will reject that comparison.

**Expecting Go to warn about unused zero-valued variables**: Go's compiler enforces that all declared local variables must be used. But "used" means referenced in code — it does not mean "assigned a non-zero value." If you declare `var count int` and then print it, Go is satisfied. It does not care that `count` is still `0`. The unused variable error exists to catch dead declarations, not to enforce initialization.

**Confusing zero values with nil for composite types**: Slices, maps, and channels have a zero value of `nil`. A `nil` slice is not the same as an empty slice. You can append to a `nil` slice (Go will allocate), but you cannot write to a `nil` map (it will panic). Understanding which composite types are safe to use at their zero value and which require explicit initialization with `make()` is critical.

### Key Takeaways

- Every variable in Go has a value from the moment it is declared — there is no "uninitialized" state.
- Zero values are type-specific and well-defined: `0` for numbers, `""` for strings, `false` for booleans, `nil` for pointers and reference types.
- Go zeroes allocated memory at the runtime level, making zero values both a safety guarantee and a performance optimization.
- Value types (`int`, `string`, `bool`, structs) cannot be `nil` — only pointer and reference types can.
- Design your own types so that their zero value is useful — this is an idiomatic Go pattern.
- If you need to distinguish "not set" from "set to zero value," use a pointer type or a dedicated flag — Go will not do this for you implicitly.

---

## Broken Code

```go
// broken: this program misunderstands zero values
package main

import "fmt"

func main() {
    var count int
    var name string
    var ready bool

    // Bug: checking if an int "has been set" by comparing to nil
    // This will not compile — int cannot be compared to nil
    if count == nil {
        fmt.Println("count is not set")
    }

    // Bug: checking if a string is nil
    // This will not compile — string cannot be compared to nil
    if name == nil {
        fmt.Println("name is not set")
    }

    // Bug: assuming an unset bool is somehow different from false
    if !ready {
        fmt.Println("ready has not been initialized yet")
        // Wrong mental model: ready IS initialized — to false
    }
}
```

---

## Correct Code

```go
// correct: understanding and using zero values deliberately
package main

import "fmt"

func main() {
    // All of these are immediately usable with their zero values
    var count int
    var name string
    var ready bool
    var ratio float64

    fmt.Println("int zero value:    ", count)   // 0
    fmt.Println("string zero value: ", name)    // "" (empty string)
    fmt.Println("bool zero value:   ", ready)   // false
    fmt.Println("float64 zero value:", ratio)   // 0

    // Zero values are usable — you can operate on them immediately
    count += 5
    name += "Go"
    ready = !ready
    ratio += 3.14

    fmt.Println("\nAfter operations:")
    fmt.Println("count:", count)   // 5
    fmt.Println("name: ", name)    // "Go"
    fmt.Println("ready:", ready)   // true
    fmt.Println("ratio:", ratio)   // 3.14

    // If you need to distinguish "not set" from "zero value",
    // use a pointer
    var middleName *string
    if middleName == nil {
        fmt.Println("\nmiddleName is not set (nil pointer)")
    }

    value := "Lee"
    middleName = &value
    fmt.Println("middleName is now:", *middleName)
}
```

---

## Explanation

The broken version reveals a common mental model mismatch. Programmers accustomed to languages with `null` or `undefined` instinctively reach for `nil` comparisons to check whether a variable "has been set." In Go, this does not work for value types. The expressions `count == nil` and `name == nil` are compilation errors — the Go compiler knows that `int` and `string` can never be `nil`, so comparing them to `nil` is meaningless.

The correct version demonstrates the right mental model: zero values are not a problem to check for; they are a feature to use. An `int` starts at `0`, and you can add to it. A `string` starts at `""`, and you can concatenate to it. A `bool` starts at `false`, and you can flip it. These are not "missing" values — they are real, deliberate starting points.

When you genuinely need to distinguish between "no value" and "the zero value" — for example, distinguishing "the user did not provide a middle name" from "the user's middle name is an empty string" — Go gives you pointers. A `*string` can be `nil` (not set) or point to a string value (set). This is an explicit choice you make in your type design, not something the language imposes on every variable.

---

## Design Tradeoff

Go's zero value system trades flexibility for safety. In languages with `null` or `undefined`, you can use a single variable to represent three states: "not set," "set to nothing," and "set to something." In Go, a value type can only be in one state: "set to something" (which might be the zero value). If you need the "not set" state, you must explicitly reach for a pointer or an optional-style pattern.

This adds a small amount of code in cases where you need the distinction. But it eliminates an enormous amount of defensive programming everywhere else. In Go, you never need to write `if x != nil` before using an `int`. You never need to guard against `NullPointerException` on a `string`. You never need to check for `undefined` before doing arithmetic. The zero value guarantee means that the simple, common case — declaring and using a variable — is always safe. The complex case — distinguishing "not set" from "zero" — requires explicit opt-in through pointer types, which makes the intent visible in the code.

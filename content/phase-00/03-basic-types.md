---
id: basic-types
phase: 0
phase_title: Go as a Language
sequence: 3
title: Basic Types
---

## Description

### Concept Overview

Go is strongly and statically typed. Every variable has a fixed type determined at compile time, and that type never changes. More importantly, Go does not perform implicit type conversions. If you have an `int` and a `float64`, you cannot add them together without explicitly converting one to the other. The compiler will reject it. This is a deliberate design decision that forces you to think about types, precision, and data representation every time you write an expression.

In many languages, the type system tries to be "helpful" by silently converting between types. Go takes the opposite stance: conversions are always visible in the code. When you read a Go expression like `float64(x) + y`, you know exactly what types are involved and where the conversion happens. There are no hidden transformations, no surprising coercions, and no silent precision loss.

### Technical Explanation

Go provides a complete set of basic types organized into several categories:

**Boolean type:**
- `bool` — holds `true` or `false`. The zero value is `false`. Boolean expressions in Go are strict — there is no truthy/falsy concept. You cannot use an integer or a string where a `bool` is expected. `if 1` does not compile in Go. You must write `if x != 0`.

**String type:**
- `string` — an immutable sequence of bytes, typically holding UTF-8 encoded text. The zero value is `""` (the empty string). Strings in Go are value types — assigning a string copies it (though internally, Go uses a pointer and length, so copies are cheap). Strings are immutable: you cannot change a character at a specific index. To modify a string, you create a new one. String concatenation with `+` works, but only between two `string` values — you cannot concatenate a `string` and an `int` with `+`.

**Integer types:**

| Type | Size | Range |
|------|------|-------|
| `int8` | 8 bits | -128 to 127 |
| `int16` | 16 bits | -32,768 to 32,767 |
| `int32` | 32 bits | -2,147,483,648 to 2,147,483,647 |
| `int64` | 64 bits | -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807 |
| `uint8` | 8 bits | 0 to 255 |
| `uint16` | 16 bits | 0 to 65,535 |
| `uint32` | 32 bits | 0 to 4,294,967,295 |
| `uint64` | 64 bits | 0 to 18,446,744,073,709,551,615 |
| `int` | platform-dependent | 32 or 64 bits |
| `uint` | platform-dependent | 32 or 64 bits |
| `uintptr` | platform-dependent | large enough to hold a pointer |

The `int` and `uint` types deserve special attention. Their size is **platform-dependent**: on a 32-bit system, `int` is 32 bits; on a 64-bit system, `int` is 64 bits. This means that `int` is **not** an alias for `int64` — they are distinct types even on a 64-bit system. You cannot assign an `int` to an `int64` variable without an explicit conversion, even if they happen to be the same size on your machine. This is Go being explicit about types rather than making platform-dependent assumptions.

In practice, you should use `int` for most integer work. Use sized integers (`int32`, `int64`, etc.) when you need a specific size — for example, when working with binary protocols, file formats, or interoperating with C code.

**Floating-point types:**
- `float32` — IEEE 754 single-precision (about 7 decimal digits of precision)
- `float64` — IEEE 754 double-precision (about 15 decimal digits of precision)

Use `float64` by default. The `float32` type exists for memory-constrained situations (large arrays of floats, GPU interop) but offers less precision. Numeric literals with a decimal point (like `3.14`) default to `float64`.

**Complex types:**
- `complex64` — complex number with `float32` real and imaginary parts
- `complex128` — complex number with `float64` real and imaginary parts

These are built into the language and support arithmetic operations directly. They are uncommon outside of scientific computing, but their inclusion in the language reflects Go's goal of being a general-purpose systems language.

**Type aliases:**
- `byte` is an alias for `uint8`. It is used by convention when working with raw byte data — file contents, network packets, encodings. Semantically, `byte` signals "this is raw data," while `uint8` signals "this is a small number."
- `rune` is an alias for `int32`. It represents a Unicode code point. When you iterate over a string with `for range`, each element is a `rune`, not a `byte`. This distinction is critical for correct Unicode handling. A single character like "e" with an accent or a Chinese character might be multiple bytes in UTF-8 encoding but is always a single `rune`. Understanding the difference between `byte` and `rune` is essential for writing correct string-processing code in Go.

```go
s := "Hello, world"        // s is a string of bytes
b := s[0]                // b is a byte (uint8), value 72 ('H')
for i, r := range s {   // r is a rune (int32) — a Unicode code point
    fmt.Printf("%d: %c\n", i, r)
}
```

**Type conversions** in Go are always explicit. The syntax is `T(v)` where `T` is the target type and `v` is the value to convert:

```go
var x int = 42
var y float64 = float64(x)  // explicit conversion required
var z int = int(y)           // explicit conversion, truncates decimal
```

This applies even between types that seem "compatible." You cannot assign an `int32` to an `int64` without writing `int64(x)`. You cannot pass a `float32` where a `float64` is expected. The compiler enforces this consistently.

### Design Rationale

Go's refusal to perform implicit type conversions is a direct response to the problems caused by implicit conversions in other languages.

**C** allows implicit conversions between numeric types, which leads to silent data loss. Assigning a `double` to an `int` silently truncates the decimal. Assigning a large `long` to a `short` silently overflows. Comparing a signed `int` with an unsigned `uint` uses surprising conversion rules that have caused real security vulnerabilities. The C standard defines complex "integer promotion" rules that even experienced programmers struggle to apply correctly. A significant percentage of CVEs in C codebases trace back to implicit conversion bugs.

**Python** takes the opposite extreme: integers have arbitrary precision, and Python will silently convert between `int` and `float` as needed. This is convenient, but it hides real performance and precision concerns. When you write `x = 2 ** 1000` in Python, you get a number with 302 digits — but you do not think about the cost. When you mix `int` and `float` in an expression, Python silently converts the `int` to a `float`, potentially losing precision for very large integers. Python's approach works well for scripting but poorly for systems programming where you need to control memory layout and performance.

**JavaScript** is the cautionary tale. JavaScript has a single numeric type (`Number`, which is a 64-bit float) and performs aggressive type coercion. The expression `"5" + 3` produces `"53"` (string concatenation), while `"5" - 3` produces `2` (numeric subtraction). `[] + []` produces `""`. `{} + []` produces `0`. These are not obscure edge cases — they are natural consequences of JavaScript's coercion rules, and they cause real bugs in production code. The introduction of `BigInt` as a separate type in modern JavaScript acknowledges that one numeric type was not enough, but the coercion problems remain.

Go's explicit conversion requirement means you will never accidentally lose precision, silently overflow, or produce surprising results from mixed-type arithmetic. Every conversion is visible in the code. Every conversion is intentional. When you write `int(f)` and `f` is `3.7`, you know you are truncating to `3` because you explicitly asked for it. There is no silent truncation — you made a visible decision.

### Common Mistakes

**Trying to add `int` and `float64` directly**: This is the most common type error for Go beginners. In most languages, `5 + 3.14` just works. In Go, if `x` is an `int` and `y` is a `float64`, the expression `x + y` is a compilation error. You must write `float64(x) + y` or `x + int(y)`, depending on which type you want the result to be. This feels tedious at first, but it forces you to make a deliberate choice about precision.

**Assuming string concatenation with `+` works with non-strings**: In Go, `"count: " + 5` does not compile. The `+` operator for strings only works between two `string` values. To include a number in a string, you use `fmt.Sprintf("count: %d", 5)` or `strconv.Itoa(5)`. There is no automatic conversion from numbers to strings.

**Confusing `byte` and `rune`**: Indexing into a string with `s[i]` gives you a `byte`, not a character. For ASCII text, this happens to be the same thing. But for UTF-8 text with multi-byte characters, a single character might span multiple bytes. If you want characters (Unicode code points), use `for _, r := range s` to get `rune` values, or convert the string to `[]rune`. Getting this wrong leads to corrupted text, incorrect string lengths, and garbled output when processing international text.

**Not understanding that `int` size is platform-dependent**: Code that works on your 64-bit development machine might behave differently on a 32-bit system if you are using `int` to hold large values. If you need a guaranteed 64-bit integer, use `int64` explicitly. Conversely, do not use `int64` everywhere "just to be safe" — use `int` for general-purpose integers and sized types only when the size matters for correctness.

**Assuming numeric literals default to a specific type**: Untyped numeric constants in Go have a "default type" that is used when the context does not specify a type. Integer literals default to `int`, and floating-point literals default to `float64`. This means `x := 42` gives you an `int`, and `y := 3.14` gives you a `float64`. If you need a `float32` or an `int8`, you must be explicit: `var y float32 = 3.14` or `y := float32(3.14)`.

### Key Takeaways

- Go is strongly and statically typed — every variable has a fixed type, and the compiler enforces it.
- There are no implicit type conversions in Go. Every conversion must be explicit using `T(v)` syntax.
- Use `int` for general-purpose integers and sized types (`int32`, `int64`) only when you need a specific size.
- `byte` is an alias for `uint8` (raw data), and `rune` is an alias for `int32` (Unicode code points) — know when to use each.
- `int` is platform-dependent (32 or 64 bits) and is a distinct type from `int32` or `int64`, even when they happen to be the same size.
- Prefer `float64` over `float32` unless memory constraints demand otherwise.
- String indexing (`s[i]`) gives bytes, not characters — use `range` or `[]rune` conversion for correct Unicode handling.

---

## Broken Code

```go
// broken: this program tries to mix types without conversion
package main

import "fmt"

func main() {
    var count int = 10
    var price float64 = 19.99

    // Bug: cannot add int and float64 without explicit conversion
    total := count * price
    fmt.Println("Total:", total)

    // Bug: cannot concatenate string and int with +
    label := "Items: " + count
    fmt.Println(label)

    // Bug: treating int and int64 as the same type
    var big int64 = 1000000
    sum := count + big
    fmt.Println("Sum:", sum)
}
```

---

## Correct Code

```go
// correct: explicit type conversions make intent clear
package main

import "fmt"

func main() {
    var count int = 10
    var price float64 = 19.99

    // Explicit conversion: int to float64 for multiplication
    total := float64(count) * price
    fmt.Println("Total:", total)

    // Use fmt.Sprintf to build strings with non-string values
    label := fmt.Sprintf("Items: %d", count)
    fmt.Println(label)

    // Explicit conversion: int to int64 to match types
    var big int64 = 1000000
    sum := int64(count) + big
    fmt.Println("Sum:", sum)

    // Demonstrating byte vs rune
    s := "Hello"
    fmt.Printf("byte at index 0: %d (%c)\n", s[0], s[0]) // byte: 72 (H)

    for i, r := range s {
        fmt.Printf("rune at index %d: %d (%c)\n", i, r, r) // rune values
    }
}
```

---

## Explanation

The broken version contains three distinct type errors, each of which the Go compiler will reject.

First, `count * price` tries to multiply an `int` by a `float64`. In Go, the `*` operator requires both operands to be the same type. There is no implicit "widening" conversion from `int` to `float64`. The fix is `float64(count) * price`, which explicitly converts `count` to `float64` before the multiplication. This makes the programmer's intent clear: we want floating-point multiplication, and we accept that our integer is now being treated as a float.

Second, `"Items: " + count` tries to concatenate a `string` with an `int`. The `+` operator on strings only works between two strings — Go will not call any `toString()` method or perform any automatic conversion. The fix uses `fmt.Sprintf("Items: %d", count)`, which is Go's standard way of formatting values into strings. The format verb `%d` explicitly declares that we are formatting an integer as a decimal string.

Third, `count + big` tries to add an `int` to an `int64`. Even though `int` might be 64 bits on your machine, `int` and `int64` are different types in Go's type system. The fix is `int64(count) + big`, which explicitly converts the `int` to `int64`. This conversion is always safe (it widens or stays the same), but Go still requires you to write it out.

Every one of these fixes adds a few characters of code. But every one of them also adds clarity. When you read the correct version, you know exactly what types are involved at every step. There is no guesswork, no reliance on implicit rules, and no risk of platform-dependent behavior.

---

## Design Tradeoff

Go's requirement for explicit type conversions trades brevity for precision. In Python, `10 * 19.99` produces `199.9` without any thought about types. In Go, you must write `float64(10) * 19.99` or declare your variables with matching types from the start. This feels like unnecessary ceremony for simple arithmetic.

But the ceremony serves a purpose. In a large codebase with hundreds of contributors, implicit conversions become a source of subtle bugs. A function that expects a `float64` might silently accept an `int` and produce wrong results due to precision differences. A comparison between signed and unsigned integers might produce surprising results. A value that fits in `int32` on one platform might overflow silently on another.

Go's approach eliminates these problems by making every conversion explicit and every type mismatch a compile-time error. You pay the cost of a few extra keystrokes, but you gain the certainty that your arithmetic expressions mean exactly what they say. In Go's philosophy, the reader of the code should never have to consult conversion rules or worry about hidden transformations. The code is the specification.

---
id: control-flow
phase: 0
phase_title: Go as a Language
sequence: 5
title: Control Flow
---

## Description

### Concept Overview

Go has only a few control flow constructs: `if`, `for`, and `switch`. There is no `while` loop, no `do-while` loop, and no ternary operator (`condition ? a : b`). This minimalism is deliberate. Where other languages offer multiple ways to express the same logic, Go provides one clear way. The result is code that reads consistently across teams, projects, and years. Every Go program you encounter uses the same small set of constructs, which dramatically reduces the cognitive load of reading unfamiliar code.

This design choice is one of the most polarizing aspects of Go for newcomers. Programmers coming from Python, JavaScript, or Rust often feel that Go is "missing" features. But Go's position is that fewer constructs with clear semantics produce more maintainable code than many constructs with overlapping purposes. Once you internalize Go's control flow, you stop reaching for constructs that don't exist and start appreciating the clarity of the ones that do.

### Technical Explanation

**`if` statements** in Go do not require parentheses around the condition, and the braces are always required. The opening brace must be on the same line as the `if` keyword — this is enforced by `gofmt` and is non-negotiable in Go style.

Go's `if` has a powerful feature that many languages lack: an **optional init statement** separated from the condition by a semicolon. This allows you to scope a variable to the `if`/`else` block:

```go
if err := doSomething(); err != nil {
    // handle error — err is only visible here and in else
    return err
}
// err is not accessible here
```

This pattern is idiomatic Go and appears constantly in error handling. The init statement keeps the error variable tightly scoped, preventing accidental use after the check. The variable declared in the init statement is available in both the `if` body and any `else` or `else if` branches, but not outside the entire `if` block.

**`for` is Go's only loop construct.** It serves three distinct purposes depending on its form:

The **C-style for loop** has init, condition, and post statements:

```go
for i := 0; i < 10; i++ {
    fmt.Println(i)
}
```

The **while-style for loop** has only a condition — this replaces the `while` keyword found in other languages:

```go
for count > 0 {
    count--
}
```

The **infinite loop** has no condition at all:

```go
for {
    // runs forever until break, return, or panic
    if done {
        break
    }
}
```

Additionally, `for range` iterates over slices, maps, strings, and channels:

```go
for index, value := range collection {
    fmt.Println(index, value)
}
```

An important subtlety: when you use `for range` over a string, it iterates over **runes** (Unicode code points), not individual bytes. The index jumps by the byte width of each rune, and the value is of type `rune` (`int32`). This means the index may not increment by 1 for each iteration if the string contains multi-byte characters. If you need to iterate over raw bytes, convert the string to `[]byte` first.

**`switch` statements** in Go differ from C, Java, and JavaScript in one critical way: **cases do not fall through by default.** Each case is an independent block. When a case matches, its body executes and the switch ends. There is no need for `break` at the end of each case.

```go
switch day {
case "Monday":
    fmt.Println("Start of the week")
case "Friday":
    fmt.Println("Almost weekend")
default:
    fmt.Println("Regular day")
}
```

If you explicitly want fallthrough behavior (which is rare), you use the `fallthrough` keyword. Note that `fallthrough` is unconditional — it transfers control to the next case's body regardless of whether that case's condition matches. This makes it a blunt instrument that is seldom needed.

Go also supports **switch with no condition**, which acts as a cleaner alternative to long `if`/`else if` chains:

```go
switch {
case score >= 90:
    grade = "A"
case score >= 80:
    grade = "B"
case score >= 70:
    grade = "C"
default:
    grade = "F"
}
```

This form evaluates each case as a boolean expression from top to bottom, executing the first one that is true. It reads much more clearly than nested `if`/`else if` blocks, especially when there are many conditions.

**Labeled `break` and `continue`** are available for nested loops. You can label an outer loop and use `break label` or `continue label` to control it from within an inner loop:

```go
outer:
for i := 0; i < 10; i++ {
    for j := 0; j < 10; j++ {
        if i+j == 15 {
            break outer  // breaks the outer loop, not just the inner one
        }
    }
}
```

Without labels, `break` and `continue` always apply to the innermost enclosing loop. Labels provide explicit control when you need to affect an outer loop.

### Design Rationale

**Why no `while` keyword?** Because `for` already covers every loop pattern. Having both `for` and `while` would mean two ways to write the same thing, which contradicts Go's principle of one obvious way to do things. A `for` with just a condition (`for x > 0`) is syntactically identical to what `while` would be, and every Go programmer recognizes it immediately.

**Why does `switch` not fall through?** In C and Java, forgetting a `break` statement in a switch case is one of the most common sources of bugs. The fallthrough behavior is almost never intentional, yet it is the default. Go inverts this: the safe behavior (no fallthrough) is the default, and the rare behavior (explicit `fallthrough`) requires an explicit keyword. This is a textbook example of Go choosing correctness over tradition.

**Why is there no ternary operator?** The ternary operator (`condition ? valueIfTrue : valueIfFalse`) is a frequent source of deeply nested, hard-to-read expressions in languages that have it. Go's designers decided that the marginal savings of one line do not justify the readability cost. In Go, you write:

```go
var result string
if condition {
    result = "yes"
} else {
    result = "no"
}
```

This is more verbose but immediately clear to every reader, regardless of their experience level.

Compared to **C**, Go eliminates an entire class of switch bugs by removing implicit fallthrough. Compared to **Python** (which had no switch-like construct until `match` in 3.10), Go's switch is more structured and handles complex dispatch cleanly. Compared to **JavaScript**, Go's control flow is simpler because there is no `while`, no `do-while`, no `for...in` vs `for...of` confusion — just `for` and `for range`.

### Common Mistakes

**Using parentheses around `if` conditions.** This compiles in Go but is not idiomatic. `gofmt` will not remove them, but every code review will flag them. Write `if x > 0` not `if (x > 0)`. Programmers coming from C, Java, or JavaScript make this mistake frequently.

**Forgetting that `for range` over a string iterates runes, not bytes.** If you have a string with multi-byte UTF-8 characters (like emojis or accented letters), the indices from `for range` will skip values. The index represents the byte position of each rune, not its ordinal position. This catches developers off guard when they expect sequential indices 0, 1, 2, 3, etc.

**Trying to use a `while` keyword.** Go has no `while`. Use `for condition { ... }` instead. This is a pure syntax error and is caught immediately by the compiler, but it trips up every new Go programmer at least once.

**Expecting C-style switch fallthrough.** Developers from C, Java, or JavaScript backgrounds often omit `break` from switch cases, expecting it to be necessary. In Go, each case is already self-contained. If you actually want fallthrough, you must use the `fallthrough` keyword, and you should think carefully about whether you really need it — in practice, it is rarely the right choice.

**Forgetting that `fallthrough` is unconditional.** When you use `fallthrough`, execution moves to the next case's body without checking its condition. This is different from C's fallthrough, where the next case's label is simply skipped but the condition implicitly matches. In Go, `fallthrough` is a blunt jump and can produce surprising results if you expect conditional evaluation.

### Key Takeaways

- Go has three control flow constructs: `if`, `for`, `switch`. That is all you need.
- `if` supports an init statement for scoping variables tightly, especially useful for error checks.
- `for` is the only loop keyword. It replaces `while`, `do-while`, and traditional `for` from other languages.
- `switch` does not fall through by default. This eliminates a major class of bugs from C-family languages.
- Conditionless `switch` is a clean replacement for long `if`/`else if` chains.
- Go sacrifices brevity for clarity at every decision point.

---

## Broken Code

```go
package main

import "fmt"

func main() {
	score := 85

	// BUG: Unnecessary parentheses — not idiomatic Go
	if (score >= 90) {
		fmt.Println("Grade: A")
	} else if (score >= 80) {
		fmt.Println("Grade: B")
	} else {
		fmt.Println("Grade: C")
	}

	// BUG: Expecting C-style switch fallthrough
	// The programmer wants "small" to print for both 1 and 2
	size := 1
	switch size {
	case 1:
		fmt.Println("small")
		// Missing fallthrough — programmer expects C behavior
	case 2:
		fmt.Println("small")
	case 3:
		fmt.Println("medium")
	default:
		fmt.Println("large")
	}

	// BUG: Using while — this won't compile
	// count := 5
	// while count > 0 {
	//     fmt.Println(count)
	//     count--
	// }

	// BUG: Expecting sequential indices when ranging over multi-byte string
	greeting := "Hello, \u4e16\u754c" // "Hello, World" in Chinese
	fmt.Println("Characters in greeting:")
	for i, ch := range greeting {
		// Programmer expects i to be 0,1,2,3,4,5,6,7,8
		// But after the ASCII characters, indices jump due to multi-byte runes
		fmt.Printf("  index=%d char=%c\n", i, ch)
	}

	// BUG: Attempting to scope a variable but accessing it outside the if block
	if val := computeValue(); val > 50 {
		fmt.Println("High value:", val)
	}
	// This would fail: val is not accessible here
	// fmt.Println("Value was:", val) // compile error if uncommented
}

func computeValue() int {
	return 75
}
```

---

## Correct Code

```go
package main

import "fmt"

func main() {
	score := 85

	// CORRECT: No parentheses around conditions — idiomatic Go
	if score >= 90 {
		fmt.Println("Grade: A")
	} else if score >= 80 {
		fmt.Println("Grade: B")
	} else {
		fmt.Println("Grade: C")
	}

	// CORRECT: Use conditionless switch for cleaner multi-condition logic
	switch {
	case score >= 90:
		fmt.Println("Grade: A")
	case score >= 80:
		fmt.Println("Grade: B")
	case score >= 70:
		fmt.Println("Grade: C")
	default:
		fmt.Println("Grade: F")
	}

	// CORRECT: Group cases that share behavior instead of relying on fallthrough
	size := 1
	switch size {
	case 1, 2:
		fmt.Println("small")
	case 3:
		fmt.Println("medium")
	default:
		fmt.Println("large")
	}

	// CORRECT: Use for as a while loop — no while keyword needed
	count := 5
	for count > 0 {
		fmt.Println(count)
		count--
	}

	// CORRECT: C-style for loop
	for i := 0; i < 5; i++ {
		fmt.Println("i:", i)
	}

	// CORRECT: Infinite loop with break
	attempts := 0
	for {
		attempts++
		if attempts >= 3 {
			fmt.Println("Done after", attempts, "attempts")
			break
		}
	}

	// CORRECT: Ranging over a string with awareness of rune indices
	greeting := "Hello, \u4e16\u754c" // "Hello, World" in Chinese
	fmt.Println("Runes in greeting (indices are byte positions):")
	for i, ch := range greeting {
		fmt.Printf("  byte_offset=%d rune=%c\n", i, ch)
	}

	// CORRECT: If you need sequential indices, collect runes first
	runes := []rune(greeting)
	fmt.Println("Runes with sequential indices:")
	for i, ch := range runes {
		fmt.Printf("  index=%d rune=%c\n", i, ch)
	}

	// CORRECT: if with init statement — variable scoped to the if/else block
	if val := computeValue(); val > 50 {
		fmt.Println("High value:", val)
	} else {
		fmt.Println("Low value:", val)
	}
	// val is intentionally not accessible here — tight scoping is the goal
}

func computeValue() int {
	return 75
}
```

---

## Explanation

The broken code illustrates several non-idiomatic patterns that new Go programmers fall into. The parentheses around `if` conditions compile but violate Go style — every Go developer will recognize them as coming from someone who has not yet internalized Go conventions. The switch statement demonstrates the C-fallthrough expectation: the programmer wanted cases 1 and 2 to share the same output but wrote two separate case bodies instead of grouping them with `case 1, 2:`. The multi-byte string iteration shows how `for range` over a string yields byte offsets as indices, not sequential ordinal positions, which surprises anyone who has not encountered Unicode handling in Go.

The correct code shows idiomatic solutions for each problem. Cases that share behavior are grouped with comma-separated values. The `for` keyword replaces `while` seamlessly. The conditionless `switch` cleans up the `if`/`else if` chain. And the string iteration either accepts byte offsets as indices or converts to a `[]rune` slice first when sequential indices are needed.

---

## Design Tradeoff

Go's minimalist control flow is a tradeoff between **expressiveness** and **consistency**. Languages like Python, Kotlin, and Rust offer list comprehensions, pattern matching, and other high-level constructs that can express complex logic concisely. Go deliberately omits these features. The cost is more lines of code for certain operations. The benefit is that every Go programmer in the world reads and writes the same basic patterns. There is no debate about whether to use a list comprehension or a for loop, whether to use a ternary or an if statement, whether to use `while` or `for`. The decision is already made.

The switch fallthrough decision is a microcosm of Go's broader philosophy: **safe defaults over familiar defaults**. In C, the default (fallthrough) causes bugs. In Go, the default (no fallthrough) prevents them. Programmers who need fallthrough can opt in explicitly, but the vast majority of switch statements never need it. This is Go choosing to protect the common case at the expense of a minor inconvenience in the rare case.

The absence of a ternary operator is perhaps the most contentious choice. It forces you to write four lines where one would do. But Go's designers observed that in large codebases, nested ternaries become unreadable, and even simple ternaries are less clear to junior developers than explicit `if`/`else` blocks. Go consistently chooses the option that optimizes for reading, not writing — because code is read far more often than it is written.

---
id: type-parameters
phase: 7
phase_title: Generics (Carefully)
sequence: 1
title: Type Parameters
---

## Description

### Concept Overview

A **type parameter** lets you write a function or type that works for many concrete types while keeping full compile-time type safety. Instead of writing one `MaxInt` and another `MaxFloat`, or falling back to `interface{}` and losing all type information, you write a single `Max[T]` once. The `T` is a placeholder — a *type parameter* — that the compiler fills in with a real type when the code is called.

Generics arrived in Go 1.18 (March 2022), more than twelve years after Go 1.0. Before that, the only tools for abstraction were interfaces (which erase concrete types) and code generation. Type parameters give Go a third tool: parametric polymorphism. The key thing to internalize first is the *mechanics* — how you declare a type parameter, how Go infers it, and how it differs from `interface{}`.

### Technical Explanation

A type parameter list appears in **square brackets** immediately after the function or type name. Each entry has a name and a **constraint** — an interface describing what types are allowed:

```go
func Map[T any, U any](in []T, f func(T) U) []U {
    out := make([]U, len(in))
    for i, v := range in {
        out[i] = f(v)
    }
    return out
}
```

Here `T` and `U` are type parameters. The constraint `any` (an alias for `interface{}`) means "any type at all." `Map` takes a slice of `T`, a function from `T` to `U`, and returns a slice of `U` — all checked at compile time.

**Instantiation** is the act of substituting concrete types for the type parameters. You can do it explicitly:

```go
doubled := Map[int, int]([]int{1, 2, 3}, func(n int) int { return n * 2 })
```

**Type inference** lets you usually omit the type arguments — the compiler deduces them from the ordinary arguments:

```go
doubled := Map([]int{1, 2, 3}, func(n int) int { return n * 2 }) // T=int, U=int inferred
```

Inference works when every type parameter appears in the *function parameter* types. If a type parameter appears only in the return type (and nowhere in the arguments), you must supply it explicitly, because there is nothing to infer it from:

```go
func Zero[T any]() T {        // T cannot be inferred from arguments
    var z T
    return z
}
n := Zero[int]()             // must instantiate explicitly
```

**Generic types** work the same way. A type parameter list follows the type name:

```go
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 {
        return zero, false
    }
    v := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return v, true
}
```

Note that methods on a generic type **cannot introduce new type parameters of their own** — they may only use the ones declared on the receiver type. The method receiver writes `(s *Stack[T])`, reusing `T`.

**`var zero T`** is the idiom for producing the zero value of an unknown type. You cannot write `return nil` (the constraint might not permit nil) or `return 0` (the type might not be numeric). Declaring `var zero T` gives you the correct zero value whatever `T` turns out to be.

The compiler turns generic code into real, statically typed code. There is **no boxing and no runtime type assertion** in the common case — `Map[int, int]` operates on actual `int` values, not on `interface{}` wrappers.

### Design Rationale

Go's designers deliberately shipped the language *without* generics in 2009 and resisted them for over a decade. This was not an oversight. They wanted to avoid the complexity that generics added to other languages, and they spent years searching for a design that fit Go's emphasis on simplicity and fast compilation. The eventual design (the "type parameters" proposal) was chosen because it reused interfaces — which Go programmers already understood — as the mechanism for constraints.

Compare the landscape:

- **Java** implements generics with *type erasure*: `List<String>` and `List<Integer>` are the same type at runtime, and values are boxed objects. This keeps the JVM simple but forces wrapper types (`Integer` instead of `int`) and loses type information at runtime.
- **C#** uses *reified* generics: type information survives to runtime and value types are not boxed, giving strong performance but requiring deeper runtime support.
- **C++** uses *templates*, which are essentially compile-time code substitution. They are extremely powerful and fast but produce notoriously cryptic error messages and large binaries.
- **Rust** uses *monomorphization* with trait bounds — closest in spirit to Go, generating specialized code per type with constraints checked at compile time.

Go's implementation sits between these. The compiler may generate a distinct version of the code per type (like C++/Rust) or share an implementation among types with the same memory layout (a technique called *GC shape stenciling*) to keep binary size and compile times reasonable. The practical upshot for you: generics in Go are type-safe, fast, and do not require boxing — but you should reach for them only when they earn their place.

### Common Mistakes

**Reaching for generics when an interface would be clearer.** If your function only needs to call a method (like `String()` or `Write()`), an ordinary interface parameter is simpler and more idiomatic. Type parameters shine when you need to *preserve the concrete type* across input and output, not merely call behavior. Writing `func Print[T fmt.Stringer](v T)` instead of `func Print(v fmt.Stringer)` adds machinery for no benefit.

**Trying to return `nil` or `0` for an unknown type.** Inside a generic function, `var zero T` is the only correct way to produce a zero value. `return nil` fails to compile unless the constraint guarantees a nilable type, and `return 0` fails unless `T` is numeric.

**Adding type parameters to methods.** Go does not allow a method to declare its own type parameters. Only the type itself (or a free function) may. If you find yourself wanting a generic method, you usually want a generic free function instead.

**Over-specifying type arguments.** Writing `Map[int, int](...)` when inference would handle it adds noise. Let the compiler infer unless inference genuinely cannot determine the types.

**Assuming inference works from the return type.** Type parameters that appear only in the return position cannot be inferred. You must instantiate explicitly, as with `Zero[int]()`.

### Key Takeaways

- A type parameter is a named placeholder, declared in `[brackets]` after the function or type name, each paired with a constraint.
- `any` is the constraint that permits every type; it is an alias for `interface{}`.
- Type inference usually lets you omit explicit type arguments — but only when the parameter appears in the function's ordinary arguments.
- Use `var zero T` to produce the zero value of an unknown type; never assume `nil` or `0`.
- Generic types declare their parameters once; their methods reuse those parameters and cannot add new ones.
- Generics preserve concrete types with compile-time safety and no boxing — reach for them only when that preservation is the actual goal.

---

## Broken Code

```go
// broken: tries to be "generic" with interface{} and loses all type safety
package main

import "fmt"

// Returns the larger of two values — but uses interface{}, so it
// compiles only with unsafe assertions and breaks at runtime.
func Max(a, b interface{}) interface{} {
    // We cannot use > on interface{} — the compiler rejects this line.
    if a > b {
        return a
    }
    return b
}

func main() {
    // Even if the comparison "worked", callers get back interface{}
    // and must assert the type, defeating the purpose.
    biggest := Max(3, 7)
    n := biggest.(int) + 1 // fragile: panics if the dynamic type is wrong
    fmt.Println(n)
}
```

---

## Correct Code

```go
// correct: a single generic function, fully type-safe, no assertions
package main

import "fmt"

// Map applies f to every element, transforming a []T into a []U.
// T and U are type parameters; both use the `any` constraint.
func Map[T any, U any](in []T, f func(T) U) []U {
	out := make([]U, len(in))
	for i, v := range in {
		out[i] = f(v)
	}
	return out
}

// Stack is a generic type. Its single type parameter T is reused by
// every method via the receiver (s *Stack[T]).
type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(v T) {
	s.items = append(s.items, v)
}

func (s *Stack[T]) Pop() (T, bool) {
	var zero T // correct zero value for an unknown type
	if len(s.items) == 0 {
		return zero, false
	}
	v := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	return v, true
}

func main() {
	// Type inference: T=int, U=string deduced from the arguments.
	nums := []int{1, 2, 3}
	labels := Map(nums, func(n int) string {
		return fmt.Sprintf("#%d", n)
	})
	fmt.Println("mapped:", labels)

	// Explicit instantiation is also allowed (here it is redundant).
	doubled := Map[int, int](nums, func(n int) int { return n * 2 })
	fmt.Println("doubled:", doubled)

	// The generic Stack works for any element type, type-checked at compile time.
	var s Stack[string]
	s.Push("go")
	s.Push("generics")
	if v, ok := s.Pop(); ok {
		fmt.Println("popped:", v)
	}

	// Popping an empty stack returns the zero value and false — no panic.
	var empty Stack[int]
	v, ok := empty.Pop()
	fmt.Printf("empty pop: value=%d ok=%t\n", v, ok)
}
```

---

## Explanation

The broken version shows the pre-generics workaround that Go programmers were forced into for over a decade: use `interface{}` to accept "anything." It fails on two counts. First, you cannot apply operators like `>` to an `interface{}` value, so the comparison does not even compile. Second, even if you replaced the comparison with reflection, every caller would receive an `interface{}` back and would have to perform a type assertion like `biggest.(int)` — which panics at runtime if the dynamic type is anything else. You have thrown away exactly the thing a type system is supposed to give you.

The correct version replaces that lost safety with type parameters. `Map[T any, U any]` is declared once and works for `[]int → []string`, `[]int → []int`, or any other pair, with the concrete types preserved end to end. The call `Map(nums, ...)` needs no explicit type arguments because the compiler *infers* `T` and `U` from the slice and the function you pass. The `Stack[T]` type shows the same idea applied to a data structure: one definition, reused for `Stack[string]` and `Stack[int]`, with `var zero T` correctly producing `""` or `0` depending on instantiation.

Crucially, none of this involves boxing or runtime assertions. `Stack[int]` stores real `int` values; `Map[int, string]` calls your function with a real `int`. The compiler generates statically typed code, so the safety is enforced before the program ever runs.

---

## Design Tradeoff

Type parameters buy you reuse *without* sacrificing type safety — the gain that `interface{}` could never offer. But they are not free. Generic code is harder to read than a concrete function: the reader must mentally substitute types, follow constraints, and reason about inference. Compile times and binary size can grow because the compiler may specialize code per type. And error messages involving deeply parameterized types can become noisy.

The idiomatic balance is to introduce a type parameter only when the alternative genuinely costs you — when you would otherwise duplicate a function across types, or fall back to `interface{}` and lose static checking. If a plain interface (calling a method) or a single concrete type does the job, prefer it. Generics are a tool, not a default; the first question is always whether the simpler tool already suffices.

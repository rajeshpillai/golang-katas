---
id: avoiding-generic-abuse
phase: 7
phase_title: Generics (Carefully)
sequence: 5
title: Avoiding Generic Abuse
---

## Description

### Concept Overview

Having a powerful tool tempts you to use it everywhere. Generic abuse is what happens when you reach for type parameters reflexively — wrapping every function, building elaborate generic hierarchies, or parameterizing code that is only ever used with one type. The result is code that is harder to read, slower to compile, and no safer than the simple version it replaced. The Go community's guiding phrase is blunt and worth memorizing: **"generics are a tool, not a default."**

This capstone kata is about *restraint*. You already know how type parameters and constraints work and when they help. The final, and hardest, skill is knowing when *not* to use them — recognizing the over-engineered generic and rewriting it as the boring, concrete, readable Go that the situation actually calls for.

### Technical Explanation

Several anti-patterns recur. Learn to spot them.

**1. Generic-of-one.** A type parameter used at exactly one concrete type is pure overhead. If `Process[T any]` is only ever called as `Process[Order]`, delete the parameter and write `Process(o Order)`. The generic adds cognitive load and compile work while abstracting over a set of size one.

```go
// Over-engineered: T is always Order.
func Process[T any](items []T, f func(T)) { for _, x := range items { f(x) } }

// Honest: just write the concrete function.
func ProcessOrders(orders []Order, f func(Order)) { for _, o := range orders { f(o) } }
```

**2. Generics where a method-only interface suffices.** Covered in the previous kata, but it is also an *abuse* pattern: `func Save[T Storer](v T)` should be `func Save(v Storer)`. If the body only calls methods, the type parameter is noise.

**3. Premature generality.** Writing a fully generic `Pipeline[I, O any]` framework "in case we need other types later" before any second type exists. Go favors writing the concrete thing now and generalizing *only when a second real use appears*. YAGNI applies with full force to type parameters.

**4. Constraint gymnastics.** Constructing baroque constraint hierarchies — constraints embedding constraints embedding type sets — to model something an interface or a plain function expresses directly. When the constraint is harder to understand than the code it constrains, you have over-abstracted.

**5. Generic wrappers around the standard library.** Re-implementing `slices.Map`-style helpers, or wrapping `sync.Map` in a generic facade you barely use, when the standard primitive would do. Reach for `slices`, `maps`, and `cmp` before inventing parallel abstractions.

The antidote is a short checklist before adding a type parameter:

1. **Is there real duplication** that the generic removes — code identical except for the type? If no, stop.
2. **Will it be instantiated at two or more types** in practice? If no, write it concretely.
3. **Does the body do more than call methods?** If it only calls methods, use an interface instead.
4. **Is the generic version clearer than the concrete one?** If it is harder to read, the abstraction is not paying for itself.

If you cannot answer "yes" to the first two and "the generic is clearer" to the last, write the simple, concrete code. The readable, slightly-repetitive version is almost always better than the clever, prematurely-generic one.

### Design Rationale

Go's entire culture is built on the conviction that *clarity beats cleverness* and that abstractions must justify their cost. The language deliberately omits many features — inheritance, exceptions, operator overloading — precisely to keep code obvious. Generics were added late and reluctantly *because* the team feared exactly this failure mode: that the feature would be over-used and Go code would drift toward the dense, abstraction-heavy style that the language was created to avoid.

Other ecosystems show what over-use looks like. Early **C++** template metaprogramming produced libraries so abstract that error messages spanned hundreds of lines and only experts could maintain them. Some **Java** and **Scala** codebases grew towering generic type hierarchies (`<T extends Comparable<? super T>>` and worse) that obscured simple intent behind type-parameter wildcards. Go's designers watched these outcomes and chose conservative guidance on purpose. The official Go blog and proposal repeatedly stress using generics *only* when they remove genuine duplication or restore lost type safety — and otherwise preferring concrete code and interfaces.

This is not anti-generics; it is pro-judgment. A type-safe `Set[T]` or a `slices.SortFunc` is excellent generic code because it earns its abstraction. A `Generic-of-one` wrapper or a `Pipeline[I, O]` built before its second use does not. The skill Go asks of you is discrimination: deploy the tool where it pays, and resist it everywhere else. The most experienced Go programmers write *less* generic code than beginners expect, not more.

### Common Mistakes

**Adding a type parameter "to be flexible."** Flexibility you do not need is complexity you pay for now. A function used at one type should be concrete. Generalize when — and only when — a real second use arrives.

**Letting generics infect call sites.** Over-parameterized APIs push the burden onto callers, who must now reason about type arguments and constraints to use what should be a simple function. A concrete signature is often kinder to every caller.

**Confusing "could be generic" with "should be generic."** Almost any function *could* take a type parameter. The question is whether doing so removes duplication or restores safety. If neither, the answer is no.

**Building generic frameworks speculatively.** A generic pipeline, generic repository, or generic event bus written before there is a second concrete type is premature abstraction. Write the concrete version; refactor to generic only under the pressure of a real second case.

**Reinventing the standard library generically.** `slices`, `maps`, and `cmp` already provide tested generic primitives. Hand-rolling parallel versions multiplies code without adding value and risks subtle bugs the standard library has already fixed.

### Key Takeaways

- "Generics are a tool, not a default" — the burden of proof is on adding a type parameter, not on omitting one.
- A type parameter used at a single concrete type (*generic-of-one*) is pure overhead; write it concretely.
- If the body only calls methods, an interface is the right abstraction, not a type parameter.
- Resist speculative, "might need it later" generality — write concrete code and generalize only when a real second use appears.
- Before adding a type parameter, demand real duplication, two-plus instantiations, more-than-method-calls, *and* improved clarity.
- The most experienced Go programmers reach for generics rarely — readable concrete code usually wins.

---

## Broken Code

```go
// broken: generic abuse — a "flexible" framework instantiated at exactly
// one type, wrapping a body that only calls a method. Pure overhead.
package main

import "fmt"

type Notifier interface{ Notify() string }

type Email struct{ To string }

func (e Email) Notify() string { return "emailing " + e.To }

// Generic-of-one AND method-only: T is always Email, and the body just
// calls Notify(). The type parameter and constraint add nothing.
func Broadcast[T Notifier](items []T) []string {
    out := make([]string, 0, len(items))
    for _, it := range items {
        out = append(out, it.Notify())
    }
    return out
}

func main() {
    // Only ever used with Email. The generality is never exercised.
    emails := []Email{{To: "a@x.com"}, {To: "b@x.com"}}
    fmt.Println(Broadcast(emails))
}
```

---

## Correct Code

```go
// correct: drop the needless generics. Use an interface for behavior,
// and reserve a type parameter for the ONE place it genuinely pays —
// a reusable, type-safe helper instantiated at multiple real types.
package main

import (
	"fmt"
	"slices"
)

type Notifier interface{ Notify() string }

type Email struct{ To string }

func (e Email) Notify() string { return "emailing " + e.To }

type SMS struct{ Number string }

func (s SMS) Notify() string { return "texting " + s.Number }

// Behavior-only: an interface parameter, no type parameter. It also
// naturally accepts a HETEROGENEOUS slice, which a []T could not.
func Broadcast(items []Notifier) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.Notify())
	}
	return out
}

// A JUSTIFIED generic: real duplication removed, used at 2+ types,
// body does more than call methods (it relates input T to output K).
// Mirrors the spirit of standard-library helpers.
func GroupBy[T any, K comparable](xs []T, key func(T) K) map[K][]T {
	groups := make(map[K][]T)
	for _, x := range xs {
		k := key(x)
		groups[k] = append(groups[k], x)
	}
	return groups
}

func main() {
	// Interface parameter accommodates different concrete notifiers at once.
	msgs := Broadcast([]Notifier{
		Email{To: "a@x.com"},
		SMS{Number: "+15550100"},
	})
	for _, m := range msgs {
		fmt.Println(m)
	}

	// The generic helper genuinely pays off: used here at two real types.
	words := []string{"go", "rust", "ruby", "c", "crystal"}
	byInitial := GroupBy(words, func(w string) byte { return w[0] })
	letters := make([]byte, 0, len(byInitial))
	for k := range byInitial {
		letters = append(letters, k)
	}
	slices.Sort(letters)
	for _, k := range letters {
		fmt.Printf("%c: %v\n", k, byInitial[k])
	}

	nums := []int{1, 2, 3, 4, 5, 6}
	byParity := GroupBy(nums, func(n int) string {
		if n%2 == 0 {
			return "even"
		}
		return "odd"
	})
	fmt.Println("odd:", byParity["odd"], "even:", byParity["even"])
}
```

---

## Explanation

The broken version commits two abuses at once. `Broadcast[T Notifier]` is a *generic-of-one* — it is only ever instantiated with `Email` — and its body does nothing but call the `Notify()` method. Both signals point the same way: the type parameter is dead weight. It complicates the signature, adds compile-time specialization, and even *reduces* capability, because `[]T` cannot hold a mix of notifier types. The generality is paid for and never used.

The correct version fixes `Broadcast` by deleting the type parameter entirely and accepting `[]Notifier`. This is simpler to read, and as a bonus it now accepts a genuinely heterogeneous slice — an `Email` and an `SMS` together — which the generic form forbade. Behavior-only code wants an interface; the rewrite makes that explicit.

The same file then shows where a type parameter *is* justified. `GroupBy[T any, K comparable]` removes real duplication (you would otherwise write a near-identical grouping function per element/key pair), is exercised at two concrete instantiations (`string→byte` and `int→string`), and its body does more than call methods — it relates the input element type `T` to the output map keyed by `K`. That is the profile of a generic that earns its place, and it reads clearly. The contrast between the deleted `Broadcast` generic and the retained `GroupBy` generic is the whole lesson: same feature, opposite verdicts, decided by whether the abstraction pays for itself.

---

## Design Tradeoff

Every type parameter you add is a small, permanent tax on readers: they must track what it is, what its constraint promises, and how it flows through the signature. That tax is worth paying when the alternative is duplicated code or lost type safety — and a dead loss when the function is used at one type or only calls methods. The core tradeoff of this entire phase is therefore not technical but editorial: *clarity versus cleverness*, weighed case by case.

Go's culture resolves that tradeoff toward clarity, and it asks you to put the burden of proof on the abstraction. Concrete code is the default; an interface is the default for behavioral variation; a type parameter is the exception you justify with real duplication, multiple real instantiations, and improved readability. Internalizing that ordering — concrete, then interface, then generic — is what separates disciplined Go from code that merely *can* compile. Generics are a sharp tool. Used precisely, they remove duplication and harden type safety. Used reflexively, they erode the very clarity that makes Go worth writing. Choose deliberately.

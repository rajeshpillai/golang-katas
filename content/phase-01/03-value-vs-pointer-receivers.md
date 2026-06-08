---
id: value-vs-pointer-receivers
phase: 1
phase_title: Structs, Methods & Data Modeling
sequence: 3
title: Value Receivers vs Pointer Receivers
---

## Description

### Concept Overview

When you declare a method, you choose whether its receiver is a **value** (`func (c Counter)`) or a **pointer** (`func (c *Counter)`). This single character — the `*` — has profound consequences. A value receiver operates on a *copy* of the data; any changes it makes are discarded when the method returns. A pointer receiver operates on the *original* data; changes it makes persist. If you want a method to mutate the thing it is called on, you almost always need a pointer receiver.

This is the most common stumbling block when learning Go methods. A method that "increments a counter" or "deposits into an account" looks correct but does nothing, because a value receiver mutated a throwaway copy. Understanding the value/pointer receiver distinction — and the consistency rules around it — is essential to writing methods that behave the way you intend.

### Technical Explanation

**Value receiver: the method gets a copy.** Go is a pass-by-value language. When you call a method with a value receiver, the receiver value is copied into the method, exactly as a function argument would be:

```go
type Counter struct{ n int }

func (c Counter) IncBroken() { c.n++ } // mutates the COPY, lost on return

c := Counter{}
c.IncBroken()
fmt.Println(c.n) // 0 — the original was never touched
```

**Pointer receiver: the method gets the address.** With a pointer receiver, the method receives a pointer to the original value and can mutate it through that pointer:

```go
func (c *Counter) Inc() { c.n++ } // mutates the ORIGINAL

c := Counter{}
c.Inc()
fmt.Println(c.n) // 1 — the original was modified
```

Note that you still call `c.Inc()`, not `(&c).Inc()`. When `c` is an *addressable* value (a variable, a struct field, a slice element), Go automatically takes its address for a pointer-receiver call. The compiler rewrites `c.Inc()` to `(&c).Inc()` for you. The reverse also holds: if you have a pointer `p` and call a value-receiver method, Go automatically dereferences it (`(*p).Describe()`).

**Addressability matters.** The automatic `&c` rewrite only works when the receiver is addressable. A value returned from a function or a map element is *not* addressable, so calling a pointer-receiver method on it fails to compile:

```go
m := map[string]Counter{"a": {}}
m["a"].Inc() // compile error: cannot call pointer method on map element
```

The fix is to pull the value into a variable, mutate it, and store it back.

**Method sets and consistency.** A type's *method set* differs between its value and pointer forms:

| Receiver declared as | In value's method set | In pointer's method set |
|---------------------|----------------------|------------------------|
| value `(c T)`       | yes                  | yes                    |
| pointer `(c *T)`    | no                   | yes                    |

This means a `*T` has *all* methods (both value- and pointer-receiver), but a plain `T` value only has the value-receiver methods. This has a critical consequence for interfaces: if an interface requires a pointer-receiver method, only `*T` satisfies it, never `T`. Mixing receiver kinds on the same type can therefore cause confusing "T does not implement Interface" errors.

**The idiomatic rule:** be consistent. Choose one receiver kind for *all* methods on a type. If any method needs a pointer receiver (because it mutates, or because the struct is large), use pointer receivers for *every* method on that type, even read-only ones. This keeps the method set uniform and avoids surprises.

**When to use which:**

- **Pointer receiver** when the method mutates the receiver, when the struct is large (avoid copying), or when the type contains a field that must not be copied (like `sync.Mutex`).
- **Value receiver** for small, immutable-by-design value types where copying is cheap and you want value semantics (e.g., `time.Time`, small coordinate structs).

### Design Rationale

Go's pass-by-value foundation is the root of this design. Unlike Java, where every object is a reference and method calls always operate on the original, Go copies values by default and makes you opt into reference behavior with an explicit pointer. This is the same philosophy as the rest of the language: be explicit about whether you are sharing or copying.

**Java** has no value/pointer distinction for objects — `obj.mutate()` always mutates the original because `obj` is a reference. Java hides the indirection; Go surfaces it. The cost in Java is that you can never get true value semantics for objects without manual cloning; the benefit in Go is that you always know, from the receiver declaration, whether a method can change your data.

**C++** offers the full spectrum — pass by value, by reference (`&`), by pointer (`*`), and `const` variants — but the complexity is high and the rules around copy constructors and references are intricate. Go collapses this to two choices (value or pointer receiver) with automatic address-taking and dereferencing to smooth over the syntax.

**C** has only pass-by-value and manual pointers, with no automatic address-taking; you write `inc(&c)` explicitly. Go keeps C's value semantics but adds the convenience of `c.Inc()` auto-rewriting to `(&c).Inc()`.

The design forces a useful question at method-definition time: *does this operation change the data?* The answer is encoded in the receiver, visible to every reader.

### Common Mistakes

**Mutating through a value receiver and wondering why nothing changes.** This is the canonical bug. `func (c Counter) Inc() { c.n++ }` increments a copy; the original is untouched. The symptom is a method that "does nothing." The fix is a pointer receiver: `func (c *Counter) Inc()`. Always use a pointer receiver when the method must persist changes.

**Mixing value and pointer receivers on the same type.** This produces an inconsistent method set and leads to interface-satisfaction errors that are hard to diagnose. The linter `go vet` and tools like `staticcheck` flag this. Pick one receiver kind per type.

**Calling a pointer-receiver method on an unaddressable value.** Map elements and function return values are not addressable, so `m["k"].Inc()` is a compile error. Copy into a local variable, mutate, and reassign.

**Copying a struct that contains a `sync.Mutex` (or other no-copy type).** A value receiver on such a type copies the mutex, breaking its locking guarantees. `go vet` warns: "passes lock by value." Types embedding a mutex must use pointer receivers everywhere.

**Assuming value receivers are always slower or always faster.** A value receiver copies the struct on every call. For tiny structs this is negligible (and may even avoid a heap allocation); for large structs it is wasteful. Conversely, a pointer receiver may force the value to escape to the heap. The right choice depends on size and mutation needs, not a blanket rule — though *consistency* within a type still wins.

### Key Takeaways

- A value receiver operates on a copy; mutations are lost. A pointer receiver operates on the original; mutations persist.
- Use a pointer receiver when the method mutates the receiver, when the struct is large, or when it contains a non-copyable field like `sync.Mutex`.
- Go auto-takes the address (`c.Inc()` → `(&c).Inc()`) for addressable values, and auto-dereferences pointers for value-receiver calls.
- Pointer-receiver methods cannot be called on unaddressable values such as map elements or function return values.
- A `*T` has all methods; a `T` value has only value-receiver methods — this governs which interfaces each form satisfies.
- Be consistent: choose one receiver kind for all methods on a type to keep the method set uniform.

---

## Broken Code

```go
// broken: value receivers mutate a copy, so the changes vanish.
package main

import "fmt"

type Account struct {
    Owner   string
    Balance int
}

// Value receiver: operates on a COPY of the Account.
// The increment is applied to the copy and discarded on return.
func (a Account) Deposit(amount int) {
    a.Balance += amount // mutates the throwaway copy
}

// Also a value receiver, same problem.
func (a Account) Withdraw(amount int) {
    a.Balance -= amount
}

func main() {
    acc := Account{Owner: "Ada", Balance: 100}

    acc.Deposit(50)
    acc.Withdraw(30)

    // Expected 120, but prints 100 — the original was never changed.
    fmt.Println("balance:", acc.Balance)
}
```

---

## Correct Code

```go
// correct: pointer receivers mutate the original; receiver kind is
// consistent across all methods on the type.
package main

import "fmt"

type Account struct {
    Owner   string
    Balance int
}

// Pointer receiver: mutates the original Account.
func (a *Account) Deposit(amount int) {
    a.Balance += amount
}

// Pointer receiver: returns an error instead of allowing an overdraft.
func (a *Account) Withdraw(amount int) error {
    if amount > a.Balance {
        return fmt.Errorf("insufficient funds: have %d, need %d", a.Balance, amount)
    }
    a.Balance -= amount
    return nil
}

// Read-only method, but still a pointer receiver for CONSISTENCY:
// once any method needs a pointer receiver, all of them use one.
func (a *Account) Describe() string {
    return fmt.Sprintf("%s: %d", a.Owner, a.Balance)
}

func main() {
    acc := Account{Owner: "Ada", Balance: 100}

    // acc is addressable, so Go rewrites acc.Deposit(...) as
    // (&acc).Deposit(...) automatically.
    acc.Deposit(50)

    if err := acc.Withdraw(30); err != nil {
        fmt.Println("withdraw failed:", err)
    }

    // This withdrawal should fail and leave the balance unchanged.
    if err := acc.Withdraw(1000); err != nil {
        fmt.Println("withdraw failed:", err)
    }

    fmt.Println(acc.Describe()) // Ada: 120
}
```

---

## Explanation

The broken version declares `Deposit` and `Withdraw` with value receivers. Because Go passes the receiver by value, each call copies the entire `Account`, runs the arithmetic on that copy, and throws the copy away when the method returns. The original `acc` is never modified, so after depositing 50 and withdrawing 30, the balance is still 100. The code compiles and runs without complaint — the bug is purely semantic, which makes it especially confusing for newcomers.

The correct version switches to pointer receivers (`func (a *Account)`). Now each method receives the address of the original `acc`, and `a.Balance += amount` modifies the real data. Notice the call sites are unchanged: we still write `acc.Deposit(50)`, because `acc` is an addressable variable and Go automatically rewrites the call to `(&acc).Deposit(50)`. The `Withdraw` method also demonstrates idiomatic error handling — it returns an `error` rather than silently allowing an overdraft, and the caller checks it explicitly.

Critically, `Describe` is read-only and could technically use a value receiver, but it is declared with a pointer receiver anyway. This enforces the consistency rule: once any method on `Account` needs a pointer receiver, all methods use pointer receivers, keeping the method set uniform and avoiding interface-satisfaction surprises later.

---

## Design Tradeoff

The value/pointer receiver choice exposes Go's pass-by-value foundation directly to the programmer. The benefit is explicitness: every method declaration announces whether it can mutate its receiver, and every reader can see at a glance whether `acc.Deposit(50)` might change `acc`. Pointer receivers also let you avoid copying large structs and protect non-copyable fields like mutexes, while value receivers give you genuine value semantics — immutability by copy — for small types where that is desirable.

The trade is a real footgun for beginners and an extra decision for everyone. A value receiver on a method meant to mutate silently does nothing, with no compiler error to catch it. Addressability rules mean pointer-receiver methods cannot be called on map elements or function results without an intermediate variable. And the difference in method sets between `T` and `*T` can surface as cryptic interface errors. Go mitigates the friction with automatic address-taking and dereferencing, and the community mitigates the confusion with a firm convention — pick one receiver kind per type and stay consistent — but the underlying tension between copy semantics and shared mutation is something the programmer must consciously manage.

---
id: structs-and-field-visibility
phase: 1
phase_title: Structs, Methods & Data Modeling
sequence: 1
title: Structs and Field Visibility
---

## Description

### Concept Overview

A struct is Go's primary tool for modeling data. It is a composite type that groups together a fixed set of named fields, each with its own type, into a single coherent unit. If you want to represent a user, an order, a configuration, or a network packet, you reach for a struct. Go has no classes — the struct is the foundation on which all data modeling is built.

What makes Go's struct design distinctive is how it handles **visibility**. There is no `public`, `private`, or `protected` keyword. Instead, visibility is determined by a single, simple rule: **the case of the first letter of an identifier**. A field (or function, type, method, or variable) whose name begins with an uppercase letter is **exported** — visible to code in other packages. A field whose name begins with a lowercase letter is **unexported** — visible only within its own package. This rule is enforced by the compiler, and it applies uniformly across the entire language.

### Technical Explanation

**Declaring a struct** uses the `type` keyword to give the struct a name, followed by the `struct` keyword and a brace-delimited list of fields:

```go
type User struct {
    ID       int       // exported: starts with uppercase
    Name     string    // exported
    email    string    // unexported: starts with lowercase
    passwordHash string // unexported
}
```

**Creating struct values** can be done several ways. The zero value of a struct has every field set to its own zero value — no constructor is required:

```go
var u User                       // all fields zero-valued
u2 := User{}                     // same thing, empty composite literal
u3 := User{ID: 1, Name: "Ada"}  // keyed literal (preferred)
u4 := User{1, "Ada", "a@x.io", "h"} // positional literal (fragile)
```

The **keyed literal** form (`User{ID: 1, Name: "Ada"}`) is strongly preferred. It is readable, it lets you omit fields (they take their zero value), and it survives field reordering or additions to the struct without silently breaking. The positional form requires every field in exact declaration order and breaks the moment the struct definition changes.

**The visibility rule in detail.** Go decides export status from the identifier's first rune using Unicode case:

| Identifier | First letter | Visibility |
|-----------|-------------|------------|
| `Name`    | uppercase   | exported (other packages can access) |
| `email`   | lowercase   | unexported (package-private) |
| `ID`      | uppercase   | exported |
| `_id`     | underscore  | unexported (not a letter, treated as unexported) |

This rule is total. It applies to struct fields, struct type names, functions, methods, constants, and package-level variables. There is no finer-grained control — Go deliberately offers only two levels: package-private and package-public. There is no class-private, no friend, no protected.

**Why the package is the unit of encapsulation.** In Go, the boundary that matters is the *package*, not the type. Two types in the *same* package can freely access each other's unexported fields. Encapsulation protects against *other packages*, not against other code in the same package. This is a different mental model from Java or C++, where `private` hides a field even from other classes in the same file.

```go
// Within the same package, this is legal:
func reset(u *User) {
    u.email = ""        // accessing an unexported field — fine, same package
    u.passwordHash = "" // also fine
}
```

**Struct tags** are string literals attached to fields, used by reflection-based libraries (JSON, databases, validation) to control how a field is serialized:

```go
type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    email string `json:"-"` // unexported AND excluded from JSON
}
```

Note: encoding packages like `encoding/json` can only see *exported* fields via reflection. An unexported field will never be marshaled, regardless of its tag — its data is invisible outside the package.

### Design Rationale

Go's case-based visibility is one of its most opinionated decisions, and it pays dividends in readability.

**Java and C++** use explicit access modifiers (`public`, `private`, `protected`) plus a class boundary. This gives fine-grained control but requires you to read the modifier to know visibility, and it scatters the information: a field's visibility is one token, its name is another. C++ adds `friend` declarations; Java adds package-private-by-default and `protected`. The result is a matrix of access rules that programmers must memorize.

**Python** has no real enforcement at all. The convention is a leading underscore (`_field`) to signal "private," and name-mangling with double underscores (`__field`), but nothing stops external code from accessing anything. Encapsulation is a gentleman's agreement.

**JavaScript** only recently gained true private fields with the `#` prefix (`#field`); before that, privacy was achieved through closures or naming conventions, with no language enforcement.

Go folds visibility into the identifier itself. When you read `u.Name`, you *know* it is exported. When you read `u.email`, you *know* it is package-private. You never consult a separate declaration. This means the visibility of every identifier is visible at every use site, not just at the definition. The cost is that renaming a field to change its visibility (e.g., `name` to `Name`) requires touching every reference — but Go's tooling (`gopls`, `gorename`) handles this, and the gain in local readability is substantial.

### Common Mistakes

**Expecting unexported fields to serialize to JSON.** A field like `email string` will silently be omitted from `json.Marshal` output, because the `encoding/json` package uses reflection and reflection cannot read unexported fields. Beginners spend hours debugging "missing" JSON fields that are simply lowercase. The fix: capitalize the field (`Email`) and use a struct tag if you want a different JSON key: `Email string \`json:"email"\``.

**Thinking unexported means "private to the type."** Unexported means private to the *package*. Any function or type in the same package can read and write an unexported field. If you came from Java expecting `private` to hide a field from a sibling type, Go will surprise you — there is no within-package privacy.

**Using positional struct literals in long-lived code.** Writing `User{1, "Ada", "a@x.io", "h"}` compiles today, but the moment someone adds, removes, or reorders a field, your literal either fails to compile (best case) or silently assigns the wrong values (if types still line up). Always use keyed literals for anything beyond throwaway code.

**Comparing structs that contain incomparable fields.** Structs are comparable with `==` *only if* all their fields are comparable. A struct containing a slice, map, or function field is not comparable, and `==` on it is a compile error. Beginners assume all structs support `==` because simple ones do.

**Confusing the zero value with "uninitialized."** A zero-valued struct is fully valid and usable — every field holds its type's zero value. There is no garbage and no null-struct. `var u User` gives you a real `User` with `ID == 0`, `Name == ""`, etc.

### Key Takeaways

- A struct groups named, typed fields into one composite value — it is Go's core data-modeling tool, and Go has no classes.
- Visibility is determined by the first letter's case: uppercase is exported (cross-package), lowercase is unexported (package-private).
- Encapsulation in Go is scoped to the *package*, not the individual type — same-package code sees all unexported fields.
- Only exported fields can be serialized by reflection-based packages like `encoding/json`.
- Prefer keyed struct literals (`User{ID: 1}`) over positional ones — they are readable and robust to field changes.
- The zero value of a struct is always valid: every field holds its own zero value, no constructor required.

---

## Broken Code

```go
// broken: unexported fields silently vanish from JSON output
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    ID    int
    name  string // unexported: JSON cannot see it
    email string // unexported: JSON cannot see it
}

func main() {
    u := User{ID: 1, name: "Ada", email: "ada@x.io"}

    data, err := json.Marshal(u)
    if err != nil {
        fmt.Println("marshal error:", err)
        return
    }

    // Expected: {"ID":1,"name":"Ada","email":"ada@x.io"}
    // Actual:   {"ID":1}
    // The lowercase fields are invisible to encoding/json.
    fmt.Println(string(data))
}
```

---

## Correct Code

```go
// correct: exported fields with tags serialize as intended
package main

import (
    "encoding/json"
    "fmt"
)

// User models an application user.
// Exported fields (uppercase) are visible to other packages and to
// reflection-based encoders. Struct tags control the JSON key names.
type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
    // passwordHash stays unexported on purpose: it is package-private
    // and is deliberately excluded from any serialized form.
    passwordHash string
}

func main() {
    // Keyed literal: readable and robust to field reordering.
    u := User{
        ID:           1,
        Name:         "Ada",
        Email:        "ada@x.io",
        passwordHash: "not-serialized",
    }

    data, err := json.Marshal(u)
    if err != nil {
        fmt.Println("marshal error:", err)
        return
    }
    fmt.Println("JSON:", string(data))

    // The zero value of a struct is fully valid and usable.
    var empty User
    fmt.Printf("zero value: %+v\n", empty)

    // Same-package code can freely read the unexported field.
    fmt.Println("internal hash:", u.passwordHash)
}
```

---

## Explanation

The broken version declares `name` and `email` with lowercase first letters, making them unexported. When `json.Marshal` walks the struct via reflection, it can only see exported (uppercase) fields — the Go reflection API refuses to read unexported fields for safety and encapsulation reasons. The result is that `name` and `email` are silently dropped from the output. There is no error, no warning; the data simply disappears. This is one of the most common early Go bugs, and the symptom ("my JSON is missing fields") gives no hint that the cause is letter casing.

The correct version capitalizes the serializable fields to `Name` and `Email`, making them exported, and adds `json:"..."` struct tags so the JSON keys can still be lowercase. This separates two distinct concerns: *Go-level visibility* (controlled by case) and *wire-format naming* (controlled by tags). The `passwordHash` field stays unexported deliberately — it carries sensitive data we never want serialized, and unexported is both the access control and the serialization exclusion in one stroke.

The correct version also shows that the zero value of a struct (`var empty User`) is immediately valid, and that same-package code can read `u.passwordHash` freely, demonstrating that encapsulation in Go is a package boundary, not a type boundary.

---

## Design Tradeoff

By tying visibility to identifier case, Go makes every field's access level visible at every use site — you never look up a separate `private` declaration to know whether `u.Email` is reachable from another package. This is a strong readability win, and it keeps the language small: there are exactly two visibility levels and zero keywords devoted to them.

The cost is granularity and friction. There is no per-type privacy, no `protected`, and no `friend` — if a field needs to be visible to other packages, you make it exported, and then *everyone* can touch it. To regain control, idiomatic Go keeps fields unexported and exposes behavior through exported methods and constructor functions, letting the package enforce invariants. Changing a field's visibility also means renaming it everywhere it appears, which couples the visibility decision to the field's name. In practice this is a deliberate trade: Go accepts coarser, package-scoped encapsulation in exchange for visibility that is always self-evident in the code you are reading.

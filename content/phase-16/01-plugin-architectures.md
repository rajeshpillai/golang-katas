---
id: plugin-architectures
phase: 16
phase_title: Advanced Systems Patterns
sequence: 1
title: Plugin-Like Architectures
---

## Description

### Concept Overview

A plugin-like architecture lets a program be extended with new behavior without modifying — or even recompiling — the code that consumes that behavior. In Go, you build this not with class hierarchies or reflection-heavy frameworks, but with two small, explicit primitives: an **interface** that defines the contract every plugin must satisfy, and a **registry** that maps a name to an implementation. New plugins register themselves; the core dispatches to them by name. The core never imports the plugins directly — it only knows the interface.

This is the foundation of how Go's own standard library scales. `database/sql` has no idea what PostgreSQL is. `image` has no idea what PNG is. `encoding/json` has no idea about your structs. Each of these uses the interface-plus-registry pattern: a driver or codec implements a known interface and registers itself, usually in an `init()` function, and the core looks it up by name at runtime. Once you internalize this pattern, you can build CLIs with pluggable subcommands, ETL pipelines with pluggable transforms, and servers with pluggable auth strategies — all without a dependency-injection container in sight.

### Technical Explanation

**The contract is an interface.** You define the smallest behavior every plugin needs. Smaller is better — a one-method interface is trivial to satisfy and impossible to misuse:

```go
type Encoder interface {
    Encode(v any) ([]byte, error)
    Name() string
}
```

**The registry is a map guarded for concurrent access.** It maps a string key to an implementation. Because plugins may register from `init()` functions running in arbitrary order, and because lookups may happen from many goroutines, the registry must be safe for concurrent use:

```go
type Registry struct {
    mu       sync.RWMutex
    encoders map[string]Encoder
}

func (r *Registry) Register(e Encoder) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, exists := r.encoders[e.Name()]; exists {
        return fmt.Errorf("encoder %q already registered", e.Name())
    }
    r.encoders[e.Name()] = e
    return nil
}

func (r *Registry) Lookup(name string) (Encoder, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    e, ok := r.encoders[name]
    return e, ok
}
```

**Registration happens at startup, lookup happens at runtime.** The classic Go idiom is to register in `init()`, which runs before `main()`. A plugin package only needs to be imported — often with the blank identifier `import _ "myapp/plugins/json"` — for its `init()` to fire and register the implementation. This is the *side-effect import*, and it is how `database/sql` drivers work.

**The core depends only on the interface.** The package that consumes plugins imports the registry and the interface, never the concrete plugin packages. This inverts the dependency: plugins depend on the core's interface, the core does not depend on plugins. That is the dependency-inversion principle expressed without any framework — just package boundaries.

**Go also has a literal `plugin` package** (`.so` shared objects loaded at runtime), but it is rarely used: it only works on Linux/macOS, requires exact toolchain matching, and cannot be unloaded. Idiomatic Go "plugins" are compiled-in implementations selected at runtime via a registry. This kata teaches that approach.

### Design Rationale

Go deliberately omits a built-in dependency-injection container like Spring (Java) or the service collections of .NET. In those ecosystems, a framework scans annotations or XML, builds an object graph by reflection, and injects dependencies at runtime. The wiring is implicit and "magic" — convenient until something fails, at which point you debug a reflection-driven container instead of reading code.

Go's answer is that **wiring should be ordinary code you can read**. An interface plus a map *is* the dependency-injection container, written explicitly in twenty lines you fully understand. There is no annotation processor, no startup reflection scan, no hidden lifecycle. When you ask "which encoder runs for `\"json\"`?", the answer is a map lookup you can step through in a debugger. This trades a few lines of boilerplate for total transparency — a trade Go makes everywhere.

The registry pattern also keeps the *compile-time* dependency graph honest. Because the core never imports plugins, you can ship the core as a library and let downstream code choose which plugins to compile in. Conversely, because plugins import the core's interface, the compiler verifies at build time that every plugin actually satisfies the contract. You get late binding (choose the implementation at runtime by name) with early checking (the compiler proves each implementation is valid). Reflection-based DI frameworks give you the late binding but defer the checking to runtime, where a missing implementation becomes a startup crash instead of a compile error.

### Common Mistakes

**Using a `package`-level global map without synchronization.** A bare `var registry = map[string]Encoder{}` written from `init()` functions and read from goroutines is a data race. Go's `init()` functions are sequential, so registration is usually safe, but the moment a lookup races with a late registration — or you add dynamic registration — the race detector fires and the map can corrupt. Wrap the map in a struct with a `sync.RWMutex`, or freeze the registry before serving traffic.

**Letting `Register` silently overwrite duplicates.** If two plugins claim the name `"json"`, a naive map write makes the last one win silently, and which one wins depends on import order. Return an error (or panic, as `sql.Register` does) on duplicate names so the conflict surfaces immediately instead of becoming a heisenbug.

**Making the interface too large.** A plugin interface with ten methods forces every implementer to stub methods they do not need, and makes the contract brittle. Keep the interface minimal — ideally one or two methods. If different plugins need different capabilities, define multiple small interfaces and type-assert for the optional ones.

**Panicking on an unknown plugin name instead of returning an error.** Lookups can fail — a user typo, a missing side-effect import, a config referencing a plugin that was not compiled in. Return `(value, false)` or an error so the caller can produce a helpful message ("unknown encoder %q; available: %v") rather than crashing.

**Hiding the registry behind reflection or code generation prematurely.** It is tempting to "automate" registration with `go:generate` or reflection over struct tags. Resist it until the explicit version genuinely hurts. The explicit `Register` call is readable and greppable; the clever version is neither.

### Key Takeaways

- A plugin architecture in Go is an **interface (the contract) plus a registry (a name to implementation map)** — no framework required.
- The core depends only on the interface; plugins depend on the core. This inverts the dependency without a DI container.
- Register implementations at startup (often in `init()` via side-effect imports); look them up by name at runtime.
- Guard the registry with a `sync.RWMutex` and reject duplicate names so conflicts surface loudly.
- Keep plugin interfaces tiny — small interfaces are easy to implement and hard to misuse.
- Go gives you late binding (runtime selection) with early checking (compile-time interface satisfaction) — the best of both worlds.

---

## Broken Code

```go
// broken: a global, unsynchronized registry that silently overwrites
// duplicates and panics on unknown names. This is how plugin systems rot.
package main

import "fmt"

type Encoder interface {
    Encode(v any) string
}

// broken: bare package-level map, written from init()s and read from
// goroutines with no mutex -> data race, and last-writer-wins on conflicts.
var registry = map[string]Encoder{}

func Register(name string, e Encoder) {
    // broken: silently clobbers an existing entry; import order decides winner.
    registry[name] = e
}

func Lookup(name string) Encoder {
    // broken: panics instead of letting the caller handle "unknown plugin".
    return registry[name].(Encoder) // panics if name missing (nil assertion)
}

type jsonEnc struct{}

func (jsonEnc) Encode(v any) string { return fmt.Sprintf("json:%v", v) }

func main() {
    Register("json", jsonEnc{})
    Register("json", jsonEnc{}) // duplicate goes unnoticed

    enc := Lookup("xml") // not registered -> panic at runtime
    fmt.Println(enc.Encode(42))
}
```

---

## Correct Code

```go
// correct: an explicit, concurrency-safe registry with a small interface,
// duplicate detection, and graceful unknown-name handling. Two plugins
// register themselves, then the core dispatches by name.
package main

import (
    "fmt"
    "sort"
    "strings"
    "sync"
)

// Encoder is the plugin contract: small, so it is easy to satisfy.
type Encoder interface {
    Name() string
    Encode(v any) (string, error)
}

// Registry maps a name to an Encoder and is safe for concurrent use.
type Registry struct {
    mu       sync.RWMutex
    encoders map[string]Encoder
}

func NewRegistry() *Registry {
    return &Registry{encoders: make(map[string]Encoder)}
}

// Register adds an encoder, rejecting duplicate names loudly.
func (r *Registry) Register(e Encoder) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    name := e.Name()
    if _, exists := r.encoders[name]; exists {
        return fmt.Errorf("encoder %q already registered", name)
    }
    r.encoders[name] = e
    return nil
}

// Lookup returns an encoder and a helpful error if the name is unknown.
func (r *Registry) Lookup(name string) (Encoder, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    e, ok := r.encoders[name]
    if !ok {
        return nil, fmt.Errorf("unknown encoder %q; available: %s",
            name, strings.Join(r.namesLocked(), ", "))
    }
    return e, nil
}

func (r *Registry) namesLocked() []string {
    names := make([]string, 0, len(r.encoders))
    for n := range r.encoders {
        names = append(names, n)
    }
    sort.Strings(names)
    return names
}

// --- Plugin implementations: each depends only on the Encoder interface. ---

type jsonEncoder struct{}

func (jsonEncoder) Name() string { return "json" }
func (jsonEncoder) Encode(v any) (string, error) {
    return fmt.Sprintf(`{"value":%q}`, fmt.Sprint(v)), nil
}

type csvEncoder struct{}

func (csvEncoder) Name() string { return "csv" }
func (csvEncoder) Encode(v any) (string, error) {
    return fmt.Sprintf("value\n%v", v), nil
}

func main() {
    reg := NewRegistry()

    // Registration: in a real app these calls live in plugin init() funcs.
    for _, e := range []Encoder{jsonEncoder{}, csvEncoder{}} {
        if err := reg.Register(e); err != nil {
            fmt.Println("registration failed:", err)
            return
        }
    }

    // A duplicate registration is rejected, not silently ignored.
    if err := reg.Register(jsonEncoder{}); err != nil {
        fmt.Println("expected duplicate rejected:", err)
    }

    // Dispatch by name — the core never imported the concrete types directly.
    for _, name := range []string{"json", "csv", "xml"} {
        enc, err := reg.Lookup(name)
        if err != nil {
            fmt.Println("lookup error:", err)
            continue
        }
        out, err := enc.Encode("hello")
        if err != nil {
            fmt.Printf("encode via %s failed: %v\n", name, err)
            continue
        }
        fmt.Printf("[%s] %s\n", enc.Name(), out)
    }
}
```

---

## Explanation

The broken version commits the three classic sins of a homegrown plugin system. First, its registry is a bare package-level map written from registration and read from lookups with no synchronization — fine while everything is sequential, but a data race the instant registration and lookup overlap across goroutines, which the race detector will flag and which can corrupt the map. Second, `Register` silently overwrites duplicates, so two plugins claiming `"json"` produce a result that depends on import order — a non-deterministic bug that is brutal to track down. Third, `Lookup` type-asserts a missing entry and panics, turning a recoverable "unknown plugin" condition into a crash.

The correct version makes all three concerns explicit. The map lives inside a `Registry` struct behind a `sync.RWMutex`, so concurrent lookups are cheap (read lock) while registration is exclusive (write lock). `Register` checks for an existing name and returns a descriptive error, so a duplicate surfaces immediately. `Lookup` returns `(Encoder, error)` and, on a miss, lists the names that *are* available — the difference between a five-second fix and an hour of confusion. Crucially, `main` dispatches purely through the `Encoder` interface and the registry; it never needs to know that `jsonEncoder` and `csvEncoder` exist as concrete types. New encoders can be added by writing a type that satisfies `Encoder` and calling `Register`, with no change to the dispatch loop.

This is the entire pattern, in-process and self-contained, but it scales directly to real systems. Move each encoder into its own package, register from each package's `init()`, and pull them in with side-effect imports. The dispatch code does not change. That stability — the core staying fixed while implementations multiply — is the whole point.

---

## Design Tradeoff

The explicit registry trades a little boilerplate for complete transparency. A reflection-driven DI container would let you skip the `Register` calls entirely; the framework would discover implementations by scanning annotations or assemblies at startup. That feels like less code, but it relocates the wiring into a framework you cannot read and a startup phase you cannot step through. When an implementation goes missing, you debug the container's reflection logic instead of reading a `Register` call that is right there in the source.

Go's bet is that **wiring is too important to hide**. By making registration ordinary code — a map, a mutex, a function call — Go keeps the dependency graph greppable and the failure modes obvious. The cost is real: you write the registry yourself and you add a registration call per plugin. But you also get compile-time proof that every plugin satisfies the contract, runtime errors instead of reflection panics, and a dependency graph you can reason about by reading import statements. For long-lived systems maintained by rotating teams, that readability compounds, and the boilerplate is a rounding error.

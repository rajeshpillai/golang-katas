---
id: dependency-management
phase: 16
phase_title: Advanced Systems Patterns
sequence: 4
title: Dependency Management
---

## Description

### Concept Overview

Dependency management has two distinct meanings, and a professional Go engineer must master both. The first is **external dependency management**: how Go modules track third-party packages, pin their versions, and verify their integrity through `go.mod` and `go.sum`. The second is **internal dependency management**: how the components *inside* your program depend on one another, and how you wire them together so that high-level code depends on abstractions rather than concrete implementations. Go handles the first with the module system and the second with interfaces and explicit constructor wiring — no dependency-injection framework required.

These two ideas reinforce each other. The module system makes your *external* dependency graph reproducible and auditable: anyone can clone your repository and build the exact same binary, byte-for-byte, with cryptographic guarantees. Interface-based injection makes your *internal* dependency graph flexible and testable: a service depends on a `Store` interface, not a concrete Postgres type, so you can substitute a fake in tests and a real database in production without changing the service. This kata covers both, because "managing dependencies" in a production Go service means both keeping your supply chain honest and keeping your object graph loosely coupled.

### Technical Explanation

**Modules and `go.mod`.** A module is a tree of packages with a `go.mod` file at its root. The file declares the module path, the Go version, and the required dependencies with their minimum versions:

```
module github.com/acme/orders

go 1.21

require (
    github.com/some/lib v1.4.2
    golang.org/x/sync v0.5.0
)
```

`go get` adds or upgrades a dependency; `go mod tidy` prunes unused requirements and adds missing ones so `go.mod` exactly matches what your code imports.

**`go.sum` and integrity.** For every module version your build uses, `go.sum` records a cryptographic hash of its content and of its `go.mod`. On every build, Go verifies that the downloaded module matches the recorded hash, so a tampered or swapped dependency fails the build. Combined with the checksum database (`sum.golang.org`), this makes Go's supply chain verifiable by default. Commit both `go.mod` and `go.sum`.

**Semantic import versioning.** Go encodes major versions in the *import path*. `v0` and `v1` use the bare path (`github.com/acme/lib`), but `v2` and beyond append the major version (`github.com/acme/lib/v2`). This is deliberate: two incompatible major versions are *different packages* and can coexist in one build, so a transitive upgrade cannot silently break you. Minimal version selection then picks the lowest version that satisfies all requirements, making builds reproducible without a lockfile-resolver dance.

**Internal dependencies: depend on interfaces.** Inside your program, high-level components should depend on small interfaces they define, not on concrete types from lower layers:

```go
// Defined by the consumer, satisfied by any store.
type OrderStore interface {
    Save(o Order) error
    Get(id string) (Order, error)
}

type OrderService struct{ store OrderStore } // depends on the interface
```

**Constructor injection wires the graph.** Dependencies are passed in explicitly through constructors, usually assembled once in `main`:

```go
func NewOrderService(s OrderStore) *OrderService { return &OrderService{store: s} }

// in main:
store := newPostgresStore(db)          // concrete, low-level
svc := NewOrderService(store)          // inject it
```

In tests you inject a fake that satisfies `OrderStore`, with no database and no mocking framework — just a struct.

### Design Rationale

Go's module system was designed to make builds **reproducible and verifiable** without a separate lockfile tool or a central package registry that can rewrite history. `go.mod` records intent (minimum versions), `go.sum` records integrity (content hashes), and minimal version selection makes resolution deterministic: given the same `go.mod`, every machine selects the same versions. Contrast this with ecosystems where a `^1.2.0` range can resolve to a different patch on every install, or where a published version can be mutated or unpublished out from under you. Go chose determinism and supply-chain integrity as defaults, not opt-ins.

Semantic import versioning — putting `/v2` in the path — is the most distinctive choice. It rejects the idea that a single import name can mean two incompatible things at different times. By making major versions different packages, Go guarantees that upgrading one dependency can never silently change the behavior of another that pinned an older major. It is verbose, but it eliminates "diamond dependency" breakage at the language level rather than papering over it in a resolver.

For *internal* dependencies, Go's rejection of DI frameworks is philosophical. Spring (Java) and .NET's service container build your object graph at runtime by reflection over annotations, resolving constructors and lifetimes through a framework you cannot read. Go's position is that **the object graph is just constructor calls in `main`**, and that wiring is too important to hide. You assemble dependencies explicitly: create the store, pass it to the service, pass the service to the handler. The "container" is the `main` function. This makes the entire dependency graph greppable, the failure modes compile-time, and the tests trivial — you inject a fake by calling the same constructor with a different argument. There is no runtime resolution to debug because there is no runtime resolution at all.

### Common Mistakes

**Not committing `go.sum` (or `go.mod`).** Without `go.sum`, builds are no longer integrity-verified — a swapped or tampered dependency can slip in unnoticed. Without `go.mod`, the build is not reproducible at all. Both files belong in version control; treat a diff to them in code review as seriously as a code change.

**Skipping `go mod tidy`.** Over time `go.mod` accumulates dependencies you no longer import and drifts from dependencies you added without recording. `go mod tidy` reconciles `go.mod`/`go.sum` with the actual imports. A `go.mod` that does not match the code is a reproducibility and audit hazard.

**Ignoring semantic import versioning for `v2+`.** Importing `github.com/acme/lib` when you mean `v2` either fails or silently pulls `v1`. For any module at major version 2 or higher, the major must appear in the import path (`.../lib/v2`). Forgetting this leads to confusing version-mismatch errors.

**Depending on concrete types instead of interfaces across layers.** If `OrderService` embeds a `*PostgresStore` directly, you cannot test it without a real database, and swapping the storage backend means editing the service. Define a narrow interface owned by the consumer and depend on that; the concrete type is chosen once, in `main`.

**Defining the interface in the implementation package.** In Go, the *consumer* should declare the interface it needs (small, specific to its use), not the producer. A producer-defined "fat" interface forces consumers to depend on methods they do not use and couples everyone to the producer's package. Keep interfaces where they are consumed.

### Key Takeaways

- `go.mod` declares your module and its required dependency versions; `go.sum` records content hashes so every build is **integrity-verified**. Commit both.
- Run `go mod tidy` to keep `go.mod`/`go.sum` exactly matching your imports — a drifted module file undermines reproducibility and audits.
- **Semantic import versioning** puts the major version in the import path (`.../v2`), so incompatible majors are different packages that can coexist — no silent breakage.
- For internal dependencies, **depend on small interfaces, not concrete types**, so components are testable and swappable.
- Wire the object graph **explicitly with constructors in `main`** — the `main` function is your dependency-injection container.
- Let the **consumer define the interface** it needs; do not accept fat interfaces from producer packages.

---

## Broken Code

```go
// broken: high-level service depends on a concrete, low-level store with a
// hardcoded connection, making it untestable and impossible to swap. This is
// the internal-dependency anti-pattern that DI-via-interfaces fixes.
package main

import "fmt"

type Order struct {
    ID    string
    Total int
}

// broken: a concrete store with a baked-in "connection". The service below
// will reach for this type directly.
type PostgresStore struct {
    dsn string
}

func (p *PostgresStore) Save(o Order) error {
    fmt.Printf("[postgres %s] saved %s\n", p.dsn, o.ID)
    return nil
}

// broken: OrderService depends on *PostgresStore, the concrete type, and even
// constructs it itself with a hardcoded DSN. You cannot test this without a
// real database, and switching stores means editing the service.
type OrderService struct {
    store *PostgresStore
}

func NewOrderService() *OrderService {
    return &OrderService{store: &PostgresStore{dsn: "host=prod-db"}}
}

func (s *OrderService) Place(o Order) error {
    return s.store.Save(o)
}

func main() {
    svc := NewOrderService() // glued to Postgres; no seam for a fake
    svc.Place(Order{ID: "A-1", Total: 99})
}
```

---

## Correct Code

```go
// correct: the service depends on a narrow, consumer-defined interface, and
// the concrete store is injected via a constructor and wired once in main.
// A fake store satisfies the same interface with no database and no framework.
package main

import (
    "errors"
    "fmt"
)

type Order struct {
    ID    string
    Total int
}

var errNotFound = errors.New("order not found")

// OrderStore is defined by the CONSUMER (this package) and is intentionally
// small — only the methods OrderService actually uses.
type OrderStore interface {
    Save(o Order) error
    Get(id string) (Order, error)
}

// OrderService depends on the interface, never a concrete store.
type OrderService struct {
    store OrderStore
}

// Constructor injection: the dependency is passed in, not constructed inside.
func NewOrderService(store OrderStore) *OrderService {
    return &OrderService{store: store}
}

func (s *OrderService) Place(o Order) error {
    if o.Total <= 0 {
        return fmt.Errorf("order %s: total must be positive, got %d", o.ID, o.Total)
    }
    return s.store.Save(o)
}

func (s *OrderService) Lookup(id string) (Order, error) {
    return s.store.Get(id)
}

// --- A production-style store. Stands in for a real database here. ---

type memStore struct {
    data map[string]Order
}

func newMemStore() *memStore { return &memStore{data: make(map[string]Order)} }

func (m *memStore) Save(o Order) error {
    m.data[o.ID] = o
    fmt.Printf("[store] saved %s (total=%d)\n", o.ID, o.Total)
    return nil
}

func (m *memStore) Get(id string) (Order, error) {
    o, ok := m.data[id]
    if !ok {
        return Order{}, fmt.Errorf("get %s: %w", id, errNotFound)
    }
    return o, nil
}

// --- A test fake: satisfies OrderStore with zero infrastructure. ---

type fakeStore struct {
    saved []Order
}

func (f *fakeStore) Save(o Order) error          { f.saved = append(f.saved, o); return nil }
func (f *fakeStore) Get(string) (Order, error)   { return Order{}, errNotFound }

func main() {
    // Wire the object graph explicitly in main: choose the concrete store,
    // inject it into the service. main IS the DI container.
    store := newMemStore()
    svc := NewOrderService(store)

    if err := svc.Place(Order{ID: "A-1", Total: 99}); err != nil {
        fmt.Println("place failed:", err)
    }
    if err := svc.Place(Order{ID: "A-2", Total: -5}); err != nil {
        fmt.Println("validation caught:", err)
    }

    o, err := svc.Lookup("A-1")
    if err != nil {
        fmt.Println("lookup failed:", err)
    } else {
        fmt.Printf("looked up %s (total=%d)\n", o.ID, o.Total)
    }

    if _, err := svc.Lookup("missing"); errors.Is(err, errNotFound) {
        fmt.Println("correctly reported missing order")
    }

    // The SAME service works with a fake store — no database, no mocks.
    fake := &fakeStore{}
    testSvc := NewOrderService(fake)
    _ = testSvc.Place(Order{ID: "T-1", Total: 1})
    fmt.Printf("fake captured %d order(s) for assertions\n", len(fake.saved))
}
```

---

## Explanation

The broken version wires its internal dependencies backwards. `OrderService` holds a `*PostgresStore` — the concrete, low-level type — and worse, its constructor builds that store itself with a hardcoded DSN. The high-level policy (placing orders) is welded to a low-level detail (Postgres, at a specific address). There is no seam: you cannot test `Place` without a real database, and migrating to a different store means editing the service. This is exactly the rigidity that dependency inversion exists to prevent, and it is the internal analogue of pinning yourself to an unverified, un-swappable external dependency.

The correct version inverts the dependency. `OrderService` depends on `OrderStore`, a small interface declared by the consumer with only the two methods the service actually calls. The concrete store is *injected* through `NewOrderService`, and the choice of which store to use is made exactly once, in `main` — which is the program's dependency-injection container, written as plain constructor calls you can read and step through. Because the service depends only on the interface, the same `OrderService` runs against `memStore` (standing in for a real database) and against `fakeStore` (a five-line struct for tests), with no mocking framework and no infrastructure. The fake captures saved orders in a slice so a test could assert on them directly.

On the external side, this same program is governed by `go.mod` and `go.sum` even though it imports only the standard library: `go mod tidy` would keep those files matching the imports, and any third-party dependency added later would be pinned by version in `go.mod` and integrity-checked by hash in `go.sum`. The two halves of dependency management — a verifiable external supply chain and a loosely coupled internal graph — are both visible here, and both come from explicit, readable mechanisms rather than runtime magic.

---

## Design Tradeoff

Explicit constructor injection means you write the wiring yourself: every dependency is passed by hand, and `main` grows as the object graph grows. A reflection-based DI container would assemble that graph for you from annotations, sparing you the constructor plumbing. The cost of that convenience is a runtime resolution step you cannot read, failure modes that surface as startup exceptions instead of compile errors, and tests that lean on the container instead of plain substitution. Go trades a longer `main` for a dependency graph that is greppable, compile-checked, and trivially testable — and for most services, `main` simply does not grow large enough for the trade to hurt.

On the supply-chain side, Go's `go.mod`/`go.sum` plus semantic import versioning trade some verbosity (major versions in import paths, two files to commit, occasional `go mod tidy` runs) for reproducible, integrity-verified builds with no central registry that can rewrite history. The `/v2` in an import path looks clumsy next to a plain version range, but it buys a guarantee that no other ecosystem offers for free: incompatible major versions are different packages, so a transitive upgrade can never silently break you. As with the rest of Go's design, the language pays a small, visible cost up front to eliminate a class of expensive, invisible failures later.

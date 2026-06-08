---
id: reuse-via-composition
phase: 5
phase_title: Composition over Inheritance
sequence: 3
title: Reuse via Composition
---

## Description

### Concept Overview

Composition is Go's primary answer to the question every program eventually asks: *how do I reuse behavior without duplicating it?* Instead of building a tower of base classes and subclasses, you assemble a type out of smaller, focused parts — either as **named fields** (plain composition) or as **embedded fields** (composition with promotion). You wire small, single-purpose pieces together, and you depend on **interfaces** so that any piece can be swapped for another that offers the same behavior.

The mental model is assembly, not lineage. A `Server` is not a special kind of `Logger`; it *has* a logger. A `Repository` is not a subtype of a `Cache`; it *uses* a cache. Because the parts are reached through interfaces, you can substitute a real logger for a test spy, a Postgres store for an in-memory one, or a live clock for a frozen one — all without touching the type that composes them. This is the everyday workhorse pattern of idiomatic Go, and it is what "composition over inheritance" looks like in practice.

### Technical Explanation

There are two complementary techniques, and good code mixes them deliberately.

**Named-field composition (has-a, explicit).** You hold a dependency as an ordinary named field, typically typed as an interface. Access is always qualified, which makes the dependency visible at every call site.

```go
type Logger interface {
    Log(msg string)
}

type Server struct {
    log   Logger // a dependency, reached explicitly as s.log
    addr  string
}

func (s *Server) Start() {
    s.log.Log("starting on " + s.addr)
}
```

**Embedded-field composition (has-a, promoted).** You embed a type so its methods are promoted, which is convenient when the outer type wants to *expose* the inner behavior as part of its own surface — for example, embedding `sync.Mutex` so the outer type gains `Lock`/`Unlock`, or embedding an interface to forward a whole method set.

```go
type SafeCounter struct {
    sync.Mutex // promoted Lock()/Unlock()
    n          int
}

func (c *SafeCounter) Inc() {
    c.Lock()
    defer c.Unlock()
    c.n++
}
```

**Composing interfaces.** Interfaces themselves compose by embedding, which is how the standard library builds small interfaces into larger ones:

```go
type Reader interface { Read(p []byte) (int, error) }
type Writer interface { Write(p []byte) (int, error) }

type ReadWriter interface { // composed from two smaller interfaces
    Reader
    Writer
}
```

**Constructor wiring (dependency injection).** Idiomatic Go injects dependencies through a constructor function that accepts interfaces and returns the composed type. This keeps construction explicit and makes substitution trivial:

```go
func NewServer(addr string, log Logger) *Server {
    return &Server{addr: addr, log: log}
}
```

The choice between named and embedded composition follows a simple guideline:

| Use named fields when… | Use embedding when… |
|------------------------|----------------------|
| the part is an internal collaborator | the outer type should expose the part's methods |
| you want access to read as a dependency (`s.log.Log`) | you want a thin wrapper/decorator over a method set |
| you want to keep the outer surface small | you are forwarding a whole interface (e.g. `io.ReadWriter`) |

**Decorator/wrapper pattern.** Composition shines for wrapping: embed an interface, override one method, and let the rest forward via promotion. This is how middleware, instrumented stores, and `io` wrappers are built — adding behavior without modifying or subclassing the original.

### Design Rationale

Classical inheritance couples reuse to a hierarchy. In Java or C++, to reuse a base class's behavior you must *extend* it, which permanently binds your subclass to that base, exposes you to changes in it (the fragile base class problem), and — because most languages allow only single inheritance — forces you to pick one lineage. If you later want behavior from two unrelated bases, you are stuck: you refactor, you copy code, or you reach for multiple inheritance and its diamond problem. Python eases this with mixins and an MRO, but mixins still impose an ordering you must reason about, and a mixin can silently depend on methods the final class provides.

Go decouples reuse from any hierarchy. Composition lets a type assemble exactly the parts it needs from any sources, with no inheritance graph to constrain it. Because parts are typed as interfaces, the coupling is to *behavior*, not to a concrete ancestor. Swapping a dependency is a one-line change at the construction site, not a refactor of a class tree. This is the practical realization of the Gang of Four maxim "favor composition over inheritance" — but where in Java that advice fights the grain of the language, in Go it *is* the grain.

The standard library is the proof. `io.Reader` and `io.Writer` are tiny one-method interfaces; everything larger (`io.ReadWriter`, `bufio.ReadWriter`, `http.ResponseWriter`) is composed from them. `bufio.NewReader(r io.Reader)` wraps any reader to add buffering — a decorator built by composition, working over *any* concrete type that can read. No `Reader` had to be designed in advance to be subclassed; it only had to expose a small behavioral contract. That is why composition scales in Go: small interfaces plus assembly beats large base classes plus inheritance.

### Common Mistakes

**Reaching for embedding when a named field is clearer.** Developers fresh from OO languages embed everything, recreating inheritance hierarchies in disguise. If the outer type does not want to *expose* the inner type's methods as its own, use a named field. Embedding bloats the outer type's public surface with methods that may not belong there.

**Depending on concrete types instead of interfaces.** Composing a concrete `*PostgresStore` directly into a `Service` makes the service impossible to test without a database and impossible to swap. Depend on a small interface (`Store`) and inject the concrete type at construction. This is the difference between reuse that is rigid and reuse that is flexible.

**Designing fat interfaces up front.** A 12-method interface forces every implementation and every test double to provide all 12 methods, defeating substitutability. Idiomatic Go composes large interfaces from small ones and accepts the *smallest* interface a function actually needs.

**Leaking embedded methods you did not mean to expose.** Embedding `sync.Mutex` (unexported usage but exported promotion) makes `Lock`/`Unlock` part of your type's public API — callers can now lock your internals. Prefer a named, unexported `mu sync.Mutex` field unless you deliberately want to expose locking.

**Confusing wrapping with subclassing.** A decorator that embeds an interface and overrides one method is not creating a subclass; it is forwarding. If you expect the forwarded methods to call back into your override (virtual-dispatch style), you will be disappointed — promotion forwards to the wrapped value, which knows nothing about your wrapper.

### Key Takeaways

- Composition reuses behavior by assembling small parts, via named fields (explicit dependency) or embedded fields (promoted, exposed) — never via a class hierarchy.
- Depend on small interfaces, not concrete types, so any part can be swapped (real vs. test double, in-memory vs. database).
- Inject dependencies through a constructor that takes interfaces and returns the composed type; this makes wiring explicit and substitution a one-line change.
- Use named fields for internal collaborators and embedding when the outer type should expose the inner type's methods (e.g. wrappers, forwarding an interface).
- The standard library composes large interfaces (`io.ReadWriter`) from tiny ones (`io.Reader`, `io.Writer`); follow the same "small interfaces, assemble upward" discipline.
- Embedding `sync.Mutex` and similar exposes their methods publicly — prefer an unexported named field unless you intend to publish that behavior.

### A note on error handling

The runnable example below threads errors through every fallible operation (`Save`, `Load`) and checks them at the call site rather than ignoring them — composition does not excuse skipping the failure path. Each collaborator returns an `error`, and the composing type decides how to react, which is exactly where composition and Go's explicit error model meet.

---

## Broken Code

```go
// broken: rigid reuse — the service depends on a CONCRETE store and
// builds an inheritance-style hierarchy via embedding, so it cannot be
// tested or swapped, and it silently drops errors
package main

import "fmt"

type PostgresStore struct{}

func (p PostgresStore) Save(key, val string) error {
    // pretend this opens a real DB connection...
    return nil
}

// broken: embedding a concrete store ties UserService to PostgresStore
// forever, and promotes Save into UserService's public API by accident.
type UserService struct {
    PostgresStore
}

func main() {
    svc := UserService{}

    // broken: error is ignored, and there is no way to substitute a
    // fake store for testing because the concrete type is baked in.
    svc.Save("user:1", "alice")

    fmt.Println("saved")
}
```

---

## Correct Code

```go
// correct: reuse via composition against small interfaces, with
// explicit injection, explicit access, and explicit error handling
package main

import (
    "errors"
    "fmt"
)

// Store is the smallest behavior UserService needs. Any concrete store
// that satisfies it can be injected.
type Store interface {
    Save(key, val string) error
    Load(key string) (string, error)
}

// MemoryStore is one implementation — perfect for tests and demos.
type MemoryStore struct {
    data map[string]string
}

func NewMemoryStore() *MemoryStore {
    return &MemoryStore{data: make(map[string]string)}
}

func (m *MemoryStore) Save(key, val string) error {
    if key == "" {
        return errors.New("memory store: empty key")
    }
    m.data[key] = val
    return nil
}

func (m *MemoryStore) Load(key string) (string, error) {
    val, ok := m.data[key]
    if !ok {
        return "", fmt.Errorf("memory store: key %q not found", key)
    }
    return val, nil
}

// Logger is a second small collaborator, injected the same way.
type Logger interface {
    Log(msg string)
}

type PrefixLogger struct {
    prefix string
}

func (l PrefixLogger) Log(msg string) {
    fmt.Printf("[%s] %s\n", l.prefix, msg)
}

// UserService COMPOSES its collaborators as named interface fields.
// It is not a subtype of any of them — it uses them.
type UserService struct {
    store Store
    log   Logger
}

func NewUserService(store Store, log Logger) *UserService {
    return &UserService{store: store, log: log}
}

func (s *UserService) Register(id, name string) error {
    if err := s.store.Save("user:"+id, name); err != nil {
        return fmt.Errorf("register %s: %w", id, err)
    }
    s.log.Log("registered user " + id)
    return nil
}

func (s *UserService) Name(id string) (string, error) {
    name, err := s.store.Load("user:" + id)
    if err != nil {
        return "", fmt.Errorf("lookup %s: %w", id, err)
    }
    return name, nil
}

func main() {
    // Wiring happens once, explicitly, at construction. Swapping the
    // store or logger here is the only change needed to reconfigure.
    svc := NewUserService(NewMemoryStore(), PrefixLogger{prefix: "svc"})

    if err := svc.Register("1", "alice"); err != nil {
        fmt.Println("error:", err)
        return
    }

    name, err := svc.Name("1")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("loaded name:", name)

    // The failure path is real and checked, not skipped.
    if _, err := svc.Name("999"); err != nil {
        fmt.Println("expected miss:", err)
    }
}
```

---

## Explanation

The broken version reuses a store the wrong way. By embedding the concrete `PostgresStore`, `UserService` becomes permanently bound to that one implementation — there is no seam to substitute a fake, so the service cannot be unit-tested without a real database. The embedding also leaks `Save` into `UserService`'s public surface as a promoted method, exposing storage internals that callers should not touch. And the call `svc.Save(...)` discards the returned `error`, abandoning the failure path entirely. Each of these is a symptom of inheritance-style thinking applied where composition belongs.

The correct version assembles `UserService` from two small interfaces, `Store` and `Logger`, held as **named** fields. The service depends only on behavior, so any conforming type fits: here we inject a `MemoryStore`, but a real database store satisfying the same `Store` interface would drop in with a one-line change at `NewUserService`. Access is explicit (`s.store.Save`, `s.log.Log`), which keeps every dependency visible at the call site and keeps the service's public API limited to the methods it actually means to offer (`Register`, `Name`).

Errors are threaded through deliberately. `Save` and `Load` return errors; the service wraps them with `%w` to add context while preserving the underlying cause for `errors.Is`/`errors.As`; and `main` checks every error rather than assuming success. The final lookup of a missing key exercises the failure path on purpose, demonstrating that composition and Go's explicit error model reinforce each other — each collaborator reports failure, and the composing type decides what to do about it.

---

## Design Tradeoff

Composition against interfaces buys flexibility and testability at the price of a little upfront wiring. You write a constructor, you define small interfaces, and you pass dependencies in explicitly — more ceremony than simply `extends`-ing a base class and inheriting its behavior for free. For a tiny program, that ceremony can feel like overhead. The return on it grows with the codebase: substitution becomes a one-line change, test doubles slot in without mocks frameworks, and no part of the system is welded to a concrete collaborator it happened to inherit from.

The judgment call is *named field versus embedding*. Named fields keep the outer type's surface small and its dependencies explicit, which is the right default for internal collaborators. Embedding is the right tool when the outer type genuinely wants to expose the inner type's methods — wrappers, decorators, and forwarding an interface like `io.ReadWriter`. Choosing embedding by reflex recreates inheritance's coupling and surface bloat; choosing named fields by reflex makes you write forwarding methods you did not need. Idiomatic Go picks deliberately, leans on small interfaces, and lets the standard library's "assemble upward from tiny contracts" style be the guide.

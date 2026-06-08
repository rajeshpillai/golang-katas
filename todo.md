# Golang Katas — Progress Tracker

## Project Setup

- [x] Project scaffolding and folder structure
- [x] Landing page with Katas and Applications cards
- [x] Sidebar with kata sequence navigation
- [x] Light/dark theme toggle
- [ ] Resizable code/preview panels with maximize buttons

## Learning Phases

### Phase 0 — Go as a Language
- [x] Packages and `main`
- [x] Variables and zero values
- [x] Basic types
- [x] Short variable declarations
- [x] Control flow (`if`, `for`, `switch`)
- [x] Functions and multiple return values

### Phase 1 — Structs, Methods & Data Modeling
- [x] Structs and field visibility
- [x] Methods and receivers
- [x] Value receivers vs pointer receivers
- [x] When copying is cheap vs expensive

### Phase 2 — Pointers & Memory Basics
- [x] Pointers and dereferencing
- [x] Passing values vs pointers
- [x] Escape analysis (conceptual)
- [x] Common pointer pitfalls

### Phase 3 — Error Handling as Design
- [x] Returning errors
- [x] Custom error types
- [x] Wrapping errors
- [x] Sentinel errors vs typed errors
- [x] When to panic vs return error

### Phase 4 — Interfaces (Core Abstraction)
- [x] Interface definition
- [x] Implicit implementation
- [x] Small interfaces
- [x] Interface satisfaction
- [x] Interface values and nil pitfalls

### Phase 5 — Composition over Inheritance
- [x] Struct embedding
- [x] Promoted methods
- [x] Reuse via composition
- [x] Avoiding inheritance-style thinking

### Phase 6 — Collections & Data Structures
- [x] Arrays vs slices
- [x] Slice internals (length vs capacity)
- [x] Maps and zero values
- [x] Iteration patterns
- [x] Common pitfalls with reference types

### Phase 7 — Generics (Carefully)
- [x] Type parameters
- [x] Constraints
- [x] When generics help
- [x] When interfaces are better
- [x] Avoiding generic abuse

### Phase 8 — Testing & Tooling
- [x] `testing` package
- [x] Table-driven tests
- [x] Subtests
- [x] Benchmarks
- [x] `go test`, `go vet`, `go fmt`

### Phase 9 — Concurrency Fundamentals
- [x] Goroutines
- [x] Channels
- [x] Blocking behavior
- [x] Directional channels
- [x] `select` statement

### Phase 10 — Synchronization & Coordination
- [x] `sync.Mutex`
- [x] `sync.RWMutex`
- [x] `sync.WaitGroup`
- [x] Atomic operations
- [x] Common concurrency bugs

### Phase 11 — Context & Lifecycles
- [x] `context.Context`
- [x] Cancellation propagation
- [x] Timeouts and deadlines
- [x] Context misuse pitfalls

### Phase 12 — Memory, Performance & GC Awareness
- [x] Stack vs heap (conceptual)
- [x] Garbage collection basics
- [x] Allocation patterns
- [x] Profiling (`pprof`)
- [x] Avoiding premature optimization

### Phase 13 — Files, Networking & IO
- [x] File IO
- [x] TCP/UDP basics
- [x] HTTP servers and clients
- [x] Streaming data
- [x] Error handling in IO-heavy code

### Phase 14 — Building Web Services (Standard Library First)
- [x] `net/http`
- [x] Middleware patterns
- [x] Routing basics
- [x] Request/response lifecycle
- [x] Graceful shutdown

### Phase 15 — Advanced Concurrency Patterns
- [x] Worker pools
- [x] Fan-in / fan-out
- [x] Backpressure
- [x] Rate limiting
- [x] Avoiding goroutine leaks

### Phase 16 — Advanced Systems Patterns
- [x] Plugin-like architectures
- [x] Configuration management
- [x] Observability (logs, metrics)
- [x] Dependency management
- [x] Long-running service design

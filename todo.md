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
- [ ] Structs and field visibility
- [ ] Methods and receivers
- [ ] Value receivers vs pointer receivers
- [ ] When copying is cheap vs expensive

### Phase 2 — Pointers & Memory Basics
- [ ] Pointers and dereferencing
- [ ] Passing values vs pointers
- [ ] Escape analysis (conceptual)
- [ ] Common pointer pitfalls

### Phase 3 — Error Handling as Design
- [ ] Returning errors
- [ ] Custom error types
- [ ] Wrapping errors
- [ ] Sentinel errors vs typed errors
- [ ] When to panic vs return error

### Phase 4 — Interfaces (Core Abstraction)
- [ ] Interface definition
- [ ] Implicit implementation
- [ ] Small interfaces
- [ ] Interface satisfaction
- [ ] Interface values and nil pitfalls

### Phase 5 — Composition over Inheritance
- [ ] Struct embedding
- [ ] Promoted methods
- [ ] Reuse via composition
- [ ] Avoiding inheritance-style thinking

### Phase 6 — Collections & Data Structures
- [ ] Arrays vs slices
- [ ] Slice internals (length vs capacity)
- [ ] Maps and zero values
- [ ] Iteration patterns
- [ ] Common pitfalls with reference types

### Phase 7 — Generics (Carefully)
- [ ] Type parameters
- [ ] Constraints
- [ ] When generics help
- [ ] When interfaces are better
- [ ] Avoiding generic abuse

### Phase 8 — Testing & Tooling
- [ ] `testing` package
- [ ] Table-driven tests
- [ ] Subtests
- [ ] Benchmarks
- [ ] `go test`, `go vet`, `go fmt`

### Phase 9 — Concurrency Fundamentals
- [ ] Goroutines
- [ ] Channels
- [ ] Blocking behavior
- [ ] Directional channels
- [ ] `select` statement

### Phase 10 — Synchronization & Coordination
- [ ] `sync.Mutex`
- [ ] `sync.RWMutex`
- [ ] `sync.WaitGroup`
- [ ] Atomic operations
- [ ] Common concurrency bugs

### Phase 11 — Context & Lifecycles
- [ ] `context.Context`
- [ ] Cancellation propagation
- [ ] Timeouts and deadlines
- [ ] Context misuse pitfalls

### Phase 12 — Memory, Performance & GC Awareness
- [ ] Stack vs heap (conceptual)
- [ ] Garbage collection basics
- [ ] Allocation patterns
- [ ] Profiling (`pprof`)
- [ ] Avoiding premature optimization

### Phase 13 — Files, Networking & IO
- [ ] File IO
- [ ] TCP/UDP basics
- [ ] HTTP servers and clients
- [ ] Streaming data
- [ ] Error handling in IO-heavy code

### Phase 14 — Building Web Services (Standard Library First)
- [ ] `net/http`
- [ ] Middleware patterns
- [ ] Routing basics
- [ ] Request/response lifecycle
- [ ] Graceful shutdown

### Phase 15 — Advanced Concurrency Patterns
- [ ] Worker pools
- [ ] Fan-in / fan-out
- [ ] Backpressure
- [ ] Rate limiting
- [ ] Avoiding goroutine leaks

### Phase 16 — Advanced Systems Patterns
- [ ] Plugin-like architectures
- [ ] Configuration management
- [ ] Observability (logs, metrics)
- [ ] Dependency management
- [ ] Long-running service design

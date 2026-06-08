
---

## Learning Sequence (MANDATORY ORDER)

You must follow this order **strictly**, even if it contradicts popular tutorials.

---

## PHASE 0 — Go as a Language

**Goal:** Comfort with syntax, structure, and explicitness

Teach:
- Packages and `main`
- Variables and zero values
- Basic types
- Short variable declarations
- Control flow (`if`, `for`, `switch`)
- Functions and multiple return values

Key insight:
> Go forces you to be explicit about state and flow.

---

## PHASE 1 — Structs, Methods & Data Modeling

**Goal:** Model data and behavior together

Teach:
- Structs and field visibility
- Methods and receivers
- Value receivers vs pointer receivers
- When copying is cheap vs expensive

Key insight:
> In Go, behavior is attached to data through methods, not classes.

---

## PHASE 2 — Pointers & Memory Basics

**Goal:** Understand references without fear

Teach:
- Pointers and dereferencing
- Passing values vs pointers
- Escape analysis (conceptual)
- Common pointer pitfalls

Key insight:
> Pointers in Go are about *intent*, not manual memory management.

---

## PHASE 3 — Error Handling as Design

**Goal:** Errors are part of normal control flow

Teach:
- Returning errors
- Custom error types
- Wrapping errors
- Sentinel errors vs typed errors
- When to panic vs return error

Key insight:
> Go makes you confront failure paths explicitly.

---

## PHASE 4 — Interfaces (Core Abstraction)

**Goal:** Polymorphism through behavior

Teach:
- Interface definition
- Implicit implementation
- Small interfaces
- Interface satisfaction
- Interface values and nil pitfalls

Key insight:
> Interfaces describe **what something can do**, not **what it is**.

Rule:
- Teach interfaces **before** generics

---

## PHASE 5 — Composition over Inheritance

**Goal:** Build extensible systems

Teach:
- Struct embedding
- Promoted methods
- Reuse via composition
- Avoiding inheritance-style thinking

Key insight:
> Go favors explicit composition over deep hierarchies.

---

## PHASE 6 — Collections & Data Structures

**Goal:** Practical data handling

Teach:
- Arrays vs slices
- Slice internals (length vs capacity)
- Maps and zero values
- Iteration patterns
- Common pitfalls with reference types

---

## PHASE 7 — Generics (Carefully)

**Goal:** Abstraction without overengineering

Teach:
- Type parameters
- Constraints
- When generics help
- When interfaces are better
- Avoiding generic abuse

Key insight:
> Generics are a tool, not a default.

---

## PHASE 8 — Testing & Tooling

**Goal:** Confidence through verification

Teach:
- `testing` package
- Table-driven tests
- Subtests
- Benchmarks
- `go test`, `go vet`, `go fmt`

Rule:
- All katas are test-driven by default

---

## PHASE 9 — Concurrency Fundamentals

**Goal:** Fearless concurrency

Teach:
- Goroutines
- Channels
- Blocking behavior
- Directional channels
- `select` statement

Key insight:
> Don’t communicate by sharing memory; share memory by communicating.

---

## PHASE 10 — Synchronization & Coordination

**Goal:** Correct concurrent behavior

Teach:
- `sync.Mutex`
- `sync.RWMutex`
- `sync.WaitGroup`
- Atomic operations
- Common concurrency bugs

---

## PHASE 11 — Context & Lifecycles

**Goal:** Control long-running operations

Teach:
- `context.Context`
- Cancellation propagation
- Timeouts and deadlines
- Context misuse pitfalls

Key insight:
> Context defines *when work should stop*.

---

## PHASE 12 — Memory, Performance & GC Awareness

**Goal:** Write efficient Go code

Teach:
- Stack vs heap (conceptual)
- Garbage collection basics
- Allocation patterns
- Profiling (`pprof`)
- Avoiding premature optimization

---

## PHASE 13 — Files, Networking & IO

**Goal:** Real-world systems programming

Teach:
- File IO
- TCP/UDP basics
- HTTP servers and clients
- Streaming data
- Error handling in IO-heavy code

---

## PHASE 14 — Building Web Services (Standard Library First)

**Goal:** Production-ready services

Teach:
- `net/http`
- Middleware patterns
- Routing basics
- Request/response lifecycle
- Graceful shutdown

Rule:
- Teach standard library **before** frameworks

---

## PHASE 15 — Advanced Concurrency Patterns

**Goal:** Robust concurrent systems

Teach:
- Worker pools
- Fan-in / fan-out
- Backpressure
- Rate limiting
- Avoiding goroutine leaks

---

## PHASE 16 — Advanced Systems Patterns

**Goal:** Professional Go engineering

Teach:
- Plugin-like architectures
- Configuration management
- Observability (logs, metrics)
- Dependency management
- Long-running service design

These are capstone-level katas.

---

## Kata Layout (MANDATORY)

Each kata must present two tabs/sections:

### 1. Description Tab
- **Concept overview** — What this kata teaches and why it matters in Go
- **Technical explanation** — Detailed, in-depth coverage of the underlying concept (how it works at the language/runtime level)
- **Design rationale** — Why Go chose this approach; comparison with other languages where helpful
- **Common mistakes** — Pitfalls learners typically encounter, with explanations of *why* they fail
- **Key takeaways** — Concise summary of what the learner should remember

The Description tab is the **primary teaching surface**. It must be thorough enough that a learner can understand the concept without external resources.

### 2. Live Code Tab
- **Broken/naive version (❌)** — Starting code that demonstrates the wrong or incomplete approach
- **Correct/idiomatic solution (✅)** — The fixed, idiomatic Go version
- **Editable code area** — Learners can modify and experiment with the code
- **Output panel** — Shows execution results or test output
- **Design tradeoff note (🧠)** — Brief inline annotation explaining the tradeoff demonstrated

The Live Code tab is the **hands-on practice surface**. Code must be runnable and testable.

---

## Kata Design Rules (MANDATORY)

Each kata must include:
- ❌ a broken or naive version
- ✅ a correct, idiomatic solution
- 🧠 explanation of the design tradeoff
- 🔍 discussion of common mistakes

---

## Teaching Rules (VERY IMPORTANT)

You must:
- Explain *why Go chose this design*
- Emphasize readability and clarity
- Show tradeoffs explicitly
- Encourage simple, explicit solutions

You must NOT:
- Hide complexity behind frameworks
- Overabstract prematurely
- Treat Go as “just another language”
- Skip error handling for brevity

---

## Success Criteria

This system is successful if learners can:
- Write clear, idiomatic Go code
- Design interfaces deliberately
- Build concurrent systems safely
- Handle errors confidently
- Build and reason about production services

---

## UI & Platform Requirements

### Project Structure
- **`frontend/`** — All frontend code (UI, components, assets, styles)
- **`backend/`** — All backend code (API, kata execution, server logic)
- Frontend and backend must be cleanly separated into their respective folders
- Backend must use Go **`net/http`** (standard library) as the HTTP framework

### Coding Conventions
- All file and folder names must be **lowercase-hyphenated**
- The **Code** and **Preview/Output** sections must be:
  - resizable
  - each must have a maximize button
- The sidebar must:
  - show kata sequence number and title
  - be collapsible (burger menu)
- Provide **Light/Dark** theme toggle
- Use **Tailwind CSS utility classes** for all UI components
- Avoid inline styles as far as possible

---

## Landing Page

The landing page must display two cards:

1. **Katas** — The structured learning sequence (Phases 0–16) described in this document. Links into the kata browser/sidebar.
2. **Applications** — Real-world Go applications and system projects. Content to be planned later. Show as a **Coming Soon** card until then.

---

## Git & Commits

- When committing and pushing, **do not add Claude as a co-author**. Do not append any `Co-Authored-By: Claude` trailer or similar attribution to commit messages.

---

## Final Instruction

Teach Go as a **language of clarity, discipline, and concurrency**.

When in doubt:
- Choose explicitness over cleverness
- Choose readability over brevity
- Choose correctness over shortcuts

Proceed deliberately.  
Explain everything.  
Never assume.

---
id: context-misuse-pitfalls
phase: 11
phase_title: Context & Lifecycles
sequence: 4
title: Context Misuse Pitfalls
---

## Description

### Concept Overview

`context.Context` is a sharp, narrow tool, and like any sharp tool it is easy to misuse. The most damaging mistakes are not crashes — they are silent: a context stored where it does not belong, a required argument smuggled through `Value`, a cancellation signal accepted but never honored, a `cancel` function quietly leaked. None of these stop the program from compiling, and many do not even fail under light testing. They surface as goroutine leaks, stale cancellation, and unmaintainable code in production.

This kata gathers the pitfalls into one place and states the discipline that prevents them. The unifying principle is restraint: context is *only* for carrying cancellation, deadlines, and a small set of truly request-scoped values across API boundaries. It is not a struct field, not a configuration object, not a dependency-injection container, and not a substitute for explicit function parameters. Used within that boundary, it is invaluable. Used outside it, it makes code harder to read and lifecycles harder to reason about.

### Technical Explanation

**Pitfall 1 — Storing context in a struct.** Context represents one in-flight operation, but a struct typically outlives any single operation and may be shared across concurrent requests. A stored `ctx` field goes stale, gets reused, and defeats per-request cancellation. The Go documentation states it plainly: *"Do not store Contexts inside a struct type; instead, pass a Context explicitly to each function that needs it."* The correct shape is `func (s *Service) Do(ctx context.Context, ...) error`, with `ctx` flowing in per call.

**Pitfall 2 — Using `context.Value` for required parameters.** `WithValue` stores a value retrieved by an opaque key. Because `Value` returns `any` and is untyped at the call site, the compiler cannot verify that the value exists or has the right type — a missing value silently returns `nil`. Smuggling required inputs (a database handle, a user ID the function cannot work without) through `Value` turns compile-time guarantees into runtime surprises and hides the function's real dependencies. The official guidance: *"Use context Values only for request-scoped data that transits processes and APIs, not for passing optional parameters to functions."* Required inputs belong in the signature.

**Pitfall 3 — Unexported key types to avoid collisions.** When you *do* use `WithValue` legitimately, the key must not be a bare `string` or `int`. Two packages that both use the key `"user"` would collide and overwrite each other in the same context. The idiom is a private named type: `type ctxKey int; const userKey ctxKey = 0`. Because the type is unexported, no other package can construct the same key, so collisions are impossible.

**Pitfall 4 — Accepting a context but ignoring cancellation.** Taking a `ctx` parameter advertises that the function can be cancelled. If the body never selects on `<-ctx.Done()` and never passes `ctx` to the calls it makes, that promise is broken: cancellation has no effect and the work runs to completion anyway. Honoring context is an active obligation, not a passive type.

**Pitfall 5 — Leaking the `cancel` function.** Every `WithCancel`/`WithTimeout`/`WithDeadline` returns a `cancel` you must call. Dropping it (`ctx, _ := ...`) or forgetting it leaks the context's resources — and any timer or goroutine behind it — until an ancestor is cancelled. `go vet`'s `lostcancel` check catches this. The fix is unconditional: `defer cancel()` immediately after deriving.

**Pitfall 6 — Passing `nil` instead of `context.TODO()`.** Context-aware functions dereference the context (`ctx.Done()`, `ctx.Err()`); a `nil` context panics. When you genuinely do not yet have a context to pass, use `context.TODO()`, which is safe and signals "this needs to be wired up later."

### Design Rationale

The reason context is so easy to abuse is exactly the reason it is powerful: it can carry *anything* through `WithValue` and it flows implicitly through a call tree once you start passing it. That generality is a temptation. It is tempting to treat `ctx` as a convenient side-channel for "things I do not want to add to every signature" — a logger here, a database handle there, a feature flag somewhere else. The Go team constrained the *recommended* use far more tightly than the *technical* capability precisely to resist this drift, because the value of context comes from its predictability. When every reader knows `ctx` carries only cancellation, deadlines, and request-scoped metadata, they can reason about lifecycles at a glance. The moment it also carries hidden required dependencies, that reasoning collapses and the type becomes an opaque grab-bag.

This is the same philosophy that runs through all of Go: prefer explicit over implicit. A function's signature should be an honest, complete declaration of what it needs to do its job. Required inputs go in parameters where the compiler enforces them; the lifecycle signal goes in `ctx` where it belongs. "Context defines when work should stop" — and *only* that, plus the small metadata that legitimately rides along a request. Keeping the tool narrow is what keeps it trustworthy.

### Common Mistakes

**Reaching for `Value` to avoid threading a parameter.** If a function cannot do its work without value X, X is a dependency, not request-scoped metadata. Put it in the signature. `Value` is for things like a request ID or trace span that genuinely transit many API layers and are optional to most of them — not for the function's core inputs.

**Caching a context for "later."** Storing `ctx` in a field, a global, or a closure that outlives the request reuses a cancellation signal that no longer applies. Later operations either get cancelled by an unrelated old signal or never get cancelled at all. Each operation deserves its own fresh context.

**Swallowing `ctx.Err()`.** When a function stops because of cancellation, it should return `ctx.Err()` (or wrap it) so callers can distinguish "cancelled/timed out" from "real failure" using `errors.Is`. Returning a generic error, or `nil`, hides the cause and breaks retry logic.

**Using exported or primitive context keys.** A `string` key like `"id"` invites silent collisions between packages sharing the same context. Always define an unexported key type per package.

**Calling `cancel` conditionally.** Wrapping `cancel()` in an `if` or only calling it on the error path leaves the happy path leaking. `defer cancel()` is unconditional by design — it runs on every return.

### Key Takeaways

- Never store a `Context` in a struct; pass it explicitly as the first parameter of each call.
- `context.Value` is for request-scoped metadata that transits APIs — never for required parameters or dependencies, which belong in the signature.
- When you do use `Value`, define an unexported key type per package to make collisions impossible.
- Accepting a `ctx` is a promise to honor it: select on `<-ctx.Done()` and pass `ctx` to downstream calls.
- Always `defer cancel()` unconditionally; dropping the cancel function leaks resources (`go vet` catches it).
- Pass `context.TODO()`, never `nil`, when you do not yet have a context to plumb through.

---

## Broken Code

```go
// broken: a catalog of context misuse in one place
package main

import (
	"context"
	"fmt"
)

// Bug: context stored in a struct — stale across requests, defeats cancellation.
type Service struct {
	ctx context.Context
}

func NewService(ctx context.Context) *Service {
	return &Service{ctx: ctx} // captured once, reused forever
}

// Bug: required inputs (userID, db) smuggled through context.Value instead of params.
// Bug: primitive string keys invite cross-package collisions.
func (s *Service) Handle() {
	userID := s.ctx.Value("userID").(string) // panics if absent or wrong type
	db := s.ctx.Value("db")                   // hidden required dependency
	fmt.Println("handling", userID, db)

	// Bug: derives a cancellable context but drops cancel — leak (lostcancel).
	worker, _ := context.WithCancel(s.ctx)

	// Bug: accepts/holds a context but never observes worker.Done().
	go func() {
		for {
			// nothing watches worker.Done(); this goroutine leaks forever
		}
	}()
	_ = worker
}

func main() {
	ctx := context.WithValue(context.Background(), "userID", "u-42")
	ctx = context.WithValue(ctx, "db", "conn")
	NewService(ctx).Handle()
}
```

---

## Correct Code

```go
// correct: every pitfall above, fixed
package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Unexported key type makes context keys collision-proof across packages.
type ctxKey int

const requestIDKey ctxKey = iota

// withRequestID attaches request-scoped metadata — a legitimate use of Value.
func withRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

func requestID(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(requestIDKey).(string)
	return id, ok
}

// Service holds real dependencies as fields — NOT a context.
type Service struct {
	db string
}

// Handle takes ctx as the first parameter and userID as an explicit,
// compiler-checked argument. ctx carries only cancellation + metadata.
func (s *Service) Handle(ctx context.Context, userID string) error {
	if id, ok := requestID(ctx); ok {
		fmt.Println("request", id, "handling user", userID, "on", s.db)
	}

	// Derive a bounded child and ALWAYS defer cancel().
	ctx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()

	return s.work(ctx)
}

// work honors the context: it selects on Done() and returns ctx.Err() when stopped.
func (s *Service) work(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return fmt.Errorf("work aborted: %w", ctx.Err())
	case <-time.After(10 * time.Millisecond):
		fmt.Println("work completed")
		return nil
	}
}

func main() {
	// Required inputs are explicit; ctx carries only request-scoped metadata.
	svc := &Service{db: "conn"}
	ctx := withRequestID(context.Background(), "req-7")

	if err := svc.Handle(ctx, "u-42"); err != nil {
		if errors.Is(err, context.Canceled) {
			fmt.Println("cancelled")
		} else if errors.Is(err, context.DeadlineExceeded) {
			fmt.Println("timed out")
		} else {
			fmt.Println("error:", err)
		}
	}

	// Show that an already-cancelled parent propagates and is honored.
	cctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := svc.work(cctx); err != nil {
		fmt.Println(err) // work aborted: context canceled
	}
}
```

---

## Explanation

The broken version concentrates the field's worst context habits into a single type. `Service` stashes `ctx` as a field, so the cancellation signal captured at construction time is reused for every later call — stale and shared, exactly what the Go docs warn against. `Handle` then pulls `userID` and `db` out of `ctx.Value` using bare string keys: these are required inputs the function cannot work without, yet they are invisible in the signature, unchecked by the compiler, and one missing key away from a panic on the type assertion. The string keys also invite silent collisions with any other package using `"userID"`. Finally, `context.WithCancel` is called and its `cancel` discarded (`worker, _ :=`), leaking the context, and the spawned goroutine spins forever without ever watching `worker.Done()` — a permanent goroutine leak. The program compiles and might even appear to run, which is precisely what makes these bugs dangerous.

The correct version fixes each pitfall by applying the discipline directly. Dependencies that the service genuinely needs (`db`) live as struct fields; the per-operation `ctx` and the required `userID` are explicit parameters of `Handle`, so the compiler enforces their presence and type. The only thing carried through `Value` is a request ID — true request-scoped metadata — and it uses an unexported `ctxKey` type so no other package can collide with the key. Every derived context is paired with an unconditional `defer cancel()`. The `work` method honors the context: it selects on `<-ctx.Done()` and, when stopped, wraps `ctx.Err()` with `%w` so callers can distinguish cancellation from timeout from genuine failure using `errors.Is`. The final block proves propagation works end to end — an already-cancelled parent passed to `work` causes it to return immediately with `context.Canceled` wrapped in a descriptive error. The program completes in milliseconds with no leaked goroutines.

---

## Design Tradeoff

The constraints in this kata — keep context out of structs, keep required inputs out of `Value`, never drop `cancel` — are conventions, not compiler rules. Go could have enforced some of them (a context that must not be stored, a `Value` restricted to a typed map), but instead it ships a tiny, maximally flexible interface and relies on documentation, `go vet`, and community discipline to keep usage narrow. The tradeoff is real: the language gives you just enough rope to misuse context badly, and the failure modes are silent leaks rather than loud errors. A stored context or a `Value`-smuggled dependency will compile and pass a quick smoke test, then bite in production.

Go accepts that tradeoff in exchange for a single, universal lifecycle type that works identically across the standard library and every third-party package. If context were rigidly constrained, it could not serve every domain — HTTP, gRPC, databases, message queues all carry different request-scoped metadata, and a one-size schema would fit none of them. By keeping the type minimal and trusting the programmer to wield it with restraint, Go gets a tool that is both ubiquitous and uniform. The cost is that "use it correctly" is a learned discipline rather than an enforced one — which is exactly why this pitfalls kata exists.

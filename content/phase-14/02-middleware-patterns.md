---
id: middleware-patterns
phase: 14
phase_title: Building Web Services (Standard Library First)
sequence: 2
title: Middleware Patterns
---

## Description

### Concept Overview

Middleware is code that runs *around* your request handlers — before the handler to inspect or modify the incoming request, and after to inspect or modify the outgoing response. Logging, authentication, request timing, panic recovery, CORS headers, rate limiting: these are all cross-cutting concerns that you do not want to copy-paste into every handler. Middleware lets you write them once and apply them to many routes.

In Go, middleware is not a special framework feature. It is just a function that takes an `http.Handler` and returns a new `http.Handler` that wraps it. Because the `Handler` interface is so small, this pattern composes beautifully: you can stack middleware like layers of an onion, each one wrapping the next. There is no plugin system, no registration API, no magic — just functions wrapping functions. This kata teaches that pattern and why it is so powerful.

### Technical Explanation

**The middleware signature** that the Go community has standardized on is:

```go
func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // ... do something before ...
        next.ServeHTTP(w, r) // call the wrapped handler
        // ... do something after ...
    })
}
```

A middleware receives the `next` handler in the chain. It returns a brand-new `http.Handler` (built with the `http.HandlerFunc` adapter) whose `ServeHTTP` does some work, then calls `next.ServeHTTP(w, r)` to pass control down the chain, then optionally does more work on the way back out. This "wrap and delegate" structure is the entire pattern.

**Why this composes**: Because a middleware takes a `Handler` and returns a `Handler`, the output of one middleware is a valid input to the next. You can write:

```go
handler := Logging(Auth(Recover(finalHandler)))
```

Reading from the inside out, `finalHandler` is wrapped by `Recover`, then by `Auth`, then by `Logging`. At request time, control flows *outside-in* on the way down — `Logging` runs first, then `Auth`, then `Recover`, then `finalHandler` — and *inside-out* on the way back up. This is exactly the "onion" model: each layer surrounds the ones beneath it.

**Order matters**. A recovery middleware that catches panics must be *outside* the handlers that might panic, so it wraps them. An authentication middleware should run *before* the expensive handler logic, so it sits near the outside too. A request-ID or logging middleware usually sits at the very outside so it observes everything. Choosing the order is a design decision, and because composition is explicit, the order is visible right in the code.

**The "before" and "after" phases**: Work you do before `next.ServeHTTP` sees the request as it came in. Work you do after sees the response as the handler left it — though by then the status and body may already be flushed to the client. To capture the status code for logging, a common trick is to wrap the `http.ResponseWriter` in a small struct that records the status passed to `WriteHeader`. This is shown in the correct code below.

**Per-route vs global middleware**: You can apply middleware globally by wrapping the whole mux (`srv.Handler = Logging(mux)`), or per-route by wrapping individual handlers before registering them. Global wrapping is simplest for concerns that apply everywhere (logging, recovery); per-route wrapping is right for concerns that apply selectively (auth on `/admin` only).

**Passing data down the chain** is done through the request's `context.Context`. A middleware that authenticates a user can attach the user to the context with `r = r.WithContext(context.WithValue(r.Context(), key, user))` and pass the new request down. Downstream handlers read it back out. Context values are the idiomatic, type-safe-ish way to pass request-scoped data without global variables.

### Design Rationale

Go's middleware pattern emerges naturally from the `Handler` interface — it was not designed as a "middleware system," it is just a consequence of small interfaces and first-class functions. This is the opposite of how most frameworks approach the problem.

In **Express** (Node.js), middleware is a built-in concept with a special `(req, res, next)` signature where you must remember to call `next()` (and forgetting to is a common bug that hangs the request). Middleware is registered on the app object in order, which is convenient but couples everything to Express's internals. In **Spring** (Java), the equivalent is filters, interceptors, and aspect-oriented programming with annotations — powerful but heavy, often relying on reflection and proxies that are hard to follow. In **Flask/Django** (Python), there are decorators and a middleware class protocol with `process_request`/`process_response` hooks.

Go needs none of these special mechanisms. Because middleware is just `func(http.Handler) http.Handler`, any two middleware from any two libraries compose, as long as they agree on the standard `Handler` interface — which they do, because it is in the standard library. There is no framework lock-in. You can read exactly where each layer begins and ends. This is the "standard library before frameworks" philosophy paying dividends: the abstraction is so minimal that it does not even need a name in the language — it is just ordinary function composition over a one-method interface.

### Common Mistakes

**Forgetting to call `next.ServeHTTP`**: If your middleware does its work but never calls `next`, the request silently dies — the wrapped handler never runs, and the client may get an empty or hung response. Why it fails: the middleware *is* the handler now; if it does not delegate, nothing downstream executes.

**Writing to the `ResponseWriter` before deciding to call `next`**: If a middleware writes a body or status and *then* also calls `next.ServeHTTP`, you get a corrupted response and a `superfluous WriteHeader` log. An auth middleware that rejects a request must write the `401` and **return** without calling `next`. Why it fails: once bytes are written, the status and headers are committed.

**Getting the order wrong**: Putting recovery middleware *inside* (closer to the handler than) something that can panic means the panic escapes the recovery layer and crashes the server. Why it fails: recovery only catches panics from code it wraps; order determines what it wraps.

**Mutating shared state in middleware without synchronization**: Middleware runs in the same per-request goroutine as the handler, but a counter or map shared across requests still needs a mutex or atomic. Why it fails: many requests run concurrently through the same middleware instance.

**Capturing the status code by reading `ResponseWriter` directly**: The standard `http.ResponseWriter` does not expose the status you wrote. To log it, you must wrap the writer to record `WriteHeader` calls. Why it fails: the interface is intentionally minimal and write-only.

### Key Takeaways

- Middleware in Go is just `func(next http.Handler) http.Handler` — a function that wraps a handler and returns a handler.
- The pattern composes like an onion: outer middleware wraps inner ones; control flows outside-in then back inside-out.
- Always call `next.ServeHTTP(w, r)` to continue the chain — unless you are intentionally short-circuiting (e.g., rejecting with `401`).
- Order is a design decision and is visible in the code: recovery and logging usually go outermost, auth before expensive logic.
- Pass request-scoped data down the chain with `context.Context`, not globals.
- To capture the response status for logging, wrap the `ResponseWriter` in a small struct that records `WriteHeader`.

---

## Broken Code

```go
// broken: an auth middleware that writes a 401 but then STILL calls next,
// and a logging middleware that forgets to call next at all.
package main

import (
    "fmt"
    "net/http"
)

func authMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Header.Get("Authorization") == "" {
            // Bug: writes 401 but does NOT return — execution falls through
            // and calls next, producing a corrupted double-written response.
            w.WriteHeader(http.StatusUnauthorized)
            fmt.Fprintln(w, "unauthorized")
        }
        next.ServeHTTP(w, r) // runs even when unauthorized!
    })
}

func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Println("request received:", r.URL.Path)
        // Bug: never calls next.ServeHTTP — the real handler never runs,
        // so the client gets an empty 200 response.
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "hello")
    })
    http.ListenAndServe(":8080", loggingMiddleware(authMiddleware(mux)))
}
```

---

## Correct Code

```go
// correct: composable middleware (logging with status capture, panic recovery,
// auth that short-circuits) wrapping a mux, exercised by in-process requests.
package main

import (
    "context"
    "fmt"
    "io"
    "net"
    "net/http"
    "time"
)

// statusRecorder wraps ResponseWriter to capture the status code for logging,
// since the standard ResponseWriter does not expose it.
type statusRecorder struct {
    http.ResponseWriter
    status int
}

func (s *statusRecorder) WriteHeader(code int) {
    s.status = code
    s.ResponseWriter.WriteHeader(code)
}

func logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
        next.ServeHTTP(rec, r)
        fmt.Printf("[log] %s %s -> %d\n", r.Method, r.URL.Path, rec.status)
    })
}

func recover500(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rv := recover(); rv != nil {
                fmt.Println("[recover] panic:", rv)
                http.Error(w, "internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

type ctxKey string

const userKey ctxKey = "user"

func auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if token == "" {
            // Short-circuit: write the error and RETURN. Do not call next.
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        // Pass request-scoped data down via context.
        ctx := context.WithValue(r.Context(), userKey, "alice")
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /hello", func(w http.ResponseWriter, r *http.Request) {
        user, _ := r.Context().Value(userKey).(string)
        fmt.Fprintf(w, "hello, %s\n", user)
    })

    // Compose: logging (outermost) -> recover -> auth -> mux.
    handler := logging(recover500(auth(mux)))

    srv := &http.Server{
        Handler:           handler,
        ReadTimeout:       5 * time.Second,
        WriteTimeout:      10 * time.Second,
        IdleTimeout:       120 * time.Second,
        ReadHeaderTimeout: 5 * time.Second,
    }

    ln, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        fmt.Println("listen error:", err)
        return
    }
    addr := ln.Addr().String()

    serveErr := make(chan error, 1)
    go func() { serveErr <- srv.Serve(ln) }()

    client := &http.Client{Timeout: 3 * time.Second}

    // 1) No auth header: middleware short-circuits with 401.
    resp, err := client.Get("http://" + addr + "/hello")
    if err == nil {
        body, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        fmt.Printf("unauthenticated -> %s %s", resp.Status, string(body))
    }

    // 2) With auth header: reaches the handler, reads user from context.
    req, _ := http.NewRequest("GET", "http://"+addr+"/hello", nil)
    req.Header.Set("Authorization", "Bearer token")
    resp, err = client.Do(req)
    if err == nil {
        body, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        fmt.Printf("authenticated   -> %s %s", resp.Status, string(body))
    }

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        fmt.Println("shutdown error:", err)
    }
    if err := <-serveErr; err != nil && err != http.ErrServerClosed {
        fmt.Println("serve error:", err)
    }
}
```

---

## Explanation

The broken version shows the two most common middleware bugs. The `authMiddleware` writes a `401` when there is no `Authorization` header — but it forgets to `return`. Execution falls through to `next.ServeHTTP(w, r)`, so the protected handler runs anyway, writing a second response on top of the first. The result is a corrupted response and a `superfluous WriteHeader` log, and the "protection" provides no protection at all. The `loggingMiddleware` has the opposite bug: it does its logging but never calls `next.ServeHTTP`, so the real handler never runs and the client receives an empty `200`.

The correct version fixes both and demonstrates the full pattern. Each middleware is a `func(http.Handler) http.Handler`. The `auth` middleware short-circuits correctly: when there is no token it writes the error and **returns**, never touching `next`; when there is a token it attaches the user to the request context and passes a new request down with `r.WithContext(ctx)`. The `logging` middleware wraps the `ResponseWriter` in a `statusRecorder` so it can observe the final status code — something the bare `ResponseWriter` does not expose — and logs it *after* `next` returns. The `recover500` middleware uses a deferred `recover()` so that a panic in any downstream handler becomes a clean `500` instead of crashing the process.

Composition is explicit: `logging(recover500(auth(mux)))`. Read inside-out, that is the wrapping order; at request time, `logging` runs first, then `recover500`, then `auth`, then the mux's handler. The program then exercises both paths in-process — once without an auth header (getting a `401`) and once with one (reaching the handler and reading the user back out of context) — before shutting the server down gracefully.

---

## Design Tradeoff

The wrap-and-delegate pattern trades a tiny bit of indirection for enormous flexibility and zero framework coupling. Reading `logging(recover500(auth(mux)))` requires you to mentally unwind the nesting to understand execution order, which can feel less obvious than a flat list like Express's `app.use(a); app.use(b)`. As chains grow, people often introduce a small `chain(mux, auth, recover500, logging)` helper to flatten the syntax back into a readable list — but that helper is, again, just ordinary Go, not a framework feature.

The win is that every middleware is an independent, testable, reusable function with no dependency on anything but the standard `http.Handler` interface. Middleware written by you, by a library author, and by the standard library all interoperate freely. There is no special registration API to learn and no hidden control flow — the order of execution is literally the order of nesting in your code. This is the recurring Go theme: by keeping the core abstraction minimal (`Handler`), the language gets a powerful, composable feature (middleware) for free, without inventing any new machinery.

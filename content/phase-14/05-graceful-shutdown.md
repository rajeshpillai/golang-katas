---
id: graceful-shutdown
phase: 14
phase_title: Building Web Services (Standard Library First)
sequence: 5
title: Graceful Shutdown
---

## Description

### Concept Overview

A web service does not run forever. It gets redeployed, scaled down, or restarted — many times a day in a modern system. The question is: what happens to the requests that are *in flight* at the exact moment the process is told to stop? With a naive server, the answer is "they are killed mid-response" — the client gets a broken connection, a half-written response, or an error. Graceful shutdown is the discipline of stopping a server *cleanly*: stop accepting new connections, let the requests already being served finish, and only then exit.

Go's `net/http` has first-class support for this through `http.Server.Shutdown(ctx)`. Combined with OS signal handling (`SIGINT`, `SIGTERM`) and a context-based timeout, you can build a server that drains in-flight work and shuts down predictably. This kata teaches that pattern — and why running a server without it leads to dropped requests and angry users.

### Technical Explanation

**`ListenAndServe` / `Serve` block and return on stop**: When you call `srv.ListenAndServe()` (or `srv.Serve(ln)`), it blocks, accepting connections, until the server is closed. When `Shutdown` (or `Close`) is called, it returns the sentinel error `http.ErrServerClosed`. That error is *not* a failure — it is the normal signal that the server stopped on request. You must distinguish it from real errors:

```go
if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
    // a real startup/serve error
}
```

**`Shutdown(ctx)` does a graceful drain**: Calling `srv.Shutdown(ctx)`:
1. Immediately stops the listeners, so no *new* connections are accepted.
2. Closes idle keep-alive connections.
3. Waits for all *active* (in-flight) requests to finish their handlers.
4. Returns `nil` when everything has drained, or the context's error if the context is cancelled/timed-out first.

The `ctx` you pass bounds how long you are willing to wait for the drain. If in-flight requests take longer than the deadline, `Shutdown` returns `ctx.Err()` (e.g. `context.DeadlineExceeded`) and any still-running handlers are abandoned. This timeout is essential: you do not want a single stuck handler to block your deploy forever.

**`Close()` vs `Shutdown(ctx)`**: `Close()` is the abrupt version — it immediately closes all connections, active or not, interrupting in-flight requests. `Shutdown(ctx)` is the graceful version. Use `Shutdown` for normal termination; reserve `Close` as a last resort if the graceful drain exceeds your deadline.

**Listening for OS signals**: A process is usually told to stop via a signal — `SIGINT` (Ctrl-C) or `SIGTERM` (sent by orchestrators like Kubernetes or `systemd`). The idiomatic pattern uses `signal.NotifyContext`:

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
```

This returns a context that is cancelled when one of those signals arrives. You run `ListenAndServe` in a goroutine, block on `<-ctx.Done()` in `main`, and when the signal fires you call `srv.Shutdown(...)` with a *fresh* timeout context.

**The full lifecycle**: start the server in a goroutine → block until a shutdown signal → call `Shutdown` with a bounded timeout → wait for the serve goroutine to return `ErrServerClosed` → exit. Done correctly, no in-flight request is ever cut off (within the timeout), and the process exits with a clean status.

**Why the timeout context for `Shutdown` must be separate** from the signal context: the signal context is already cancelled (that is why you are shutting down). You need a *new* context with its own deadline to give the drain a bounded amount of time.

### Design Rationale

Graceful shutdown is built into the standard `http.Server` because Go was designed for exactly this kind of long-running networked service, and the language team considered clean termination a core requirement, not an add-on. The `Shutdown` method, the `ErrServerClosed` sentinel, and `signal.NotifyContext` all live in the standard library and compose cleanly with `context.Context` — the same cancellation primitive used throughout Go.

In many other ecosystems graceful shutdown is a bolt-on. **Node.js**'s `http.Server.close()` stops accepting connections but historically did not forcibly track and drain in-flight requests well, so people reach for libraries or write manual connection tracking. **Spring Boot** added graceful shutdown as a configuration option relatively late, and it is mediated by the framework's lifecycle machinery. In Python's WSGI world, draining is typically the job of the process manager (Gunicorn) rather than your application code.

Go puts the capability directly in your hands with a small, explicit API. The pattern is a handful of lines you write yourself, so you can see exactly what happens on shutdown — there is no hidden lifecycle, no framework callback ordering to reason about. This is the "standard library before frameworks" philosophy again: the standard library gives you a correct, composable primitive (`Shutdown` + `context`), and you assemble the exact behavior you want. The result is a deploy story that just works — orchestrators send `SIGTERM`, your server drains, and clients never see a severed request.

### Common Mistakes

**Not implementing graceful shutdown at all**: Letting the process die on signal (the default) kills in-flight requests mid-flight. Clients get connection resets and half-responses; during every deploy you drop a slice of live traffic. Why it fails: the OS terminates the process immediately; the server never gets a chance to finish active requests.

**Treating `ErrServerClosed` as a fatal error**: Logging or exiting non-zero when `ListenAndServe` returns `http.ErrServerClosed` makes a *normal* shutdown look like a crash, breaking health checks and alerting. Why it fails: `ErrServerClosed` is the expected return value after `Shutdown`/`Close`, not an error condition.

**Calling `Shutdown` with no timeout (or the already-cancelled signal context)**: A `Shutdown(context.Background())` with no deadline can block forever if a handler is stuck; passing the already-cancelled signal context makes `Shutdown` give up instantly and cut off requests. Why it fails: the context controls the drain window — too long blocks deploys, already-cancelled defeats the drain.

**Forgetting to wait for the serve goroutine to return**: If `main` returns right after calling `Shutdown` without waiting for the serving goroutine, you may exit before the drain completes or hide serve errors. Why it fails: `Shutdown` returning does not guarantee the goroutine running `Serve` has unwound; you should synchronize on it.

**Leaking background goroutines/resources started by handlers**: Graceful HTTP shutdown drains requests but does not stop goroutines or connections *you* spawned (DB pools, workers). You must close those too, in order. Why it fails: `Shutdown` only knows about the HTTP server's own connections.

### Key Takeaways

- A server must stop *gracefully*: stop accepting new connections, drain in-flight requests, then exit — `srv.Shutdown(ctx)` does exactly this.
- `ListenAndServe`/`Serve` return `http.ErrServerClosed` on a clean shutdown; treat that as success, not an error.
- Always pass a *fresh*, timeout-bounded context to `Shutdown` so a stuck handler cannot block your deploy forever.
- Use `signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)` to turn `SIGINT`/`SIGTERM` into a cancellable context.
- Run `Serve` in a goroutine, block on the signal, call `Shutdown`, then wait for the serve goroutine to return before exiting.
- `Shutdown` only drains the HTTP server's connections — close your own resources (DBs, workers) explicitly too.

---

## Broken Code

```go
// broken: no graceful shutdown. On SIGTERM the process is killed instantly,
// cutting off in-flight requests; and it treats ErrServerClosed as fatal.
package main

import (
    "fmt"
    "net/http"
    "time"
)

func slowHandler(w http.ResponseWriter, r *http.Request) {
    // Simulates real work that takes a moment to finish.
    time.Sleep(2 * time.Second)
    fmt.Fprintln(w, "done")
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/work", slowHandler)

    srv := &http.Server{Addr: ":8080", Handler: mux}

    // Bug: ListenAndServe blocks until the process is signalled, and there is
    // NO signal handling and NO Shutdown call. When the orchestrator sends
    // SIGTERM, the process dies immediately and any in-flight /work request
    // is severed mid-response.
    err := srv.ListenAndServe()

    // Bug: ErrServerClosed is the NORMAL shutdown signal, but this treats it
    // as a fatal crash, breaking health checks and alerting.
    fmt.Println("server crashed:", err)
}
```

---

## Correct Code

```go
// correct: graceful shutdown driven by a cancellable context. Starts a slow
// handler, fires a request, triggers shutdown while it is in flight, and shows
// the in-flight request still completing before the process exits cleanly.
package main

import (
    "context"
    "errors"
    "fmt"
    "io"
    "net"
    "net/http"
    "time"
)

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /work", func(w http.ResponseWriter, r *http.Request) {
        // Simulated in-flight work; graceful shutdown will let this finish.
        time.Sleep(500 * time.Millisecond)
        fmt.Fprintln(w, "work completed")
    })

    srv := &http.Server{
        Handler:           mux,
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
    base := "http://" + ln.Addr().String()

    // Serve in a goroutine. It returns ErrServerClosed when Shutdown is called.
    serveErr := make(chan error, 1)
    go func() { serveErr <- srv.Serve(ln) }()

    // Fire a request that will be IN FLIGHT when we trigger shutdown.
    reqDone := make(chan string, 1)
    go func() {
        client := &http.Client{Timeout: 3 * time.Second}
        resp, err := client.Get(base + "/work")
        if err != nil {
            reqDone <- "request error: " + err.Error()
            return
        }
        body, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        reqDone <- fmt.Sprintf("%s %s", resp.Status, string(body))
    }()

    // Give the request time to start, then begin graceful shutdown while it
    // is still being served. In a real program this trigger would be a
    // SIGINT/SIGTERM delivered via signal.NotifyContext.
    time.Sleep(100 * time.Millisecond)
    fmt.Println("shutdown signal received; draining in-flight requests...")

    // Fresh, timeout-bounded context for the drain.
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        fmt.Println("shutdown error:", err)
    }

    // The in-flight request should have completed during the drain.
    fmt.Println("in-flight request result:", <-reqDone)

    // ErrServerClosed is the expected, clean result — not a crash.
    if err := <-serveErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
        fmt.Println("serve error:", err)
    }
    fmt.Println("server exited cleanly")
}
```

---

## Explanation

The broken version runs a server with no shutdown handling. `srv.ListenAndServe()` blocks, and there is no code to intercept `SIGINT`/`SIGTERM` and no call to `Shutdown`. When an orchestrator sends `SIGTERM` (as Kubernetes does before every pod termination), the Go runtime's default behavior terminates the process immediately. Any request currently inside `slowHandler` — sleeping, talking to a database, streaming a response — is severed mid-flight. The client sees a connection reset. On top of that, the code prints "server crashed" for whatever `ListenAndServe` returns, which means a *normal* `http.ErrServerClosed` shutdown would be logged as a crash, corrupting your observability.

The correct version implements the full graceful-shutdown lifecycle. The server runs via `srv.Serve(ln)` in a background goroutine, and its return value is captured on a channel so the program can inspect it later. A request to the slow `/work` handler is fired and deliberately left *in flight*. After a brief pause — standing in for a real `SIGTERM`, which in production you would receive through `signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)` — the program calls `srv.Shutdown(ctx)` with a *fresh* 5-second timeout context. `Shutdown` stops accepting new connections, closes idle ones, and waits for the in-flight `/work` request to finish. That request completes normally and returns "work completed", proving it was drained rather than killed. Finally, the program reads the serve goroutine's result and uses `errors.Is(err, http.ErrServerClosed)` to recognize the clean-shutdown sentinel as success rather than a failure.

The example is fully self-contained: it listens on `127.0.0.1:0`, makes only in-process requests, and exits promptly once the drain completes and the serve goroutine has returned, leaving no goroutines running.

---

## Design Tradeoff

Graceful shutdown trades a small amount of shutdown latency for correctness. Instead of dying instantly, the server pauses to let active requests finish — bounded by the timeout you choose. Pick the timeout too short and you cut off slow-but-legitimate requests; pick it too long and a single stuck handler delays every deploy. The timeout is a deliberate knob: it encodes your tolerance for "how long is too long to wait for a request to finish." There is no free lunch — a handler that hangs forever will hit the deadline and still be abandoned — which is why the context-bounded API is exactly the right shape.

The deeper tradeoff is that Go hands you the primitive (`Shutdown` + `context`) rather than a turnkey "graceful mode" flag. You write the orchestration yourself: start in a goroutine, wait for the signal, drain with a deadline, then close your own resources in the right order. That is a few more lines than a framework's single config option, but it is explicit and fully under your control — you can see precisely what is drained, in what order, and for how long. For long-running production services, that transparency is worth far more than the brevity of a hidden lifecycle, and it is the reason Go services have a reputation for boring, reliable deploys.

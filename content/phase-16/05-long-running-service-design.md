---
id: long-running-service-design
phase: 16
phase_title: Advanced Systems Patterns
sequence: 5
title: Long-Running Service Design
---

## Description

### Concept Overview

A long-running service is a program designed to stay up for days, weeks, or months — accepting work continuously and only stopping when explicitly told to. Designing one well is mostly about three concerns: **wiring** (assembling the components in `main` and giving each its dependencies), **lifecycle** (starting components in order, running them concurrently, and stopping them cleanly), and **graceful shutdown** (responding to a termination signal by finishing in-flight work and releasing resources before exiting). Get these right and the service restarts predictably, drains connections instead of dropping them, and never leaks goroutines or file handles.

The connective tissue of all three is `context.Context`. A root context is created in `main` and threaded through every component; cancelling it is the universal "stop now" signal. When the operating system sends `SIGINT` or `SIGTERM`, you cancel the root context, and every goroutine that respects it begins to wind down. This is the Go idiom for lifecycle: **cancellation propagates down the context tree**, and components cooperate by watching `ctx.Done()`. There is no framework lifecycle, no `@PreDestroy` hook — just a context, a signal handler, and explicit start/stop code in `main`.

### Technical Explanation

**`main` is the composition root.** It builds configuration, the logger, the stores, the services, and the HTTP server, then starts them and waits. Keep `main` thin but explicit: it is the one place where concrete types are chosen and connected.

**Listen for OS signals and turn them into context cancellation.** `signal.NotifyContext` (Go 1.16+) returns a context that is cancelled when a listed signal arrives, which is the cleanest bridge from OS signals to Go cancellation:

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

**Run concurrent components against the same context.** Each long-lived component (HTTP server, background worker, queue consumer) runs in its own goroutine and watches `ctx.Done()`. Coordinate their startup and shutdown with `sync.WaitGroup` or `errgroup` so `main` can wait for all of them to finish.

**Graceful HTTP shutdown drains in-flight requests.** `http.Server.Shutdown(ctx)` stops accepting new connections and waits for active requests to complete, up to the deadline in the context you pass:

```go
<-ctx.Done()                 // signal received
shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)    // drain in-flight requests, then return
```

**Background workers honor cancellation and clean up.** A worker loop selects on `ctx.Done()` so it exits promptly, and runs any cleanup (flush buffers, close files) on the way out:

```go
for {
    select {
    case <-ctx.Done():
        flush()
        return
    case job := <-jobs:
        process(job)
    }
}
```

**Bound the shutdown.** Always give shutdown its own *timeout* context so a stuck request cannot hang the process forever — after the deadline, you force-exit. Graceful does not mean infinite.

### Design Rationale

Go's lifecycle model is built on `context.Context` rather than a framework-managed lifecycle, and that is a deliberate rejection of the implicit. In Spring or similar containers, components have lifecycle callbacks (`@PostConstruct`, `@PreDestroy`) that a framework invokes by reflection in an order it decides. It is convenient until shutdown misbehaves, at which point you are debugging the container's lifecycle engine. Go's answer is that **start and stop are ordinary code in `main`**: you start components in the order you write, and you stop them by cancelling a context you created. The shutdown order is the order of your `defer`s and your waits — readable, deterministic, and yours.

Cancellation-by-context also unifies two things that other ecosystems treat separately: **timeouts** and **shutdown**. A context can be cancelled because a deadline elapsed *or* because a signal arrived; downstream code watches `ctx.Done()` and does not care which. This means the same `select { case <-ctx.Done(): ... }` that handles a per-request timeout also handles process shutdown. One mechanism, threaded everywhere, covers "stop this request" and "stop the whole service." That economy of concepts is very Go: a single small primitive (the context) composes to solve a family of problems.

Graceful shutdown matters because the alternative — exiting the instant a signal arrives — drops in-flight requests, corrupts partial writes, and orphans resources. In a world of rolling deployments and autoscaling, processes are killed *routinely*, not exceptionally. A service that cannot drain cleanly causes user-visible errors on every deploy. Go makes draining a first-class operation (`http.Server.Shutdown`), and bounding it with a timeout context makes "graceful" safe — you wait for orderly completion, but never forever.

### Common Mistakes

**Blocking on `os.Signal` forever with no cancellation path.** A bare `<-sigChan` that then calls `os.Exit(0)` skips every cleanup step — no request draining, no buffer flushing, no resource release. Bridge the signal to a context (`signal.NotifyContext`) and let components shut down cooperatively, then exit.

**Calling `os.Exit` (or letting `main` return) before components drain.** `os.Exit` runs no `defer`s and waits for nothing. If you exit the moment the signal arrives, in-flight requests die and background workers are killed mid-job. Cancel the context, *wait* for components to finish, and only then exit.

**No timeout on shutdown.** If a single slow request never completes, an unbounded `Shutdown(context.Background())` hangs the process indefinitely, and the orchestrator eventually `SIGKILL`s it — losing the very cleanliness you were trying to achieve. Always give shutdown a bounded timeout context.

**Leaking goroutines that ignore the context.** A background goroutine that loops without selecting on `ctx.Done()` never stops; on shutdown it is simply abandoned, and during the process's life it can accumulate. Every long-lived goroutine must have a cancellation exit.

**Wiring dependencies via package globals instead of `main`.** Reaching for global singletons (`var db *sql.DB` at package scope, initialized in `init()`) makes lifecycle implicit and shutdown order undefined — you cannot close things in a controlled sequence. Construct dependencies in `main`, pass them in, and close them with `defer` in reverse order.

### Key Takeaways

- Make `main` the **composition root**: build config, logger, stores, services, and server there, explicitly, then start and wait.
- Bridge OS signals to cancellation with `signal.NotifyContext`, and thread the **root context** through every component as the universal "stop" signal.
- Run long-lived components as goroutines that watch `ctx.Done()`, and coordinate their completion with a `WaitGroup` so `main` waits for a clean stop.
- Drain in-flight work on shutdown (`http.Server.Shutdown`), and always **bound shutdown with a timeout context** so a stuck task cannot hang the process.
- Never `os.Exit` or return from `main` before components finish — cancel, wait, then exit, so `defer`-based cleanup actually runs.
- One primitive — `context.Context` — unifies timeouts and shutdown; the same `<-ctx.Done()` handles both.

---

## Broken Code

```go
// broken: blocks on a signal forever, then os.Exit immediately — no draining,
// no context, a leaked worker goroutine, and dependencies as package globals.
package main

import (
    "fmt"
    "net/http"
    "os"
    "os/signal"
)

// broken: global, init-wired dependency. Lifecycle is implicit; nothing
// controls the order in which things are set up or torn down.
var requests int

func worker() {
    // broken: infinite loop with no cancellation. On shutdown it is simply
    // abandoned mid-work; while running it can never be stopped.
    for {
        requests++ // also racy, but the real sin is "no way to stop"
    }
}

func main() {
    go worker()

    srv := &http.Server{Addr: ":8080"}
    go srv.ListenAndServe() // started, but never gracefully shut down

    // broken: block forever on the signal, then exit hard.
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, os.Interrupt)
    <-sig

    // broken: os.Exit runs no defers, drains no requests, flushes nothing.
    fmt.Println("shutting down")
    os.Exit(0)
}
```

---

## Correct Code

```go
// correct: main as composition root; root context bridges signals to
// cancellation; an HTTP server and a background worker run concurrently and
// shut down gracefully with a bounded timeout. Shutdown is SIMULATED by
// cancelling the context after one unit of work, so the program terminates
// quickly instead of waiting on a real OS signal.
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "sync"
    "time"
)

// worker is a long-lived component that honors cancellation and cleans up.
func worker(ctx context.Context, log *slog.Logger, jobs <-chan int) {
    var processed int
    for {
        select {
        case <-ctx.Done():
            // Cleanup on the way out (flush buffers, close files, etc.).
            log.Info("worker stopping", "processed", processed)
            return
        case j := <-jobs:
            processed++
            log.Info("processed job", "job", j, "total", processed)
        }
    }
}

func main() {
    log := slog.New(slog.NewTextHandler(os.Stdout, nil))

    // Composition root: build the root context that everything shuts down from.
    // In production this is signal.NotifyContext(... SIGINT, SIGTERM ...).
    // Here we cancel it ourselves to simulate a signal so the program exits.
    ctx, stop := context.WithCancel(context.Background())
    defer stop()

    var wg sync.WaitGroup

    // Component 1: background worker.
    jobs := make(chan int, 4)
    wg.Add(1)
    go func() {
        defer wg.Done()
        worker(ctx, log, jobs)
    }()

    // Component 2: HTTP server.
    mux := http.NewServeMux()
    mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
        fmt.Fprintln(w, "ok")
    })
    srv := &http.Server{Addr: "127.0.0.1:0", Handler: mux}

    wg.Add(1)
    go func() {
        defer wg.Done()
        log.Info("http server starting", "addr", srv.Addr)
        // ListenAndServe returns ErrServerClosed on graceful shutdown.
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            log.Error("http server error", "err", err)
        }
        log.Info("http server stopped")
    }()

    // Do one unit of work to show the service is live.
    for i := 1; i <= 3; i++ {
        jobs <- i
    }
    time.Sleep(20 * time.Millisecond) // let the worker drain the jobs

    // --- Simulated SIGTERM: trigger graceful shutdown. ---
    log.Info("signal received, beginning graceful shutdown")
    stop() // cancel root ctx -> worker begins to exit

    // Drain in-flight HTTP requests, bounded by a timeout so we never hang.
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Error("graceful shutdown failed", "err", err)
    }

    // Wait for every component to finish before exiting — so defers and
    // cleanup actually run. Never os.Exit before this point.
    wg.Wait()
    log.Info("shutdown complete")
}
```

---

## Explanation

The broken version embodies the "kill the process and hope" model of shutdown. It blocks on a signal channel forever, and the instant a signal arrives it calls `os.Exit(0)` — which runs no `defer`s, drains no in-flight HTTP requests, and flushes nothing. Its background `worker` loops with no cancellation path, so it can never be stopped cooperatively; on shutdown it is simply abandoned. And its state lives in a package global, so there is no controlled order in which components are set up or torn down. In a world of rolling deploys, where the process is signalled routinely, this design drops requests and corrupts partial work on every restart.

The correct version is built around a single root context. `main` is the composition root: it constructs the logger, the worker, and the HTTP server, and starts each long-lived component in its own goroutine tracked by a `WaitGroup`. Both components watch the same context — the worker via `select { case <-ctx.Done(): }`, the server via `Shutdown` — so cancelling that context is the one universal "stop" signal. When the simulated `SIGTERM` arrives (here, a direct `stop()` call so the program terminates promptly instead of blocking on a real OS signal), shutdown proceeds in deliberate order: cancel the context so the worker winds down, call `srv.Shutdown` with a *bounded* timeout to drain active requests without hanging forever, then `wg.Wait()` so `main` does not return until every component has finished its cleanup. Only after that does the program exit.

The structure maps one-to-one onto a real service. Swap the `context.WithCancel`/`stop()` simulation for `signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)` and bind the server to a real address, and the same code becomes a production-grade lifecycle: signals become cancellation, cancellation drains components, and the timeout guarantees the process always exits in bounded time. Nothing else changes — which is the point.

---

## Design Tradeoff

Graceful, context-driven lifecycle is more code than a bare signal-then-exit, and it forces you to think about ordering: what to cancel first, what to wait for, and how long to wait before giving up. A framework that manages lifecycle for you would hide that orchestration behind callbacks. Go's trade is to keep the orchestration in `main`, written as explicit start, cancel, and wait steps, because shutdown ordering is exactly the kind of thing you must be able to read and reason about when a deploy goes wrong. The cost is a longer `main`; the benefit is a shutdown sequence that is deterministic and inspectable rather than emergent from a container's internal rules.

The deeper tradeoff is *cooperative* shutdown versus *forced* termination. Cooperative shutdown — every goroutine watching `ctx.Done()` and the server draining requests — is clean but relies on every component actually honoring cancellation; one goroutine that ignores the context will not stop. That is why the timeout-bounded shutdown context is essential: it converts "wait for everything to finish cleanly" into "wait for everything to finish cleanly, but no longer than N seconds, then force the issue." You get the cleanliness of graceful draining for the common case and a hard guarantee of bounded shutdown time for the pathological one. Choosing that timeout is a genuine policy decision — too short and you cut off legitimate in-flight work, too long and a stuck request delays every deploy — and Go deliberately leaves it in your hands rather than picking a magic default.

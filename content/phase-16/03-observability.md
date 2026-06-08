---
id: observability
phase: 16
phase_title: Advanced Systems Patterns
sequence: 3
title: Observability (Logs, Metrics)
---

## Description

### Concept Overview

Observability is the property that lets you understand what a running system is doing from the outside, using the signals it emits. The three classic signals are **logs** (discrete, timestamped events), **metrics** (numeric measurements aggregated over time), and **traces** (the path of a request across components). For a long-running Go service, getting the first two right covers most operational needs: structured logs tell you *what happened and why*, metrics tell you *how often and how fast*, and a health endpoint tells an orchestrator *whether the process is alive and ready*.

The key word is **structured**. A line like `fmt.Println("user", id, "failed login")` is human-readable but machine-hostile: you cannot reliably filter, aggregate, or alert on free-form text. Structured logging emits each event as a set of typed key-value attributes — `time`, `level`, `msg`, and your own fields — so a log pipeline can index and query them. Since Go 1.21, the standard library provides this directly via `log/slog`, so you no longer need a third-party logger to get production-grade structured logs.

### Technical Explanation

**`log/slog` produces structured records.** A `slog.Logger` writes records consisting of a timestamp, a level, a message, and arbitrary key-value attributes. You choose a *handler* that controls the output format — `slog.NewTextHandler` for human-readable `key=value` lines, `slog.NewJSONHandler` for machine-ingestible JSON:

```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
}))
logger.Info("login failed", "user_id", 42, "reason", "bad password")
// {"time":"...","level":"INFO","msg":"login failed","user_id":42,"reason":"bad password"}
```

**Attach context with `With`.** A logger derived via `With` carries fixed attributes on every line, so you set request-scoped fields once instead of repeating them:

```go
reqLog := logger.With("request_id", "abc123", "route", "/checkout")
reqLog.Info("started")
reqLog.Warn("slow downstream", "latency_ms", 850)
```

**Metrics are aggregated numbers.** The three workhorse metric types are **counters** (monotonically increasing — total requests, total errors), **gauges** (a value that goes up and down — in-flight requests, queue depth), and **histograms** (the distribution of observations — request latency). A minimal in-process counter is just an atomic integer; production systems expose these via a `/metrics` endpoint that a scraper (Prometheus) reads:

```go
type Counter struct{ n atomic.Int64 }
func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Value() int64 { return c.n.Load() }
```

**Health endpoints report liveness and readiness.** A *liveness* check answers "is the process running and not deadlocked?" — usually a trivial `200 OK`. A *readiness* check answers "can it serve traffic right now?" — it verifies dependencies (database reachable, caches warm) and returns `503` until they are. Orchestrators like Kubernetes poll these to decide whether to restart a pod (liveness) or route traffic to it (readiness).

**Levels gate verbosity.** `slog` supports `Debug`, `Info`, `Warn`, `Error`. The handler's configured minimum level filters output, so you can run at `Info` in production and flip to `Debug` to investigate without redeploying — provided the level is driven by configuration.

### Design Rationale

Before Go 1.21, structured logging required a third-party library (zap, logrus, zerolog), each with its own API, performance profile, and dependency footprint. The standard library deliberately stayed out of the way — until the community converged enough that a standard structured logger could be designed well. `log/slog` is the result: it ships in the standard library, has a stable backend-agnostic API, and lets libraries log structured events without forcing a logger choice on their consumers. This is classic Go: wait until the right abstraction is clear, then put it in the standard library so the whole ecosystem shares it.

The `Handler` interface is the design's pivot. `slog.Logger` is a thin front end; all the policy — formatting, filtering, where bytes go — lives behind the `slog.Handler` interface. That means your code calls `logger.Info(...)` exactly the same way whether output is colored text in development or JSON shipped to a log aggregator in production. You swap the handler at the program's edge, in `main`, and nothing downstream changes. This is the same interface-at-the-boundary discipline that runs through Go: depend on a small interface, decide the concrete implementation once, at the top.

Go's metrics philosophy is similarly minimal. There is no built-in metrics framework, because a counter is an atomic integer and a `/metrics` endpoint is an HTTP handler — primitives you already have. Libraries like `expvar` (standard library) and Prometheus's client exist for the wiring and exposition format, but the core idea is intentionally simple: measure with cheap atomics, expose over HTTP, let an external system do the aggregation and alerting. Keeping the in-process side trivial avoids coupling your service to a heavyweight metrics runtime.

### Common Mistakes

**Using `fmt.Println` / `log.Printf` for events you need to query.** Free-form text cannot be reliably filtered or aggregated. "Find all failed logins for user 42 in the last hour" is a one-line query against structured logs and a brittle regex nightmare against printed strings. Emit structured records with `slog` from the start for anything operationally relevant.

**Logging unbounded or sensitive data.** Dumping a full request body, a stack of headers, or a password into every log line bloats your log bill and leaks secrets. Log identifiers and outcomes (`user_id`, `status`, `latency_ms`), not raw payloads, and redact credentials.

**Conflating liveness and readiness.** If your liveness probe checks the database, a brief database blip makes the orchestrator *kill and restart* a perfectly healthy process — turning a transient dependency outage into a cascading restart storm. Liveness should be cheap and local; readiness is where you check dependencies.

**Incrementing metrics without atomics.** A plain `counter++` from multiple goroutines is a data race that loses increments and corrupts the value. Use `sync/atomic` (or a mutex) for any counter touched concurrently — which, in a server, is all of them.

**Hardcoding the log level or destination.** If the level is a compile-time constant, you cannot raise verbosity to diagnose a live incident without redeploying. Drive the level and handler from configuration so you can adjust observability in production.

### Key Takeaways

- Prefer **structured logging** (`log/slog`) over `fmt.Println`/`log.Printf` for anything you need to filter, aggregate, or alert on.
- Choose the output format by swapping the `slog.Handler` (text for humans, JSON for machines) at the edge of the program — call sites never change.
- Use `logger.With(...)` to attach request-scoped attributes once, so every derived line carries them.
- Measure with cheap primitives: **counters** (atomic ints), **gauges**, **histograms**; expose them over HTTP and let an external system aggregate.
- Separate **liveness** (cheap, local — "am I alive?") from **readiness** (checks dependencies — "can I serve traffic?").
- Drive log level and output destination from **configuration** so you can adjust observability without redeploying.

---

## Broken Code

```go
// broken: free-form text logging with fmt.Println, a racy counter, and a
// health check that conflates liveness with a dependency check.
package main

import (
    "fmt"
    "time"
)

// broken: plain int incremented from goroutines -> data race, lost counts.
var requestCount int

func handle(user int, ok bool) {
    requestCount++ // racy when called concurrently

    // broken: unstructured text. You cannot reliably query "failed logins
    // for user 42" against lines like this; redacting/aggregating is hopeless.
    if ok {
        fmt.Println(time.Now(), "user", user, "logged in")
    } else {
        fmt.Println(time.Now(), "user", user, "FAILED login bad password")
    }
}

// broken: "health" depends on a database ping, so a DB blip makes the
// orchestrator kill the whole (healthy) process via the liveness probe.
func health(dbUp bool) string {
    if !dbUp {
        return "DOWN" // kills the process on a transient dependency outage
    }
    return "OK"
}

func main() {
    handle(42, false)
    handle(7, true)
    fmt.Println("total requests:", requestCount)
    fmt.Println("health:", health(false))
}
```

---

## Correct Code

```go
// correct: structured logging with log/slog, an atomic counter exposed over
// HTTP, and separate liveness/readiness checks. Self-contained and quick:
// it emits structured lines, serves /metrics, /livez, /readyz once, then exits.
package main

import (
    "fmt"
    "io"
    "log/slog"
    "net/http"
    "net/http/httptest"
    "os"
    "sync/atomic"
)

// Counter is a concurrency-safe monotonic metric.
type Counter struct{ n atomic.Int64 }

func (c *Counter) Inc()         { c.n.Add(1) }
func (c *Counter) Value() int64 { return c.n.Load() }

type server struct {
    log      *slog.Logger
    requests Counter
    errors   Counter
    dbReady  atomic.Bool // simulates a dependency's readiness
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
    s.requests.Inc()
    // Request-scoped attributes attached once via With.
    reqLog := s.log.With("route", "/login", "method", r.Method)

    ok := r.URL.Query().Get("ok") == "true"
    user := r.URL.Query().Get("user")
    if !ok {
        s.errors.Inc()
        // Structured: queryable by user_id and reason, no secrets logged.
        reqLog.Warn("login failed", "user_id", user, "reason", "bad_password")
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }
    reqLog.Info("login succeeded", "user_id", user)
    fmt.Fprintln(w, "ok")
}

// /metrics exposes counters in a simple text format.
func (s *server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
    fmt.Fprintf(w, "app_requests_total %d\n", s.requests.Value())
    fmt.Fprintf(w, "app_errors_total %d\n", s.errors.Value())
}

// Liveness is cheap and local: am I running?
func (s *server) handleLivez(w http.ResponseWriter, _ *http.Request) {
    w.WriteHeader(http.StatusOK)
    fmt.Fprintln(w, "alive")
}

// Readiness checks dependencies: can I serve traffic right now?
func (s *server) handleReadyz(w http.ResponseWriter, _ *http.Request) {
    if !s.dbReady.Load() {
        http.Error(w, "db not ready", http.StatusServiceUnavailable)
        return
    }
    fmt.Fprintln(w, "ready")
}

func main() {
    // Handler chosen once, at the edge: JSON for machine ingestion. Swapping
    // to NewTextHandler would change format without touching any call site.
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))

    s := &server{log: logger}
    s.dbReady.Store(true) // dependency is up

    mux := http.NewServeMux()
    mux.HandleFunc("/login", s.handleLogin)
    mux.HandleFunc("/metrics", s.handleMetrics)
    mux.HandleFunc("/livez", s.handleLivez)
    mux.HandleFunc("/readyz", s.handleReadyz)

    // Drive a few requests through an in-process test server so the example
    // is deterministic and terminates (no real listener, no blocking).
    ts := httptest.NewServer(mux)
    defer ts.Close()

    get := func(path string) string {
        resp, err := http.Get(ts.URL + path)
        if err != nil {
            logger.Error("request failed", "path", path, "err", err)
            return ""
        }
        defer resp.Body.Close()
        body, _ := io.ReadAll(resp.Body)
        return fmt.Sprintf("%d %s", resp.StatusCode, body)
    }

    get("/login?user=42&ok=false") // emits a structured WARN line
    get("/login?user=7&ok=true")   // emits a structured INFO line

    fmt.Println("livez ->", get("/livez"))
    fmt.Println("readyz->", get("/readyz"))
    fmt.Print("metrics:\n", get("/metrics"))
}
```

---

## Explanation

The broken version logs with `fmt.Println`, producing lines that are pleasant for a human staring at a terminal but useless for a machine. There is no level, no consistent field structure, and the data is interpolated into a sentence — so "show me every failed login for user 42" becomes a fragile regex instead of a structured query. Its `requestCount` is a plain `int` mutated from what would be concurrent request handlers, which is a data race that silently loses increments. And its `health` function returns `DOWN` whenever the database is unreachable; if that function backs a liveness probe, a momentary database blip causes the orchestrator to kill an otherwise-healthy process, escalating a brief dependency hiccup into a restart storm.

The correct version fixes each of these with standard-library tools. Logging goes through `slog` with a JSON handler, so every event is a record with a level, a message, and typed attributes (`user_id`, `reason`) that a log pipeline can index. Request-scoped fields are attached once with `With`, keeping call sites terse. The counters are `Counter` types wrapping `atomic.Int64`, so concurrent increments are correct, and they are exposed over a `/metrics` endpoint for an external scraper to aggregate. Crucially, liveness and readiness are *separate*: `/livez` is a cheap local `200`, while `/readyz` checks the simulated database and returns `503` until it is up — so a dependency outage withholds traffic without killing the process.

The example runs entirely in-process via `httptest.Server`, drives a handful of requests, prints the results, and exits — no real listener, no blocking — yet it exercises the full observability surface: structured logs to stdout, a metrics endpoint, and split health checks. In a real service the same handlers attach to a real `http.Server`; nothing about the observability code changes.

---

## Design Tradeoff

Structured logging costs a little ergonomics up front: `logger.Info("login failed", "user_id", id, "reason", "bad_password")` is more deliberate than `fmt.Println("login failed for", id)`. You think about field names and you accept JSON output that is denser to read by eye. In exchange, your logs become queryable, aggregatable, and alertable — the difference between grepping text and running real operational queries during an incident. For a service that runs for months, that trade is overwhelmingly worth it; the few extra keystrokes per log line are repaid the first time you need to find a needle in a haystack at 3 a.m.

The minimalist metrics approach — atomic counters behind an HTTP endpoint — trades built-in convenience for control and a tiny footprint. A full metrics framework would hand you histograms, labels, and a registry out of the box, at the cost of a heavyweight dependency and its runtime. Go's standard-library posture is to keep the in-process side trivial (atomics and an `http.Handler` are things you already have) and let an external system like Prometheus own aggregation, retention, and alerting. You can adopt the richer client library when you genuinely need labels and histograms, but you should reach for it knowing exactly what the bare primitives already give you for free.

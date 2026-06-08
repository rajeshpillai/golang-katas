---
id: net-http
phase: 14
phase_title: Building Web Services (Standard Library First)
sequence: 1
title: net/http
---

## Description

### Concept Overview

Go ships with a complete, production-grade HTTP stack in its standard library: the `net/http` package. You do not need a framework to build a real web service in Go. You do not need to add a dependency to serve JSON, route requests, parse forms, or stream responses. The standard library does all of it, and it does it well enough that some of the largest services in the world run on `net/http` with no framework at all.

At the heart of `net/http` sit three small but profound ideas: the `Handler` interface, the `HandlerFunc` adapter, and the `ServeMux` router. Understanding these three things — and how a request flows through them — is the foundation of every Go web service you will ever write. Everything else (middleware, routing libraries, frameworks) is built on top of this same foundation.

This kata teaches you to build an HTTP server using nothing but the standard library, and to understand precisely what happens when a request arrives.

### Technical Explanation

**The `Handler` interface** is the central abstraction. It is defined as:

```go
type Handler interface {
    ServeHTTP(w http.ResponseWriter, r *http.Request)
}
```

Anything that implements `ServeHTTP` is a handler. The `http.ResponseWriter` is the interface you use to write the response (set headers, write the status code, write the body). The `*http.Request` carries everything about the incoming request: method, URL, headers, body, and context. This single, two-method-free interface is the contract that the entire ecosystem agrees on.

**The `HandlerFunc` adapter** lets you use an ordinary function as a `Handler` without defining a type. It is defined as:

```go
type HandlerFunc func(http.ResponseWriter, *http.Request)

func (f HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    f(w, r)
}
```

This is one of the most elegant patterns in the standard library. `HandlerFunc` is a named function type whose `ServeHTTP` method simply calls itself. So when you write `http.HandleFunc("/path", myFunc)`, Go wraps `myFunc` in a `HandlerFunc` so it satisfies the `Handler` interface. This is the adapter pattern expressed in three lines of Go.

**The `ServeMux` router** is an HTTP request multiplexer — a `Handler` that dispatches to other handlers based on the request's URL path (and, since Go 1.22, the method too). You register handlers with `mux.Handle(pattern, handler)` or `mux.HandleFunc(pattern, fn)`, and the mux matches incoming requests against its registered patterns.

**Go 1.22 enhanced routing**: Before Go 1.22, `ServeMux` matched only on path prefixes and exact paths, with no method awareness. Since Go 1.22, patterns can include an HTTP method and path wildcards:

```go
mux.HandleFunc("GET /users/{id}", getUser)
mux.HandleFunc("POST /users", createUser)
```

The method (`GET`, `POST`, etc.) restricts the route to that verb. The `{id}` is a path wildcard whose value you read with `r.PathValue("id")`. This brought much of what people previously needed third-party routers for into the standard library.

**The request/response lifecycle**: When a request arrives, the `http.Server` reads the request line and headers, constructs an `*http.Request`, and calls the server's handler's `ServeHTTP`. If that handler is a `ServeMux`, it finds the best-matching pattern and calls that handler's `ServeHTTP`. Your code writes headers and a body through the `ResponseWriter`. When `ServeHTTP` returns, the server finishes flushing the response.

**The `http.Server` struct** is the thing you should actually run in production. While `http.ListenAndServe(addr, handler)` is convenient for examples, the explicit `&http.Server{...}` form lets you configure timeouts (`ReadTimeout`, `WriteTimeout`, `IdleTimeout`) and call `Shutdown(ctx)` for graceful termination — both essential for real services.

### Design Rationale

Go's philosophy is **standard library before frameworks**. The `net/http` package is not a toy; it is a complete server and client implementation that the language team maintains, secures, and optimizes. Because it is in the standard library, every Go programmer shares the same vocabulary — `Handler`, `ResponseWriter`, `Request` — and every framework and middleware library interoperates through these same types.

Compare this to other ecosystems. In Node.js, the built-in `http` module is low-level, so almost everyone reaches for **Express** immediately — and Express's `(req, res, next)` signature is a de-facto standard that is *not* part of the language. In Java, the Servlet API is verbose and historically required an application server; **Spring** became the gravitational center, bringing a huge dependency tree and runtime magic (annotations, dependency injection, classpath scanning). In Python, the standard library's `http.server` is explicitly "not for production," so **Flask** or **Django** are near-mandatory.

Go is different. The standard `net/http` *is* production-ready. The `Handler` interface is so small and so well-designed that the entire middleware ecosystem is just functions that take a `Handler` and return a `Handler`. There is no magic, no reflection-based routing, no annotation scanning. You can read the request lifecycle in plain, explicit Go. This is the payoff of Go's "explicit over clever" philosophy: the simplest thing (the standard library) is also the correct thing for production.

### Common Mistakes

**Using `http.ListenAndServe` in production with no timeouts**: `http.ListenAndServe(addr, handler)` creates an `http.Server` with **zero timeouts**, which means a slow or malicious client can hold a connection open forever. This is a real denial-of-service vector (the "Slowloris" attack). Always construct an explicit `&http.Server{}` and set `ReadTimeout`, `WriteTimeout`, and `IdleTimeout`. Why it fails: a zero `Duration` means "no timeout," not "a sensible default."

**Writing the status code after writing the body**: You must call `w.WriteHeader(statusCode)` *before* writing any body bytes. The first call to `w.Write(...)` implicitly sends a `200 OK` if you have not already set a status. After that, `w.WriteHeader(...)` is too late — the status line and headers are already on the wire, and Go logs `superfluous response.WriteHeader call`. Why it fails: HTTP sends the status line and headers before the body, so once the body starts the status is fixed.

**Setting headers after the first `Write`**: For the same reason, any `w.Header().Set(...)` must happen before the first `w.Write` (or before `WriteHeader`). Headers written after the body are silently ignored. Why it fails: the header block is flushed when the body begins.

**Forgetting that handlers run concurrently**: The server runs each request in its own goroutine. If your handlers touch shared mutable state (a map, a counter) without synchronization, you have a data race. Why it fails: `net/http` is concurrent by design; correctness is your responsibility.

**Relying on the default global mux via `http.HandleFunc`**: `http.HandleFunc` registers on the package-level `DefaultServeMux`, which is global mutable state shared across your whole program (and any imported package). This makes tests interfere with each other and hides dependencies. Prefer creating your own `mux := http.NewServeMux()` and passing it explicitly.

### Key Takeaways

- `net/http` is a complete, production-grade HTTP stack — you do not need a framework to ship a real Go web service.
- The `Handler` interface (`ServeHTTP(w, r)`) is the single abstraction the entire ecosystem is built on.
- `HandlerFunc` adapts an ordinary function into a `Handler` — that is why `HandleFunc` works.
- `ServeMux` routes requests by path, and since Go 1.22 by method and `{wildcard}` path patterns read via `r.PathValue`.
- Always run an explicit `&http.Server{}` with timeouts set; `http.ListenAndServe` has none and is unsafe for production.
- Write headers and status before the body; handlers run concurrently, so synchronize shared state.

---

## Broken Code

```go
// broken: ships a server with no timeouts and uses the global DefaultServeMux,
// and writes the status code AFTER the body has already been sent.
package main

import (
    "fmt"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
    // Bug: w.Write sends a 200 OK immediately, so the WriteHeader below
    // is too late and Go logs "superfluous response.WriteHeader call".
    fmt.Fprintln(w, "starting work...")
    w.WriteHeader(http.StatusInternalServerError) // ignored!
    fmt.Fprintln(w, "...something went wrong")
}

func main() {
    // Bug: registers on the global DefaultServeMux (hidden global state).
    http.HandleFunc("/", handler)

    // Bug: ListenAndServe creates a server with NO ReadTimeout, WriteTimeout,
    // or IdleTimeout. A slow client can hold connections open forever.
    http.ListenAndServe(":8080", nil)
}
```

---

## Correct Code

```go
// correct: explicit ServeMux, an http.Server with timeouts, a Go 1.22
// method+path route, an in-process client request, and graceful shutdown.
package main

import (
    "context"
    "fmt"
    "io"
    "net"
    "net/http"
    "time"
)

func main() {
    // Build our own mux instead of the global DefaultServeMux.
    mux := http.NewServeMux()

    // Go 1.22 method + path wildcard routing. {id} is read via PathValue.
    mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
        id := r.PathValue("id")
        // Set headers and status BEFORE writing the body.
        w.Header().Set("Content-Type", "text/plain; charset=utf-8")
        w.WriteHeader(http.StatusOK)
        fmt.Fprintf(w, "user id = %s\n", id)
    })

    // An explicit server with timeouts: this is the production-safe form.
    srv := &http.Server{
        Handler:           mux,
        ReadTimeout:       5 * time.Second,
        WriteTimeout:      10 * time.Second,
        IdleTimeout:       120 * time.Second,
        ReadHeaderTimeout: 5 * time.Second,
    }

    // Listen on an OS-assigned port on the loopback interface only.
    ln, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        fmt.Println("listen error:", err)
        return
    }
    addr := ln.Addr().String()

    // Serve in a background goroutine. srv.Serve returns ErrServerClosed
    // when Shutdown is called — that is the normal, expected exit.
    serveErr := make(chan error, 1)
    go func() {
        serveErr <- srv.Serve(ln)
    }()

    // Make an in-process request against our own server.
    client := &http.Client{Timeout: 3 * time.Second}
    resp, err := client.Get("http://" + addr + "/users/42")
    if err != nil {
        fmt.Println("request error:", err)
    } else {
        body, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        fmt.Printf("status: %s\n", resp.Status)
        fmt.Printf("body:   %s", string(body))
    }

    // Graceful shutdown: stop accepting new connections and let in-flight
    // requests finish, bounded by a context timeout.
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        fmt.Println("shutdown error:", err)
    }

    // Confirm the serving goroutine exited cleanly.
    if err := <-serveErr; err != nil && err != http.ErrServerClosed {
        fmt.Println("serve error:", err)
    }
    fmt.Println("server stopped cleanly")
}
```

---

## Explanation

The broken version makes two classic first-day mistakes. First, it registers its handler on the global `DefaultServeMux` via `http.HandleFunc(...)` with a `nil` handler passed to `ListenAndServe`. That global is shared mutable state — any package can register routes on it, tests interfere with each other, and you cannot have two independent servers. Second, and worse, it calls `http.ListenAndServe` directly, which builds an `http.Server` with **no timeouts**. A single slow client trickling bytes one at a time can hold a goroutine and a connection hostage indefinitely. Finally, it writes the response body with `fmt.Fprintln(w, ...)` *before* calling `w.WriteHeader(...)`, so the `500` status is silently ignored — the client already received a `200 OK` the moment the first byte was written.

The correct version fixes all three. It creates its own `http.NewServeMux()` so routing is explicit and self-contained. It uses a Go 1.22 `GET /users/{id}` pattern, restricting the route to the `GET` method and reading the path wildcard with `r.PathValue("id")`. It builds an explicit `&http.Server{}` with `ReadTimeout`, `WriteTimeout`, `IdleTimeout`, and `ReadHeaderTimeout` set, which is the form you should always reach for in real code. And it sets the `Content-Type` header and calls `WriteHeader(http.StatusOK)` *before* writing the body, so the status and headers are correct.

To keep the example fully runnable and self-contained, it listens on `127.0.0.1:0` (an OS-assigned port on loopback, so no privileges and no port conflicts), serves in a background goroutine, makes a real in-process HTTP request against itself, prints the response, and then calls `srv.Shutdown(ctx)` for a clean, graceful stop. The serving goroutine exits with `http.ErrServerClosed`, which is the normal signal that `Shutdown` did its job.

---

## Design Tradeoff

The convenience functions — `http.ListenAndServe`, `http.HandleFunc`, the `DefaultServeMux` — are wonderful for a five-line demo or a quick script. They trade away configurability and isolation for brevity. The cost is hidden global state and a server with no timeouts, which is exactly what you do not want in production. The explicit form (`http.NewServeMux` + `&http.Server{}`) is a few more lines, but it gives you timeouts, graceful shutdown, isolation for testing, and the ability to run multiple independent servers in one process.

The broader tradeoff is Go's "standard library first" stance. A framework can save you from writing the boilerplate of constructing a server and a router. But in Go, that boilerplate is small, explicit, and readable — and it is built on the same `Handler` interface that every framework also uses. By learning `net/http` directly, you gain the ability to read and reason about any Go web service, framework or not. You pay a little more typing up front in exchange for never being mystified by what your server is actually doing.

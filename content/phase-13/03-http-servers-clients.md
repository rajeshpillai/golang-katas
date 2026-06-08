---
id: http-servers-clients
phase: 13
phase_title: Files, Networking & IO
sequence: 3
title: HTTP Servers and Clients
---

## Description

### Concept Overview

HTTP is where Go's networking philosophy pays its biggest dividend. The `net/http` package, part of the standard library, gives you a production-grade HTTP server and client with no framework required. And once again the design is built on the `io` interfaces: a request body is an `io.Reader`, a response is written to an `http.ResponseWriter` (which is an `io.Writer`), and a response body you receive as a client is an `io.ReadCloser`. Everything you know about reading and writing byte streams applies directly to HTTP.

On the server side, you implement the `http.Handler` interface — a single method `ServeHTTP(w http.ResponseWriter, r *http.Request)` — or use the `http.HandlerFunc` adapter to turn an ordinary function into a handler. On the client side, `http.Get`, `http.Post`, and the configurable `http.Client` issue requests and return an `*http.Response`. The two halves are symmetric and both rest on the same request/response model.

### Technical Explanation

**The `http.Handler` interface is the heart of the server.** It is, true to Go form, tiny:

```go
type Handler interface {
    ServeHTTP(w http.ResponseWriter, r *http.Request)
}
```

`http.ResponseWriter` is an interface that *is* an `io.Writer` — you write the response body by calling `w.Write` (or, more commonly, `fmt.Fprintf(w, ...)` or `json.NewEncoder(w).Encode(...)`). Before writing the body you set headers via `w.Header().Set(...)` and the status code via `w.WriteHeader(code)`. Order matters: you must set headers *before* the first `Write`, because the first write implicitly sends a `200 OK` and flushes the header block. Writing a header after the body has begun is a no-op and logs a warning.

**Routing with `ServeMux`.** `http.NewServeMux` is the standard library router. You register handlers with `mux.HandleFunc("/path", fn)` or `mux.Handle("/path", handler)`. Since Go 1.22 the mux understands method-and-pattern routes like `"GET /users/{id}"` with path wildcards, which removed much of the historical reason to reach for a third-party router.

**Middleware is just a function that wraps a handler.** Because a handler is a value and `http.Handler` is an interface, middleware is a function `func(http.Handler) http.Handler` that returns a new handler wrapping the original — logging, authentication, and timing all compose by nesting these wrappers. There is no special middleware machinery; it is plain function composition over the `Handler` interface.

**The request body is an `io.ReadCloser` you must close and (usually) drain.** `r.Body` is a stream. You read it with `io.ReadAll(r.Body)` or a JSON decoder, and the server closes it for you on the server side — but as a *client* reading a *response*, you own `resp.Body` and **must** call `resp.Body.Close()`. Failing to close (and ideally fully read) a response body prevents the underlying TCP connection from being reused and can leak it.

**The client returns an `*http.Response`.** `resp.StatusCode` is the numeric status, `resp.Header` the headers, and `resp.Body` the streaming body. A non-2xx status is *not* an error from `http.Get` — the call succeeds as long as it got *any* response; you must check `resp.StatusCode` yourself. The error return is reserved for transport failures (DNS, connection refused, timeout).

**`httptest` for self-contained testing.** `httptest.NewServer(handler)` starts a real HTTP server on a loopback port and gives you its URL, perfect for exercising a client against your own handler in one program. `httptest.NewRecorder` captures a handler's output without any network at all.

**Graceful shutdown.** A real server runs `srv.ListenAndServe()` and is stopped with `srv.Shutdown(ctx)`, which stops accepting new connections and waits for in-flight requests to finish (up to the context's deadline) before returning — covered more in the Context phase, but worth knowing the server is designed to stop cleanly, not be killed mid-request.

### Design Rationale

Go shipped a complete, fast, standards-compliant HTTP stack in its standard library and made it the default. This is a deliberate cultural stance: in the Go world, "use the standard library first" is real advice, not a slogan. Compare the landscape elsewhere.

**Java** historically required a servlet container (Tomcat, Jetty) or a framework (Spring) to do anything HTTP; the built-in `HttpServer` in `com.sun.net.httpserver` is minimal and rarely used for real services. The default path is heavyweight.

**Node.js** has a capable built-in `http` module, but the ecosystem overwhelmingly reaches for Express or Fastify because the raw module is low-level and unergonomic for routing and middleware.

**Python** ships `http.server` for toys but expects Flask/Django/FastAPI plus a WSGI/ASGI server (Gunicorn, Uvicorn) for production.

Go's `net/http` is genuinely production-ready on its own — it powers enormous services with no framework. The reason it can be is the `Handler` interface: because the entire abstraction is one method over `io`-based request/response types, routing, middleware, and composition are all just ordinary Go code. Go bet that a small, well-designed core plus the language's composition features would beat a sprawling framework, and for a huge class of services it was right. The tradeoff is that conveniences other frameworks bundle (validation, ORM integration, dependency injection) you assemble yourself — which Go considers a feature, because it keeps the request lifecycle explicit and debuggable.

### Common Mistakes

**Not closing `resp.Body` on the client.** The single most common `net/http` bug. *Why it fails:* `resp.Body` holds the connection; until you `Close()` it (and read it to EOF), the connection cannot return to the pool and the descriptor leaks. Under load this exhausts connections and descriptors. Always `defer resp.Body.Close()` immediately after checking the error.

**Treating a 4xx/5xx status as a transport error.** *Why it fails:* `http.Get` returns `err == nil` for any completed HTTP exchange, including a 500. If you only check `err`, you will happily process an error page as if it were valid data. You must inspect `resp.StatusCode` explicitly.

**Writing headers or status after writing the body.** Calling `w.Header().Set(...)` or `w.WriteHeader(...)` after the first `w.Write`. *Why it fails:* the first write flushes a `200 OK` with the headers as they stood, so later header/status changes are silently ignored (and logged as a "superfluous WriteHeader call"). Set status and headers first.

**Using `http.DefaultClient` with no timeout for outbound calls.** *Why it fails:* the default client has *no* request timeout; a hung server can block your goroutine forever. Construct an `http.Client{Timeout: ...}` (or use a context) for any real outbound request.

**Not draining the request body before responding/returning.** *Why it fails:* leaving unread bytes in the body can prevent connection reuse (keep-alive) and, for clients, the same prevents pooling. Reading to EOF (or `io.Copy(io.Discard, body)`) lets the connection be recycled.

### Key Takeaways

- `net/http` is a production-grade server and client in the standard library — reach for a framework only when you have a concrete reason.
- A server handler is the one-method `http.Handler` interface; `http.ResponseWriter` is an `io.Writer`, so writing responses is ordinary stream writing.
- Set status and headers *before* the first body write — the first `Write` flushes the header block.
- On the client, always `defer resp.Body.Close()`, and check `resp.StatusCode` yourself because a non-2xx status is not a Go error.
- Middleware is just `func(http.Handler) http.Handler` — composition over the `Handler` interface, no special machinery.
- Use `httptest.NewServer` to run a real server on loopback for self-contained client/server programs and tests; set client timeouts for real outbound calls.

---

## Broken Code

```go
// broken: never closes resp.Body (leaks the connection) and treats any
// non-error response as success, ignoring the HTTP status code.
package main

import (
    "fmt"
    "io"
    "net/http"
)

func main() {
    resp, err := http.Get("http://example.com/data")
    if err != nil {
        fmt.Println("request failed:", err)
        return
    }
    // broken: no defer resp.Body.Close() — connection/descriptor leaks
    // broken: never checks resp.StatusCode, so a 500 error page is treated as data

    body, _ := io.ReadAll(resp.Body) // broken: ignores read error
    fmt.Println("body:", string(body))
}
```

---

## Correct Code

```go
// correct: a self-contained example — start a real HTTP server with httptest,
// then call it as a client with proper status checks and body closing.
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/http/httptest"
    "time"
)

func main() {
    // --- server side: a tiny JSON API ---
    mux := http.NewServeMux()
    mux.HandleFunc("/greet", func(w http.ResponseWriter, r *http.Request) {
        name := r.URL.Query().Get("name")
        if name == "" {
            // Set the status BEFORE writing the body.
            http.Error(w, "missing name", http.StatusBadRequest)
            return
        }
        // Set headers before the first Write, then encode JSON to the
        // ResponseWriter (which is an io.Writer).
        w.Header().Set("Content-Type", "application/json")
        _ = json.NewEncoder(w).Encode(map[string]string{
            "message": "hello, " + name,
        })
    })

    // httptest spins up a real server on a loopback port and gives us its URL.
    srv := httptest.NewServer(mux)
    defer srv.Close()

    // --- client side: call the server we just started ---
    client := &http.Client{Timeout: 5 * time.Second} // always bound real calls

    resp, err := client.Get(srv.URL + "/greet?name=Gopher")
    if err != nil {
        fmt.Println("request failed:", err)
        return
    }
    defer resp.Body.Close() // close the body to free the connection

    // A non-2xx status is NOT a Go error — check it explicitly.
    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        fmt.Printf("unexpected status %d: %s\n", resp.StatusCode, body)
        return
    }

    var result struct {
        Message string `json:"message"`
    }
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        fmt.Println("decode failed:", err)
        return
    }
    fmt.Println("status:", resp.StatusCode)
    fmt.Println("message:", result.Message)

    // Demonstrate the error path too: missing query parameter -> 400.
    bad, err := client.Get(srv.URL + "/greet")
    if err != nil {
        fmt.Println("request failed:", err)
        return
    }
    defer bad.Body.Close()
    fmt.Println("missing-name status:", bad.StatusCode)
}
```

---

## Explanation

The broken version dials an external host (which would fail in a sandbox anyway) but, more importantly, demonstrates the two bugs that bite real services. It never closes `resp.Body`, so the underlying TCP connection is never released back to the pool — under any real traffic this leaks connections and file descriptors until the process can no longer make requests. And it never inspects `resp.StatusCode`. Because `http.Get` returns `err == nil` for *any* completed HTTP exchange — including a `500 Internal Server Error` serving an HTML error page — the code happily treats that error page as valid data. The `err` return only covers transport failures, not HTTP-level failures, and conflating the two is the most common `net/http` mistake.

The correct version is fully self-contained: it builds a small JSON handler, starts a *real* server with `httptest.NewServer` on a loopback port, and then acts as its own client against that server's URL. On the server side it sets the status and `Content-Type` header before writing the body, then streams JSON straight to the `http.ResponseWriter` (an `io.Writer`) via `json.NewEncoder`. On the client side it uses an `http.Client` with an explicit `Timeout`, defers `resp.Body.Close()` the instant the error check passes, and checks `resp.StatusCode` before decoding. It also exercises the error path by requesting `/greet` with no `name`, showing the handler return a `400` via `http.Error`. `defer srv.Close()` shuts everything down so the program exits promptly.

---

## Design Tradeoff

The core tradeoff in `net/http` is *explicitness over magic*. A framework like Spring or Django will auto-bind request parameters, validate them, manage the response lifecycle, and close bodies for you behind annotations and conventions. Go gives you the raw request/response over `io` and asks you to do that bookkeeping yourself: check the status code, close the body, set headers in the right order. This is more code and more opportunities to forget a `defer`, which is precisely why "forgot to close `resp.Body`" is a rite of passage. But the payoff is that there is no hidden control flow — every byte read, every header set, every connection closed is visible in your code, which makes HTTP behavior in Go unusually easy to reason about and debug.

The second tradeoff is the standard-library-first philosophy. Because `net/http` is built on the one-method `Handler` interface, routing and middleware are just ordinary Go composition, and you can run serious production services with zero dependencies. The cost is that conveniences other ecosystems bundle — declarative validation, ORM wiring, dependency injection — you assemble by hand or pull in as small, focused libraries. Go considers this a feature: fewer dependencies, no framework lock-in, and a request lifecycle you can read top to bottom. The discipline it demands (close bodies, check statuses, set timeouts) is the same discipline that makes the resulting services predictable under load.

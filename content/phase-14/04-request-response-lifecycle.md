---
id: request-response-lifecycle
phase: 14
phase_title: Building Web Services (Standard Library First)
sequence: 4
title: Request/Response Lifecycle
---

## Description

### Concept Overview

When an HTTP request arrives at a Go server, a precise sequence of events unfolds: the connection is accepted, the request line and headers are parsed into an `*http.Request`, your handler is invoked with a `ResponseWriter`, you write headers and a status and a body, and finally the response is flushed back to the client. Understanding this lifecycle — and especially its *ordering constraints* — is what separates code that "works on my machine" from code that behaves correctly under real traffic.

The single most important rule of the lifecycle is this: **a response is sent in order — status line first, then headers, then body — and once a part is sent, it cannot be taken back.** Most HTTP bugs in Go come from violating this ordering: setting a header after the body has started, or writing a status code after bytes have already gone out. This kata walks the lifecycle end to end and shows how to respect it.

### Technical Explanation

**Anatomy of `*http.Request`**: The request object the server hands you carries everything about the incoming call:
- `r.Method` — the HTTP verb (`GET`, `POST`, ...).
- `r.URL` — a parsed `*url.URL`; `r.URL.Path` is the path, `r.URL.Query()` returns the query parameters.
- `r.Header` — a `map[string][]string` of request headers (use `r.Header.Get("Name")` for the common single-value case).
- `r.Body` — an `io.ReadCloser` streaming the request body. You read it once; reading it again yields nothing. The server closes it, but it is fine to close it yourself.
- `r.Context()` — the request's `context.Context`, cancelled when the client disconnects or the server times out.

**Reading the body**: For small bodies, `io.ReadAll(r.Body)` is fine, but you should bound it with `http.MaxBytesReader(w, r.Body, limit)` so a malicious client cannot exhaust memory by sending a giant body. For form data, `r.ParseForm()` populates `r.Form`; for JSON, decode `r.Body` with `json.NewDecoder`.

**The `ResponseWriter` interface** has exactly three methods:
```go
type ResponseWriter interface {
    Header() http.Header        // the response header map (mutate before writing body)
    Write([]byte) (int, error)  // writes body bytes; first call commits status+headers
    WriteHeader(statusCode int) // sends the status line + headers
}
```

**The strict ordering of a response**:
1. Set headers by mutating `w.Header()` (e.g. `w.Header().Set("Content-Type", "application/json")`). This must happen *before* step 2 or 3.
2. Optionally call `w.WriteHeader(statusCode)` to send the status line and all headers set so far. If you skip this, the first `w.Write` sends an implicit `200 OK`.
3. Call `w.Write(...)` (or `fmt.Fprintf(w, ...)`, `json.NewEncoder(w).Encode(...)`) to stream the body.

Once step 2 or step 3 has happened, the status and headers are committed and on the wire. Calling `w.WriteHeader` again, or mutating `w.Header()`, has no effect (and the runtime logs `superfluous response.WriteHeader call`).

**Streaming and flushing**: The server buffers some output, but you can stream a long response by writing in chunks; if the underlying writer supports `http.Flusher`, you can force intermediate flushes (`w.(http.Flusher).Flush()`) for things like server-sent events. Each handler runs in its own goroutine, so streaming one client does not block others.

**Connection reuse (keep-alive)**: HTTP/1.1 connections are reused for multiple requests by default. The server reads the next request on the same connection after your handler returns and the body is fully consumed/closed. This is why `IdleTimeout` on the server matters: it bounds how long an idle keep-alive connection may linger.

**Helpers**: `http.Error(w, msg, code)` sets `Content-Type: text/plain`, calls `WriteHeader(code)`, and writes the message — in the correct order. `http.Redirect(w, r, url, code)` writes a `Location` header and the redirect status. Using these helpers keeps you on the right side of the ordering rules.

### Design Rationale

Go models the response as a *write-once, append-only stream* rather than a mutable object you build up and "send" at the end. This mirrors what actually happens on the wire: HTTP/1.1 sends the status line, then the header block, then the body, in that order, and a real network connection cannot un-send bytes. Go's `ResponseWriter` interface makes this physical reality visible in the API instead of hiding it.

Contrast this with frameworks that present a mutable response object. In **Express**, you can call `res.status(404).json({...})` and the framework buffers and reorders for you, which is convenient but can mask the fact that headers are committed once the body flushes. In **Spring**, you often return a `ResponseEntity` object that the framework serializes later, fully decoupling your code from wire ordering. **Flask** lets you return a `(body, status, headers)` tuple that it assembles afterward. These abstractions are ergonomic, but they hide the lifecycle, and when something streams or flushes early, the leak in the abstraction is confusing.

Go's choice is, characteristically, to expose the truth: you are writing to a stream, order matters, and the type system gives you a three-method interface that makes the order explicit. The tradeoff is that you must understand the lifecycle — but once you do, there is no mystery about why a header "did not take." This is "explicit over clever" applied to HTTP: the API is honest about the medium.

### Common Mistakes

**Setting a header after writing the body**: `w.Write(...)` (or the first `fmt.Fprintf(w, ...)`) commits the headers. Any `w.Header().Set(...)` after that is silently dropped. Why it fails: the header block is already flushed to the client; there is nowhere to put a new header.

**Calling `WriteHeader` after the body has started**: The first body write sends an implicit `200`. A later `w.WriteHeader(500)` is too late and logs `superfluous response.WriteHeader call`. Why it fails: the status line is sent before the body and cannot change once bytes follow it.

**Reading `r.Body` twice**: `r.Body` is a one-shot stream. After `io.ReadAll(r.Body)`, a second read returns nothing. Why it fails: the body is an `io.Reader` over the connection, not a re-readable buffer; once consumed it is gone.

**Not limiting body size**: Reading an unbounded `r.Body` with `io.ReadAll` lets a client send gigabytes and exhaust memory. Wrap with `http.MaxBytesReader`. Why it fails: there is no implicit size cap; the default is "read whatever the client sends."

**Forgetting that `r.Context()` is cancelled on client disconnect**: Long handlers that ignore `r.Context()` keep doing work (and holding resources) after the client has hung up. Why it fails: the context is your signal that the request is abandoned; ignoring it wastes work and can leak goroutines.

### Key Takeaways

- A response is an ordered stream: set headers, then optionally `WriteHeader(status)`, then `Write(body)` — never out of order.
- The first `Write` (or `WriteHeader`) commits the status and headers; nothing can change them afterward.
- `*http.Request` exposes method, URL, headers, a one-shot `Body`, and a `Context()` that cancels on disconnect or timeout.
- Bound request bodies with `http.MaxBytesReader`; do not `io.ReadAll` an unbounded body.
- Use `http.Error` and `http.Redirect` to stay on the correct side of the ordering rules automatically.
- Handlers run concurrently and connections are reused (keep-alive); respect `r.Context()` for long-running work.

---

## Broken Code

```go
// broken: violates response ordering and reads the body twice.
package main

import (
    "fmt"
    "io"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
    // Bug: reading the body to completion here...
    body, _ := io.ReadAll(r.Body)
    fmt.Println("first read:", len(body))

    // Bug: ...then trying to read it AGAIN yields nothing (one-shot stream).
    again, _ := io.ReadAll(r.Body)
    fmt.Println("second read:", len(again)) // always 0

    // Bug: first Fprintf commits a 200 OK and flushes headers.
    fmt.Fprintln(w, "processing...")

    // Bug: header set AFTER body started — silently ignored.
    w.Header().Set("Content-Type", "application/json")

    // Bug: status set AFTER body started — "superfluous WriteHeader" + ignored.
    w.WriteHeader(http.StatusAccepted)
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", handler)
    http.ListenAndServe(":8080", mux)
}
```

---

## Correct Code

```go
// correct: respects response ordering, bounds the body, reads it once,
// and honors the request context, exercised by an in-process request.
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net"
    "net/http"
    "strings"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    // Bound the body so a huge request cannot exhaust memory.
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB cap

    // Read the body exactly once.
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
        return
    }

    // Respect cancellation: if the client is gone, stop early.
    select {
    case <-r.Context().Done():
        return
    default:
    }

    // CORRECT ORDER: headers first, then status, then body.
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    w.WriteHeader(http.StatusOK)

    resp := map[string]any{
        "method":       r.Method,
        "path":         r.URL.Path,
        "query_q":      r.URL.Query().Get("q"),
        "received_len": len(body),
    }
    // Encoding to w writes the body; this is the last step.
    _ = json.NewEncoder(w).Encode(resp)
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("POST /echo", handler)

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

    serveErr := make(chan error, 1)
    go func() { serveErr <- srv.Serve(ln) }()

    client := &http.Client{Timeout: 3 * time.Second}
    resp, err := client.Post(base+"/echo?q=hello", "text/plain", strings.NewReader("payload-body"))
    if err != nil {
        fmt.Println("request error:", err)
    } else {
        out, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        fmt.Printf("status:       %s\n", resp.Status)
        fmt.Printf("content-type: %s\n", resp.Header.Get("Content-Type"))
        fmt.Printf("body:         %s", string(out))
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

The broken version violates the lifecycle in two ways. First, it reads `r.Body` to completion, then tries to read it again — but `r.Body` is a one-shot stream over the connection, so the second `io.ReadAll` always returns zero bytes. There is no rewind. Second, and more insidiously, it writes the body with `fmt.Fprintln(w, "processing...")` *before* setting the `Content-Type` header and *before* calling `WriteHeader(202)`. That first write commits an implicit `200 OK` and flushes the header block, so the later `Header().Set` is silently dropped and the later `WriteHeader` is both ignored and logged as a `superfluous response.WriteHeader call`. The client receives a `200` with a `text/plain` default content type — the exact opposite of what the code appears to intend.

The correct version respects every ordering constraint. It first wraps `r.Body` with `http.MaxBytesReader` to cap the request at 1 MiB, defending against memory exhaustion, then reads the body exactly once and handles the over-limit error with `http.Error` (which itself writes status and body in the right order). It checks `r.Context().Done()` so that if the client has already disconnected, the handler bails out instead of doing useless work. Then it follows the canonical sequence: set the `Content-Type` header, call `WriteHeader(http.StatusOK)`, and only then stream the JSON body with `json.NewEncoder(w).Encode(...)`. Because headers and status are set before any body byte, they take effect exactly as written.

The runnable harness posts a small body with a query parameter to the in-process server, prints the response status, content type, and body, then shuts the server down gracefully. The output confirms the header and status were honored because they were written in the correct order.

---

## Design Tradeoff

Treating the response as an ordered, write-once stream costs you the convenience of a mutable response object you can tweak until the last moment. In a framework that buffers the whole response, you can set a header, write some body, change your mind, and override the status — the framework sorts it out before sending. Go does not do that by default: once you write, you are committed. The tradeoff is mental overhead — you must plan the response order — in exchange for an API that never lies about what the network is doing and never silently buffers your entire response in memory.

That honesty pays off precisely in the hard cases: streaming large files, server-sent events, and long-lived responses, where a buffer-everything model would blow up memory or add latency. Because Go exposes the stream directly (and `http.Flusher` lets you push bytes as they are ready), you can build efficient streaming handlers with the same primitives you use for tiny JSON responses. The discipline of "headers and status before body" is a small, learnable rule, and once internalized it eliminates an entire class of confusing, silent bugs — a classic Go trade of a little upfront rigor for a lot of downstream predictability.

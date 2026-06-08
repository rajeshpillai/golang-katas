---
id: routing-basics
phase: 14
phase_title: Building Web Services (Standard Library First)
sequence: 3
title: Routing Basics
---

## Description

### Concept Overview

Routing is how a web server decides which handler should respond to a given request. A request for `GET /users/42` should reach a different handler than `POST /users` or `GET /health`. The component that makes this decision is the router — in the standard library, that is `http.ServeMux`.

For most of Go's history, `ServeMux` was deliberately minimal: it matched on URL path only, with no awareness of the HTTP method and no path parameters. That minimalism is exactly why third-party routers like `gorilla/mux`, `chi`, and `httprouter` became popular. But Go 1.22 substantially upgraded `ServeMux` with **method-aware patterns** and **path wildcards**, bringing the most-wanted routing features into the standard library. This kata teaches `ServeMux` routing — both the long-standing rules and the new Go 1.22 capabilities — so you can route real services with zero dependencies.

### Technical Explanation

**Registering routes**: You register handlers on a mux with `mux.Handle(pattern, handler)` (takes an `http.Handler`) or `mux.HandleFunc(pattern, fn)` (takes a function and wraps it in `HandlerFunc`). A request is dispatched to the handler whose pattern best matches.

**Classic path matching** (all Go versions): A pattern ending in `/` is a *subtree* (prefix) match — `/static/` matches `/static/css/app.css`. A pattern not ending in `/` is an *exact* match — `/health` matches only `/health`. When multiple patterns match, the **longest (most specific)** pattern wins. So `/users/` and `/users/admin` can coexist, and `/users/admin` takes precedence for that exact path.

**Go 1.22 method-aware patterns**: A pattern may now start with an HTTP method:

```go
mux.HandleFunc("GET /users/{id}", getUser)
mux.HandleFunc("POST /users", createUser)
mux.HandleFunc("DELETE /users/{id}", deleteUser)
```

A method-prefixed pattern matches only that method. If a path matches but the method does not, `ServeMux` automatically responds `405 Method Not Allowed` and sets the `Allow` header listing the methods that *are* registered for that path — behavior you previously had to implement yourself.

**Go 1.22 path wildcards**: A `{name}` segment captures a single path segment, read with `r.PathValue("name")`. A trailing `{name...}` captures the remaining path (including slashes). For example `GET /files/{path...}` matches `/files/a/b/c.txt`, and `r.PathValue("path")` returns `a/b/c.txt`. A literal `{$}` at the end (as in `GET /{$}`) matches *only* the exact path with nothing after it, which lets you register a handler for `/` that does not also greedily match every unrouted path.

**Precedence with wildcards**: When two patterns overlap, the more specific one wins. `GET /users/me` beats `GET /users/{id}` for the path `/users/me`, because a literal segment is more specific than a wildcard. If two patterns are equally specific and could both match the same request, registering them is a conflict and `ServeMux` panics at registration time — surfacing the ambiguity immediately rather than at request time.

**Host-based patterns**: A pattern may include a host, like `example.com/path`, to route based on the `Host` header. This is rarely needed but available.

**The mux is itself a `Handler`**: `ServeMux` implements `ServeHTTP`, so you can nest muxes, wrap a mux in middleware, or mount one mux inside another. This composability is the same `Handler`-interface principle seen everywhere in `net/http`.

### Design Rationale

The original `ServeMux` was intentionally bare-bones because Go's designers preferred to ship a small, correct core and let the community experiment with richer routers. That philosophy worked: the ecosystem produced excellent routers, and the lessons learned fed back into the standard library. Go 1.22's enhanced routing is the result of years of community experience distilled into a careful, conservative addition that stays backward compatible.

Compare this to other ecosystems. **Express** has always had method-aware routing (`app.get`, `app.post`) and `:param` path parameters built in, but Express is a framework you add as a dependency. **Spring** uses annotation-based routing (`@GetMapping("/users/{id}")`) that relies on reflection and component scanning — powerful but opaque. **Flask** uses decorators (`@app.route("/users/<id>")`). In all three, routing is a framework feature with framework semantics.

Go's approach keeps routing in the standard library, where it interoperates with everything and adds no dependency. The Go 1.22 syntax (`GET /users/{id}`) is deliberately string-based and declarative, matching the simplicity of the rest of `net/http`. It does not try to be the most feature-rich router — there is no regex constraint on path parameters, no route grouping API — because the Go philosophy is to provide enough for the common case and let you compose the rest. If you genuinely need regex routes or elaborate grouping, a third-party router is one import away, and it will still speak the same `Handler` interface.

### Common Mistakes

**Expecting a trailing-slash pattern to match the bare path**: A pattern `/users/` (subtree) matches `/users/` and `/users/123` but, by default, a request to `/users` (no slash) is *redirected* to `/users/`. Conversely, an exact pattern `/users` does not match `/users/foo`. Mixing these up leads to surprise `301` redirects or `404`s. Why it fails: the trailing slash changes the match from exact to subtree.

**Forgetting that pre-1.22 `ServeMux` ignores the method**: On older code (or if you write a bare `/users` pattern without a method), the same handler receives `GET`, `POST`, `DELETE`, and everything else. If you do not check `r.Method` yourself, you may perform a mutation on a `GET`. Why it fails: a method-less pattern matches all methods.

**Routing conflicts that panic at startup**: Registering two equally specific overlapping Go 1.22 patterns (e.g. `GET /a/{x}` and `GET /{y}/b` for `/a/b`) causes `ServeMux` to panic when the routes are registered. Why it fails: the mux refuses ambiguous routing tables rather than guessing.

**Reading a path value that was never declared**: Calling `r.PathValue("id")` when the matched pattern has no `{id}` wildcard returns an empty string, not an error — easy to misread as "the id was empty." Why it fails: `PathValue` returns the zero value (`""`) for unknown names.

**Catching every path with `/` unintentionally**: Registering `GET /` as a subtree matches *every* unrouted path, swallowing what should be `404`s. Use `GET /{$}` if you want only the exact root. Why it fails: `/` is the broadest possible subtree pattern.

### Key Takeaways

- `http.ServeMux` is the standard-library router; it dispatches requests to handlers by pattern, longest/most-specific match winning.
- A trailing `/` makes a pattern a subtree (prefix) match; no trailing slash makes it an exact match.
- Go 1.22 added method-aware patterns (`GET /users/{id}`), path wildcards read via `r.PathValue`, trailing `{name...}`, and `{$}` for exact-root matching.
- Method mismatches automatically return `405 Method Not Allowed` with an `Allow` header in Go 1.22.
- Overlapping equally-specific patterns cause a panic at registration time, surfacing ambiguity early.
- The mux is itself an `http.Handler`, so it nests and composes with middleware like any other handler.

---

## Broken Code

```go
// broken: a single method-blind route that mutates state on ANY verb,
// and a catch-all "/" that swallows every path including unrouted ones.
package main

import (
    "fmt"
    "net/http"
)

var users = map[string]string{}

func main() {
    mux := http.NewServeMux()

    // Bug: no method in the pattern, so GET, POST, DELETE all hit this.
    // A simple GET will happily delete or overwrite data.
    mux.HandleFunc("/users/", func(w http.ResponseWriter, r *http.Request) {
        id := r.URL.Path[len("/users/"):] // manual, error-prone path parsing
        delete(users, id)                 // mutation on EVERY method!
        fmt.Fprintln(w, "deleted", id)
    })

    // Bug: "/" is a subtree pattern that matches EVERYTHING, so requests
    // that should 404 (e.g. /nonsense) are silently handled here instead.
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "home")
    })

    http.ListenAndServe(":8080", mux)
}
```

---

## Correct Code

```go
// correct: Go 1.22 method-aware routing with path wildcards, exact-root
// matching via {$}, and automatic 405 handling, exercised in-process.
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
    mux := http.NewServeMux()

    // Exact root only ({$}), so it does not swallow unrouted paths.
    mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "home")
    })

    // Method-aware + path wildcard. Only GET reaches here.
    mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
        id := r.PathValue("id")
        fmt.Fprintf(w, "get user %s\n", id)
    })

    // A more specific literal route wins over the wildcard for /users/me.
    mux.HandleFunc("GET /users/me", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "get current user")
    })

    // Different verb, same path: only POST reaches here.
    mux.HandleFunc("POST /users", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusCreated)
        fmt.Fprintln(w, "created user")
    })

    // Trailing wildcard captures the remaining path including slashes.
    mux.HandleFunc("GET /files/{path...}", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintf(w, "serving file: %s\n", r.PathValue("path"))
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

    serveErr := make(chan error, 1)
    go func() { serveErr <- srv.Serve(ln) }()

    client := &http.Client{Timeout: 3 * time.Second}

    get := func(path string) {
        resp, err := client.Get(base + path)
        if err != nil {
            fmt.Println("error:", err)
            return
        }
        body, _ := io.ReadAll(resp.Body)
        resp.Body.Close()
        fmt.Printf("GET %-18s -> %s %s", path, resp.Status, string(body))
    }

    get("/")              // home
    get("/users/42")      // get user 42
    get("/users/me")      // more specific literal wins
    get("/files/a/b.txt") // trailing wildcard
    get("/nonsense")      // 404, not swallowed by a catch-all

    // Wrong method on a known path -> automatic 405 with Allow header.
    resp, err := client.Get(base + "/users") // only POST is registered
    if err == nil {
        resp.Body.Close()
        fmt.Printf("GET %-18s -> %s (Allow: %s)\n", "/users", resp.Status, resp.Header.Get("Allow"))
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

The broken version routes by path only and parses parameters by hand. Its `/users/` handler has no method in the pattern, so it fires on `GET`, `POST`, and `DELETE` alike — and it performs a destructive `delete(users, id)` on *every* request, meaning a harmless-looking `GET /users/42` deletes user 42. It also extracts the id by slicing the raw URL path, which is fragile and easy to get wrong. Finally, its `/` handler is a subtree pattern that matches *every* path the other routes did not, so requests to nonexistent paths like `/nonsense` are quietly answered with "home" instead of a proper `404`.

The correct version uses Go 1.22 routing to fix all of this declaratively. `GET /{$}` matches only the exact root, so it no longer swallows unrouted paths — `/nonsense` correctly returns `404`. `GET /users/{id}` is method-scoped (only `GET` reaches it) and exposes the id safely via `r.PathValue("id")` with no manual string slicing. `GET /users/me` is a more specific literal route that wins over the `{id}` wildcard for that exact path, demonstrating precedence. `POST /users` shares the `/users` path but a different verb, and because the mux is method-aware, a `GET /users` automatically returns `405 Method Not Allowed` with an `Allow: POST` header — generated by the standard library, not by hand. `GET /files/{path...}` shows the trailing wildcard capturing a multi-segment path.

The program exercises each route in-process and prints the results, so you can see the precedence rules, the `404` for unrouted paths, and the automatic `405`, then it shuts the server down gracefully. No third-party router is involved — this is all `net/http`.

---

## Design Tradeoff

The standard `ServeMux`, even after the Go 1.22 upgrade, deliberately stops short of being a full-featured router. It has no regex constraints on path parameters, no built-in route groups or sub-routers with shared prefixes-plus-middleware, and no named-route reverse URL generation. Those omissions are a tradeoff: the standard library favors a small, predictable, conflict-detecting router over a kitchen-sink one. For the overwhelming majority of services, method-aware patterns and path wildcards are exactly enough, and you ship with zero dependencies.

When you genuinely need more — heavy route grouping, regex path constraints, or ergonomic middleware-per-group — a third-party router like `chi` remains a reasonable choice, and crucially it still implements `http.Handler`, so it slots into the same server and the same middleware you already wrote. The Go lesson is to *start* with `ServeMux`: it is dependency-free, it now detects ambiguous routes at startup, and it covers the common case cleanly. Reach for a framework router only when a concrete need appears, not preemptively — standard library before frameworks.

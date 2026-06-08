---
id: error-handling-in-io
phase: 13
phase_title: Files, Networking & IO
sequence: 5
title: Error Handling in IO-Heavy Code
---

## Description

### Concept Overview

IO is where errors are not the exception — they are routine. Files vanish, disks fill, networks drop, peers close, reads come back partial, and streams end. Code that touches the outside world spends as much effort on its failure paths as on its happy path, and Go's design forces you to confront that head-on: nearly every IO call returns an `error`, and the language gives you no way to pretend it does not exist. This kata is about handling those errors *correctly* and *idiomatically*, which in IO-heavy code means knowing the difference between a real failure, a normal end-of-stream, and a recoverable hiccup.

The central skills are: distinguishing `io.EOF` (and `io.ErrUnexpectedEOF`) from genuine errors, processing the byte count before the error on every `Read`, wrapping errors with context using `fmt.Errorf("...: %w", err)` so the failure can be traced, inspecting them with `errors.Is` and `errors.As`, and guaranteeing cleanup with `defer` — including capturing the error that `Close` itself can return. Get these right and IO code becomes robust; get them wrong and you get the silent data corruption and resource leaks that haunt production systems.

### Technical Explanation

**`io.EOF` is a value, not a failure.** `io.EOF` is a sentinel error variable that means "the stream has no more data." It is the *expected* terminator of every successful read loop. The contract of `Read` allows it to be returned alongside data in the same call: a `Read` may return `(5, io.EOF)`. Therefore the correct loop processes the `n` bytes first, *then* checks the error, and treats `io.EOF` as a clean stop:

```go
for {
    n, err := r.Read(buf)
    if n > 0 {
        process(buf[:n]) // always handle bytes first
    }
    if err != nil {
        if errors.Is(err, io.EOF) {
            break // normal end
        }
        return err // real failure
    }
}
```

**`io.ErrUnexpectedEOF` means truncation.** When a reader hits end-of-stream in the *middle* of something it was promised more of — for example `io.ReadFull` was asked for 100 bytes but got 60 — it returns `io.ErrUnexpectedEOF`. This is a genuine error: the data is incomplete. Distinguishing it from plain `io.EOF` is how you detect a truncated file or a connection that dropped mid-message.

**Wrap errors to add context.** A bare `open /etc/app/config.yaml: no such file or directory` from deep in a call stack is useless without knowing *which* operation failed. Go's idiom is to wrap: `fmt.Errorf("loading config %q: %w", path, err)`. The `%w` verb preserves the original error so it can still be matched later, while the surrounding text builds a breadcrumb trail as the error propagates up.

**Inspect with `errors.Is` and `errors.As`.** Because wrapping nests errors, you must not compare with `==`. Use `errors.Is(err, io.EOF)` to test against a sentinel value through any number of wraps, and `errors.As(err, &pathErr)` to extract a typed error (like `*os.PathError`, which carries the operation, path, and underlying OS error). For OS-level conditions there are helpers: `errors.Is(err, os.ErrNotExist)`, `os.ErrPermission`, and so on.

**Network errors implement `net.Error`.** A network failure can be transient. The `net.Error` interface exposes `Timeout() bool`, letting you distinguish a deadline expiry (often worth retrying) from a permanent failure. You extract it with `errors.As(err, &netErr)`.

**`Close` returns an error, and on writes it matters.** For a file or buffered writer, the final flush to disk happens during `Close`. A `Close` that fails means bytes were lost. The naive `defer f.Close()` discards that error. When the file is written, the idiom is to capture it — often via a named return value in a `defer` — so a failed flush surfaces instead of silently corrupting your output.

### Design Rationale

Go's explicit, value-based error handling is most vindicated precisely in IO code, where failure is constant and varied. Other languages funnel IO failures through exceptions, which hides exactly the control flow you most need to see.

**Java** throws checked `IOException` (and its many subclasses) from nearly every IO call. Checked exceptions force *acknowledgement* but encourage the empty `catch` block and the catch-all `catch (Exception e)` that swallows distinctions you cared about. The happy path and the error path live in separate syntactic worlds (the `try` and the `catch`), so reading a method top-to-bottom does not reveal where it can fail.

**Python** raises `IOError`/`OSError`, and the temptation is the bare `except:` that hides which operation failed and why. End-of-file is signaled by an empty read, not an exception, mixing two error models.

**Node.js** historically used error-first callbacks (`(err, data) => ...`) — explicit but pyramid-shaped — and now promises with `try/catch` around `await`, which reintroduces the exception model's invisibility of failure points.

Go's choice — return errors as ordinary values, make the caller handle them inline, and provide `EOF` as a value rather than an exception — keeps the failure path *visible at the call site*. You can see, reading straight down a function, every place it can fail and exactly how it responds. The wrapping/`errors.Is`/`errors.As` machinery then lets errors carry rich context and be inspected precisely without the brittleness of string matching or the bluntness of catch-all handlers. The cost is verbosity — `if err != nil` appears constantly — and Go accepts that cost deliberately, because in IO-heavy code the alternative is hidden failure, and hidden failure in IO means lost data and leaked resources.

### Common Mistakes

**Treating `io.EOF` as an error to report.** *Why it fails:* `io.EOF` ends every successful read; if your error branch fires on it, you log spurious failures on every complete file and may abort processing that actually succeeded. Branch on `errors.Is(err, io.EOF)` and stop cleanly.

**Comparing wrapped errors with `==`.** Writing `if err == io.EOF` (or `err == sql.ErrNoRows`) after the error has been wrapped with `%w`. *Why it fails:* wrapping nests the sentinel inside a new error value, so `==` no longer matches and your check silently never fires. Use `errors.Is`, which unwraps.

**Checking the error before processing `n` bytes.** *Why it fails:* `Read` can return data *and* `io.EOF` together; if you `break` on the error before handling `buf[:n]`, you drop the final chunk of every stream. Always process `n` first.

**Swallowing the `Close` error on a writer.** A plain `defer f.Close()` on a file you wrote to. *Why it fails:* the last buffered bytes are flushed during `Close`; if that flush fails (disk full, network drop) and you discarded the error, you have silently written a corrupt or truncated file and reported success. Capture and check it.

**Losing context by returning the bare error.** *Why it fails:* an unwrapped `no such file` three layers deep gives no clue which file or which operation; debugging becomes archaeology. Wrap with `fmt.Errorf("...: %w", err)` at each layer that adds meaningful context.

### Key Takeaways

- IO errors are routine, not exceptional — design the failure path as deliberately as the happy path, because Go gives you no way to ignore it.
- `io.EOF` is the normal end-of-stream signal; `io.ErrUnexpectedEOF` means truncation. Distinguish them with `errors.Is`.
- On every `Read`, process the `n` bytes *before* inspecting the error, because data and `io.EOF` can arrive together.
- Wrap errors with `fmt.Errorf("...: %w", err)` to add context, and inspect them with `errors.Is` (sentinels) and `errors.As` (typed errors like `*os.PathError`, `net.Error`).
- Never compare wrapped errors with `==`; wrapping breaks `==`, and `errors.Is` is the correct, unwrap-aware test.
- For files you write, capture the `Close` error — the final flush happens there, so a swallowed `Close` error means silently corrupted output.

---

## Broken Code

```go
// broken: aborts on io.EOF, compares a wrapped error with ==, checks the error
// before using n, and swallows the Close error on a file it wrote.
package main

import (
    "fmt"
    "io"
    "os"
)

func readAll(path string) (string, error) {
    f, err := os.Open(path)
    if err != nil {
        return "", err // broken: no context — which path? which operation?
    }
    defer f.Close() // broken on writers: swallows the flush/Close error

    var out []byte
    buf := make([]byte, 16)
    for {
        n, err := f.Read(buf)
        // broken: checks error BEFORE using n — drops the final chunk
        if err != nil {
            // broken: == fails once the error is wrapped; and io.EOF is normal,
            // not a failure to return
            if err == io.EOF {
                return "", err
            }
            return "", err
        }
        out = append(out, buf[:n]...)
    }
}

func main() {
    s, err := readAll("missing.txt")
    fmt.Println(s, err)
}
```

---

## Correct Code

```go
// correct: robust IO error handling — process n before err, treat io.EOF as a
// clean stop, wrap with context, inspect with errors.Is/As, and capture the
// Close error on the file we write.
package main

import (
    "errors"
    "fmt"
    "io"
    "os"
    "path/filepath"
)

// writeFile writes data and returns a named error so the deferred Close can
// surface a failed final flush instead of silently losing bytes.
func writeFile(path string, data []byte) (err error) {
    f, createErr := os.Create(path)
    if createErr != nil {
        return fmt.Errorf("create %q: %w", path, createErr)
    }
    defer func() {
        // Capture Close's error only if no earlier error already occurred.
        if cerr := f.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close %q: %w", path, cerr)
        }
    }()

    if _, werr := f.Write(data); werr != nil {
        return fmt.Errorf("write %q: %w", path, werr)
    }
    return nil
}

// readAll streams a file, handling n-before-err and io.EOF correctly,
// and wraps failures with context.
func readAll(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, fmt.Errorf("open %q: %w", path, err)
    }
    defer f.Close() // read-only: Close error is not load-bearing here

    var out []byte
    buf := make([]byte, 16) // small buffer to force several reads
    for {
        n, err := f.Read(buf)
        if n > 0 {
            out = append(out, buf[:n]...) // process bytes BEFORE the error
        }
        if err != nil {
            if errors.Is(err, io.EOF) {
                break // normal end of stream
            }
            return nil, fmt.Errorf("read %q: %w", path, err)
        }
    }
    return out, nil
}

func main() {
    dir, err := os.MkdirTemp("", "ioerr-")
    if err != nil {
        fmt.Println("mkdir temp:", err)
        return
    }
    defer os.RemoveAll(dir)

    path := filepath.Join(dir, "note.txt")

    if err := writeFile(path, []byte("io errors are routine, handle them\n")); err != nil {
        fmt.Println("writeFile:", err)
        return
    }

    data, err := readAll(path)
    if err != nil {
        fmt.Println("readAll:", err)
        return
    }
    fmt.Printf("read %d bytes: %s", len(data), data)

    // Demonstrate inspecting a wrapped error: open a file that does not exist.
    _, err = readAll(filepath.Join(dir, "does-not-exist.txt"))
    fmt.Println("expected failure:", err)

    // errors.Is sees through the %w wrapping to the OS sentinel.
    if errors.Is(err, os.ErrNotExist) {
        fmt.Println("classified as: file does not exist")
    }

    // errors.As extracts the typed *os.PathError underneath the wraps.
    var pathErr *os.PathError
    if errors.As(err, &pathErr) {
        fmt.Printf("operation %q failed on path %q\n", pathErr.Op, pathErr.Path)
    }
}
```

---

## Explanation

The broken version packs four IO error-handling bugs into one short function. It checks the error from `Read` *before* appending `buf[:n]`, so on the common case where the final `Read` returns the last bytes together with `io.EOF`, it drops that final chunk. It then returns `io.EOF` as if it were a failure, so a perfectly successful read of a complete file surfaces as an error to the caller. Its `io.EOF` check uses `==`, which works only by luck here and breaks the instant the error is wrapped anywhere in the chain. And it returns every error bare, with no context — the caller sees `no such file` with no hint of which file or which operation, and the `defer f.Close()` would silently swallow a failed flush if the function were ever used to write.

The correct version handles each concern deliberately. `writeFile` uses a *named return value* and a deferred closure so that the error from `Close` — where the final flush to disk actually happens — is captured and surfaced, but only when no earlier error already occurred. `readAll` processes `buf[:n]` *before* it ever looks at the error, guaranteeing the last chunk is never lost, and it treats `io.EOF` as a clean `break` rather than a failure, while wrapping any genuine read error with `fmt.Errorf("read %q: %w", ...)` for context. `main` then demonstrates inspection: it triggers a real failure by opening a nonexistent file and uses `errors.Is(err, os.ErrNotExist)` to classify it through the wrapping, and `errors.As(err, &pathErr)` to pull out the typed `*os.PathError` and read its operation and path. Every resource is deferred-closed and the temp directory removed, so the program is self-contained and exits promptly.

---

## Design Tradeoff

The tradeoff Go makes in error handling is *verbosity for visibility*, and nowhere is the bargain better than in IO code. Every `if err != nil` is a few extra lines, and an IO-heavy function can be half error checks. Critics call this noise. But the alternative — exceptions — hides the failure path in a parallel `catch` world, and in IO the failure path is the part you most need to see, because that is where data gets lost and resources get leaked. By making errors ordinary return values, Go puts every failure point inline, readable top to bottom, with an explicit decision at each one. The `%w` wrapping plus `errors.Is`/`errors.As` then buys back the one thing exceptions did well — rich, inspectable error context — without the invisibility.

The subtler tradeoff is that Go gives you precise tools but does not force you to use them well. Nothing stops you from comparing with `==`, swallowing a `Close` error, or returning bare errors — the compiler is satisfied either way. The discipline is on you. That is the recurring theme of IO in Go: the language guarantees you *cannot ignore that an error exists* (you must at least assign or discard it), but it relies on you to handle it *correctly* — to distinguish `io.EOF` from truncation, to process bytes before errors, to flush before you trust a write. Go judges that this is the right place to draw the line: enforce acknowledgement at the compiler, leave correctness to the engineer, and provide small, composable tools (`errors.Is`, `errors.As`, `%w`) sharp enough to do the job well.

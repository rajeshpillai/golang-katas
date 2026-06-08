---
id: file-io
phase: 13
phase_title: Files, Networking & IO
sequence: 1
title: File IO
---

## Description

### Concept Overview

Reading and writing files is one of the most common things a program does, and Go's approach to it is a perfect introduction to the philosophy that governs all of Go's input and output: small, composable interfaces. In Go, a file is not a magic object with dozens of special methods. An `*os.File` is just a value that happens to satisfy two tiny interfaces — `io.Reader` (it has a `Read` method) and `io.Writer` (it has a `Write` method). Because of this, a file can be plugged into any function in the standard library that accepts a reader or a writer, and so can a network connection, an in-memory buffer, or a compressed stream.

The `os` package gives you the doorway: `os.Open`, `os.Create`, `os.OpenFile`, `os.ReadFile`, and `os.WriteFile`. The `io` package gives you the universal vocabulary: `Reader`, `Writer`, `Copy`, `EOF`. The `bufio` package gives you buffering and convenient line-oriented helpers. Master these three packages together and file IO in Go becomes simple, explicit, and safe.

### Technical Explanation

**Opening and creating files.** `os.Open(name)` opens a file for reading and returns `(*os.File, error)`. `os.Create(name)` creates (or truncates) a file for writing. For anything more nuanced — appending, setting permissions, read-write — you use `os.OpenFile(name, flag, perm)` with flags like `os.O_RDWR|os.O_CREATE|os.O_APPEND` and a Unix permission such as `0o644`. Every one of these returns an error you must check, because the filesystem can fail in dozens of ways: the file does not exist, you lack permission, the disk is full.

**The `*os.File` value satisfies `io.Reader` and `io.Writer`.** Those interfaces are deliberately minimal:

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

`Read` fills the byte slice `p` and returns `n`, the number of bytes actually read, plus an error. The contract is precise and easy to get wrong: `Read` may return `0 < n < len(p)` (a *partial read*), and it may return data *and* `io.EOF` in the same call. You must always process the first `n` bytes of `p` before looking at the error, and you must treat `io.EOF` as the normal, expected signal that the stream has ended — not as a failure.

**`defer f.Close()` is the idiom.** Opening a file consumes an operating-system file descriptor, a finite resource. If you do not close it, you leak the descriptor; leak enough and your process hits its descriptor limit and can no longer open files or sockets. The idiomatic pattern is to `defer f.Close()` immediately after a successful open, so the file is closed when the function returns no matter which path it takes. For files you write, closing also matters for correctness, because buffered writes may not reach disk until `Close` (or `Sync`) flushes them.

**Whole-file convenience.** `os.ReadFile(name)` reads an entire file into a `[]byte` in one call, and `os.WriteFile(name, data, perm)` writes a whole `[]byte` and closes the file for you. These are perfect for small configuration files. They are dangerous for large files because they load everything into memory at once — for big data you stream instead (covered in the Streaming kata).

**Buffering with `bufio`.** Raw `Read`/`Write` calls translate directly into system calls. Reading a 10 MB file one byte at a time would mean ten million syscalls. `bufio.NewReader` and `bufio.NewWriter` wrap a reader/writer with an in-memory buffer, turning many small operations into a few large ones. `bufio.Scanner` builds on this to give you line-by-line iteration with a clean `for scanner.Scan()` loop — by far the most idiomatic way to process text files.

### Design Rationale

Go's IO design rests on one radical idea: define the smallest possible interfaces and let everything compose. Contrast this with the alternatives.

**Java** has a sprawling `java.io` hierarchy — `InputStream`, `FileInputStream`, `BufferedInputStream`, `DataInputStream`, `Reader`, `BufferedReader`, plus the newer `java.nio` channels and an entire `java.nio.file` API. The decorator pattern is powerful but verbose, and the type hierarchy is deep. To read lines from a file you wrap a `FileReader` in a `BufferedReader`, and you must remember which class does what.

**Python** files are convenient (`open(...)` with a context manager) but the file object is a large concrete type with read, readline, readlines, write, seek, and more baked in. Duck typing means "file-like objects" work in many places, but the contract is informal — there is no compiler-checked `Reader` interface, so "file-like" means "has whatever methods this particular function happens to call."

**Node.js** splits IO across callbacks, streams, and promises, with three different styles (`fs.readFile`, `fs.createReadStream`, `fs.promises.readFile`) that behave differently around backpressure and error handling.

Go collapses all of this into two methods. Because `Read` and `Write` are so small, an enormous range of types can implement them, and a single function like `io.Copy(dst, src)` works for *any* reader and *any* writer. The cost is that the low-level contract (partial reads, EOF-with-data) is subtle and you must learn it. The payoff is a standard library where files, sockets, HTTP bodies, gzip streams, and string buffers are all interchangeable.

### Common Mistakes

**Ignoring the `n` return value from `Read`.** `Read` tells you how many bytes it actually placed in your buffer. If you assume it filled the whole slice and process `len(p)` bytes, you will process stale or zero bytes from a previous read on a partial read. *Why it fails:* `Read` is explicitly permitted to return fewer bytes than the buffer can hold, and most real readers (network, pipes, even files near EOF) do. Always slice with `p[:n]`.

**Treating `io.EOF` as an error to log or abort on.** `io.EOF` is not a failure; it is the defined way a stream says "there is no more data." *Why it fails:* if you `return err` on every non-nil error including `io.EOF`, your "error path" fires on every successful read of a complete file, and callers see spurious failures. Compare with `errors.Is(err, io.EOF)` and treat it as a clean stop.

**Forgetting to close the file (or ignoring `Close`'s error on writes).** A leaked descriptor is a slow resource leak; an unchecked `Close` error on a write can silently lose data that was still buffered. *Why it fails:* descriptors are finite, and the final flush to disk happens during `Close`, so a failed `Close` means bytes never landed. `defer f.Close()` is fine for readers; for writers you should capture and check the error.

**Using `os.ReadFile` on huge or untrusted files.** It allocates a slice the size of the whole file. *Why it fails:* a multi-gigabyte file (or an attacker-supplied one) can exhaust memory and crash the process. Stream large inputs instead.

**Assuming a write reached disk just because `Write` returned no error.** Writes can be buffered by `bufio` or by the OS page cache. *Why it fails:* the data may still be in memory; without `Flush` (for `bufio`) and `Close`/`Sync`, a crash loses it.

### Key Takeaways

- An `*os.File` satisfies `io.Reader` and `io.Writer`, so files compose with the entire IO ecosystem through two tiny methods.
- Always check the error from open/read/write/close — the filesystem has many failure modes, and Go makes you confront them.
- `Read` returns the number of bytes read `n`; process `p[:n]` and never assume the whole buffer was filled.
- `io.EOF` is the normal end-of-stream signal, not a failure — handle it deliberately with `errors.Is`.
- `defer f.Close()` immediately after opening prevents descriptor leaks; for writers, check the `Close`/`Flush` error so buffered data is not silently lost.
- Use `os.ReadFile`/`os.WriteFile` for small whole-file work; reach for `bufio` and streaming for large or line-oriented data.

---

## Broken Code

```go
// broken: ignores the byte count from Read and treats EOF as a fatal error,
// and never closes the file — leaking the descriptor.
package main

import (
    "fmt"
    "os"
)

func main() {
    f, err := os.Open("data.txt")
    if err != nil {
        fmt.Println("open failed:", err)
        return
    }
    // broken: no defer f.Close() — descriptor leaks

    buf := make([]byte, 1024)
    for {
        _, err := f.Read(buf) // broken: ignores n, so it prints the WHOLE buffer
        if err != nil {
            // broken: io.EOF is the normal end of stream, not an error to abort on
            fmt.Println("read error, aborting:", err)
            return
        }
        // broken: prints len(buf) bytes even on a partial read, including stale data
        fmt.Print(string(buf))
    }
}
```

---

## Correct Code

```go
// correct: create a temp file, write to it, then read it back two ways —
// streaming with the byte count and EOF handled, then line-by-line with bufio.
package main

import (
    "bufio"
    "errors"
    "fmt"
    "io"
    "os"
    "path/filepath"
)

func main() {
    // Work in a temp dir so the kata is self-contained and leaves no mess.
    dir, err := os.MkdirTemp("", "fileio-")
    if err != nil {
        fmt.Println("mkdir temp:", err)
        return
    }
    defer os.RemoveAll(dir)

    path := filepath.Join(dir, "data.txt")

    // --- Write whole-file the easy way ---
    content := []byte("first line\nsecond line\nthird line\n")
    if err := os.WriteFile(path, content, 0o644); err != nil {
        fmt.Println("write file:", err)
        return
    }

    // --- Read it back as a stream, handling n and io.EOF correctly ---
    f, err := os.Open(path)
    if err != nil {
        fmt.Println("open:", err)
        return
    }
    defer f.Close()

    fmt.Println("=== streamed bytes ===")
    buf := make([]byte, 8) // small buffer on purpose, to force partial reads
    for {
        n, err := f.Read(buf)
        if n > 0 {
            // Process ONLY the bytes that were actually read.
            fmt.Print(string(buf[:n]))
        }
        if err != nil {
            if errors.Is(err, io.EOF) {
                break // normal end of stream
            }
            fmt.Println("read:", err)
            return
        }
    }

    // --- Read it back again, this time line-by-line with bufio.Scanner ---
    if _, err := f.Seek(0, io.SeekStart); err != nil {
        fmt.Println("seek:", err)
        return
    }

    fmt.Println("=== scanned lines ===")
    scanner := bufio.NewScanner(f)
    lineNo := 1
    for scanner.Scan() {
        fmt.Printf("%d: %s\n", lineNo, scanner.Text())
        lineNo++
    }
    if err := scanner.Err(); err != nil {
        fmt.Println("scan:", err)
        return
    }
}
```

---

## Explanation

The broken version makes three classic mistakes at once. First, it never closes the file — there is no `defer f.Close()` — so every call leaks an operating-system file descriptor. Second, it discards the `n` value from `Read` and prints the entire 1024-byte buffer on every iteration. On a partial read (which is the *normal* case as you approach end-of-file, and the guaranteed case for pipes and sockets), this prints leftover bytes from the previous read. Third, it treats *any* non-nil error from `Read` as fatal, including `io.EOF`. But `io.EOF` is exactly how a stream announces it is finished. The result is a program that "reads" a file by printing garbage and then reports the successful completion of the read as an error.

The correct version fixes each point and demonstrates two idiomatic reading styles. It writes the file with `os.WriteFile`, then opens it and reads it back through a deliberately tiny 8-byte buffer so you can see partial reads happen. Crucially, it processes `buf[:n]` — only the bytes actually read — and it checks the error with `errors.Is(err, io.EOF)`, treating EOF as a clean `break` rather than a failure. Note that it processes `n` bytes *before* inspecting the error, because `Read` is allowed to return data and `io.EOF` together. It then rewinds with `Seek` and re-reads the same file using `bufio.Scanner`, the cleanest way to iterate over lines, finishing with the mandatory `scanner.Err()` check. Throughout, `defer os.RemoveAll(dir)` and `defer f.Close()` guarantee cleanup on every return path.

---

## Design Tradeoff

The fundamental tradeoff in Go's file IO is between low-level control and high-level convenience, and Go gives you both ends of the spectrum sitting on the same two interfaces. `os.ReadFile` is one line and reads everything into memory — perfect for a config file, catastrophic for a 50 GB log. The raw `Read` loop is verbose and forces you to handle partial reads and EOF by hand, but it works on streams of unbounded size with a fixed, tiny memory footprint. `bufio.Scanner` sits in the middle, hiding the partial-read bookkeeping while still streaming.

Choosing among them is a real engineering decision, not a style preference. Reaching for `os.ReadFile` because it is shorter is exactly the kind of shortcut that turns into an out-of-memory crash in production. The discipline Go encourages is to think about the *size and shape* of your input: bounded and small means whole-file helpers; unbounded or line-oriented means a streaming reader. The reward for accepting the more explicit `Read` contract is that the same code, once you understand it, works identically for files, network sockets, and HTTP bodies — because they are all just `io.Reader`s.

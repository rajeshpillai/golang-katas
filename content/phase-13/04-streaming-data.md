---
id: streaming-data
phase: 13
phase_title: Files, Networking & IO
sequence: 4
title: Streaming Data
---

## Description

### Concept Overview

Streaming is the discipline of processing data as it flows, in bounded chunks, rather than loading all of it into memory at once. It is the difference between a program that handles a 100 GB file on a machine with 8 GB of RAM and one that crashes trying. In Go, streaming is not a separate API — it is the natural consequence of the `io.Reader` and `io.Writer` interfaces. Because a reader produces bytes on demand and a writer consumes them on demand, you can pipe data from any source to any destination with a fixed, tiny buffer in between.

The workhorse of streaming is `io.Copy(dst, src)`, which reads from a source and writes to a destination in a loop using an internal buffer, never holding more than that buffer in memory regardless of how much data passes through. Around it sits a rich toolkit — `io.MultiWriter`, `io.TeeReader`, `io.LimitReader`, `io.Pipe`, and the `compress/gzip` streams — that lets you build data pipelines by *composing* readers and writers like plumbing, with no source or sink ever needing to know what is on the other end.

### Technical Explanation

**`io.Copy` is the streaming primitive.** Its signature is `io.Copy(dst io.Writer, src io.Reader) (written int64, err error)`. Internally it allocates a buffer (32 KB by default), then loops: `Read` into the buffer, `Write` the bytes that were read, repeat until the source returns `io.EOF`. It returns the total bytes copied and the first error that was not `io.EOF`. The key property is *constant memory*: copying a terabyte uses the same 32 KB as copying a kilobyte. If a type implements the optional `io.WriterTo` or `io.ReaderFrom` interfaces (as `*os.File` and `net.Conn` do), `io.Copy` uses them to copy at the kernel level (e.g. `sendfile`), avoiding the user-space buffer entirely.

**Fan-out and tee.** `io.MultiWriter(w1, w2, ...)` returns a single writer that duplicates every write to all of its targets — write once, land in many places (a file *and* a hash *and* stdout). `io.TeeReader(r, w)` returns a reader that transparently writes everything it reads to `w` as a side effect — perfect for computing a checksum *while* streaming data through to its real destination, without a second pass.

**Bounding the stream.** `io.LimitReader(r, n)` wraps a reader so it returns `io.EOF` after at most `n` bytes. This is essential security hygiene when reading untrusted input (an HTTP request body, a network message): without a limit, a malicious peer can stream forever and exhaust your memory or disk. Pair it with streaming so that even the chunks are bounded.

**Chaining transformations.** Streams compose. `compress/gzip.NewWriter(w)` returns a writer that compresses on the fly and forwards to `w`; `gzip.NewReader(r)` decompresses a stream as it reads. You can stack them: read a file, wrap it in a gzip reader, copy through a `TeeReader` that hashes, into a network connection — each stage handles one chunk at a time. Because every stage is just an `io.Reader` or `io.Writer`, none of them knows or cares what the others are.

**`io.Pipe` connects a writer to a reader in memory.** `io.Pipe()` returns a connected `(*PipeReader, *PipeWriter)`: bytes written to the writer become readable from the reader, with no buffer — writes block until a reader consumes them. This lets you bridge a producer that wants to *write* to a consumer that wants to *read*, typically with the producer running in its own goroutine. It is how you stream the output of one API into the input of another that expects an `io.Reader`.

**Buffering still matters.** `io.Copy` already batches into 32 KB reads, but when you do many small writes yourself (e.g. line-by-line), wrap the destination in a `bufio.Writer` and `Flush()` at the end so you do not make a syscall per line.

### Design Rationale

The genius of Go's streaming model is that *there is no streaming model* — there is just `io.Reader` and `io.Writer`, and streaming falls out for free. Because these interfaces describe "produce some bytes" and "consume some bytes" with no mention of total size, any reader is automatically streamable and composes with any writer. Compare the alternatives.

**Java** has `InputStream`/`OutputStream` for streaming, but also a parallel `Files.readAllBytes` whole-file path, and the newer NIO `Channel`/`ByteBuffer` world with manual buffer flipping. Composition exists via the decorator pattern (`GZIPInputStream` wrapping a `FileInputStream`) but is verbose, and you choose up front which paradigm you are in.

**Node.js** has a genuinely powerful stream abstraction (`Readable`, `Writable`, `pipe`, and `pipeline`) with first-class backpressure, but it is event-driven and callback/promise-based, and getting backpressure and error propagation right across a pipeline is notoriously tricky.

**Python** offers file-like objects and generators, plus libraries like `shutil.copyfileobj` that mirror `io.Copy`, but there is no compiler-enforced interface — "stream-like" is a duck-typing convention.

Go's bet is that two methods are enough. `io.Copy` is a dozen lines of obvious code; `TeeReader`, `MultiWriter`, and `LimitReader` are each tiny adapters. The entire streaming toolkit is small enough to read in an afternoon, yet it composes into arbitrarily complex pipelines. Backpressure is automatic and synchronous: a `Read` blocks until data is available and a `Write` blocks until it is consumed, so a fast producer naturally waits for a slow consumer with no special machinery. The tradeoff is that the synchronous, blocking model means you reach for goroutines (and `io.Pipe`) when you need producer and consumer to run concurrently — but that, too, is just ordinary Go.

### Common Mistakes

**Loading the whole stream with `io.ReadAll` when you only need to forward it.** *Why it fails:* `io.ReadAll` allocates a slice as large as the entire input, defeating the entire point of streaming and risking out-of-memory on large or untrusted data. If you are reading-then-writing, use `io.Copy`, which never buffers more than 32 KB.

**Not handling the error from `io.Copy`.** *Why it fails:* a copy can fail partway — the disk fills, the connection drops — and `io.Copy` returns how many bytes made it plus the error. Ignoring the error means you silently produce a truncated file or partial response and believe it succeeded.

**Forgetting to `Close` (and thus flush) a `gzip.Writer` or `bufio.Writer`.** *Why it fails:* compressors and buffered writers hold pending bytes in memory; the final block is only emitted on `Close`/`Flush`. Skip it and your gzip file is corrupt (missing its trailer) or your buffered output is truncated.

**Streaming untrusted input with no `io.LimitReader`.** *Why it fails:* a malicious or buggy peer can send an unbounded stream; without a limit your "constant memory" copy still writes unbounded bytes to disk or downstream. Cap untrusted readers.

**Using `io.Pipe` without running the writer in a separate goroutine.** *Why it fails:* the pipe is unbuffered, so a write blocks until something reads it. If producer and consumer run on the same goroutine, the first write deadlocks. The producer must run concurrently with the consumer.

### Key Takeaways

- Streaming in Go is just `io.Reader`/`io.Writer` — any reader is streamable and composes with any writer, with no separate API to learn.
- `io.Copy` moves data with constant memory (a 32 KB buffer) no matter the total size; always check the bytes-written and error it returns.
- `io.TeeReader` and `io.MultiWriter` fan data out (hash while you copy, write to many sinks at once) in a single pass.
- Wrap untrusted readers in `io.LimitReader` so a hostile stream cannot exhaust memory or disk.
- `gzip.Writer` and `bufio.Writer` buffer internally — you must `Close`/`Flush` them or the output is truncated/corrupt.
- `io.Pipe` connects a writer to a reader in memory; run the producing side in its own goroutine because the pipe is unbuffered.

---

## Broken Code

```go
// broken: reads an entire (potentially huge) stream into memory just to write
// it back out, and ignores the copy error so truncation goes unnoticed.
package main

import (
    "io"
    "os"
)

func copyFile(src io.Reader, dst io.Writer) {
    // broken: io.ReadAll allocates a buffer the size of the ENTIRE input;
    // a multi-GB stream blows up memory and defeats the point of streaming.
    data, _ := io.ReadAll(src) // broken: ignores read error too

    // broken: ignores the write error — a full disk silently truncates output
    dst.Write(data)
}

func main() {
    in, _ := os.Open("huge.bin") // broken: ignores open error
    out, _ := os.Create("copy.bin")
    copyFile(in, out)
    // broken: never closes in/out — descriptors leak, buffered bytes may be lost
}
```

---

## Correct Code

```go
// correct: stream a file through a gzip compressor while simultaneously
// computing its checksum, all with constant memory and full error handling.
package main

import (
    "compress/gzip"
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "io"
    "os"
    "path/filepath"
)

func main() {
    dir, err := os.MkdirTemp("", "stream-")
    if err != nil {
        fmt.Println("mkdir temp:", err)
        return
    }
    defer os.RemoveAll(dir)

    srcPath := filepath.Join(dir, "data.txt")
    gzPath := filepath.Join(dir, "data.txt.gz")

    // Create some source data to stream.
    payload := []byte("streaming bytes through a gzip + checksum pipeline\n")
    if err := os.WriteFile(srcPath, payload, 0o644); err != nil {
        fmt.Println("write source:", err)
        return
    }

    // --- build the pipeline: source file -> TeeReader(hash) -> gzip -> dest ---
    src, err := os.Open(srcPath)
    if err != nil {
        fmt.Println("open source:", err)
        return
    }
    defer src.Close()

    dst, err := os.Create(gzPath)
    if err != nil {
        fmt.Println("create dest:", err)
        return
    }
    defer dst.Close()

    // gzip writer compresses on the fly and forwards to the destination file.
    gz := gzip.NewWriter(dst)

    // TeeReader copies everything read from src into the hasher as a side
    // effect, so we checksum the data in the SAME pass we compress it.
    hasher := sha256.New()
    tee := io.TeeReader(src, hasher)

    // io.Copy streams chunk-by-chunk with a constant-size buffer.
    written, err := io.Copy(gz, tee)
    if err != nil {
        fmt.Println("copy:", err)
        return
    }

    // Close the gzip writer to flush its final block + trailer. Without this
    // the .gz file would be corrupt. Check the error — flush can fail.
    if err := gz.Close(); err != nil {
        fmt.Println("gzip close:", err)
        return
    }

    sum := hex.EncodeToString(hasher.Sum(nil))
    fmt.Printf("streamed %d bytes\n", written)
    fmt.Println("sha256:", sum)

    // --- verify by streaming the gzip back through a decompressor ---
    gzFile, err := os.Open(gzPath)
    if err != nil {
        fmt.Println("open gz:", err)
        return
    }
    defer gzFile.Close()

    gr, err := gzip.NewReader(gzFile)
    if err != nil {
        fmt.Println("gzip reader:", err)
        return
    }
    defer gr.Close()

    // Stream the decompressed output to stdout, capped with a LimitReader
    // to show how you'd bound an untrusted stream.
    fmt.Print("decompressed: ")
    if _, err := io.Copy(os.Stdout, io.LimitReader(gr, 1<<20)); err != nil {
        fmt.Println("decompress copy:", err)
        return
    }
}
```

---

## Explanation

The broken version is the canonical anti-pattern: it "copies" a file by calling `io.ReadAll` to slurp the entire source into a single `[]byte`, then writes that slice out. For a small file it works; for the `huge.bin` the name promises, it allocates a buffer the size of the whole file and runs the process out of memory. It compounds this by ignoring every error — the read error, the write error, the open errors — and by never closing the files, so descriptors leak and any buffered bytes may never reach disk. The result is a function that appears to copy files but cannot handle large ones and silently produces truncated output when anything goes wrong.

The correct version builds a real streaming pipeline with constant memory. It opens a source file and wires it through `io.TeeReader`, which feeds every byte into a SHA-256 hasher as a transparent side effect while passing the same bytes onward — so the checksum is computed in the *same single pass* as the compression, no second read required. Those bytes flow into a `gzip.Writer`, which compresses on the fly and forwards to the destination file. `io.Copy` drives the whole thing chunk by chunk, never holding more than its internal 32 KB buffer regardless of file size, and its returned byte count and error are both checked. Critically, `gz.Close()` is called (and its error checked) to flush the final compressed block and gzip trailer — skip it and the `.gz` is corrupt. The program then streams the file back through `gzip.NewReader` and `io.Copy` to verify, wrapping the decompressor in `io.LimitReader` to illustrate how you would cap an untrusted stream. Every file is deferred-closed and the temp directory is removed, so the program is self-contained and exits cleanly.

---

## Design Tradeoff

The tradeoff streaming asks you to accept is *more ceremony for bounded resources*. Slurping a whole input with `io.ReadAll` is one line and lets you treat the data as a simple slice; streaming forces you to think in chunks, compose readers and writers, remember to flush and close, and handle a copy error that can fire halfway through. That is real cognitive overhead compared to "just read it all." But the property you buy is decisive: memory usage decoupled from input size. A streaming program is correct on a 1 KB file and a 1 TB file with the same code and the same footprint, and it cannot be toppled by an attacker who sends an enormous payload — especially once you add `io.LimitReader`.

The deeper design choice is Go's refusal to provide a separate "streaming framework." Everything is built from `io.Reader`, `io.Writer`, and a handful of tiny adapters, so the cost of learning streaming is nearly zero once you know the interfaces, and pipelines compose without any source or sink knowing what is downstream. The price is that the model is synchronous and blocking: when you need a producer and consumer to run concurrently you must introduce goroutines and `io.Pipe` yourself rather than getting an async pipeline for free. Go judges this a fair trade — backpressure is automatic and the mental model stays simple, and concurrency, when you genuinely need it, is just another goroutine.

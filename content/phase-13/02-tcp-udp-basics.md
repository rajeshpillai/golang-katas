---
id: tcp-udp-basics
phase: 13
phase_title: Files, Networking & IO
sequence: 2
title: TCP/UDP Basics
---

## Description

### Concept Overview

Networking in Go feels remarkably like file IO, and that is not an accident — it is the whole point of the `io.Reader`/`io.Writer` design. A TCP connection is represented by `net.Conn`, and a `net.Conn` satisfies `io.Reader` and `io.Writer` just like an `*os.File` does. So everything you learned about reading bytes, handling partial reads, and treating `io.EOF` as the end of a stream applies directly to the network. You `Read` bytes off a socket and `Write` bytes onto it, and the same `io.Copy` that copies files copies network streams.

The `net` package is Go's portable interface to the operating system's networking. For TCP — the reliable, ordered, connection-oriented protocol — you use `net.Listen("tcp", addr)` on the server and `net.Dial("tcp", addr)` on the client, then read and write a continuous byte stream. For UDP — the connectionless, unreliable, message-oriented protocol — you use `net.ListenPacket` (or `net.ListenUDP`) and exchange discrete datagrams with `WriteTo`/`ReadFrom`. Understanding the difference between a *stream* (TCP) and a *datagram* (UDP) is the core of this kata.

### Technical Explanation

**TCP is a byte stream, not a message stream.** This is the single most important thing to internalize. When you `Write([]byte("hello"))` followed by `Write([]byte("world"))` on a TCP connection, the receiver may read them as `"helloworld"` in one `Read`, or as `"hel"` then `"loworld"`, or in any other split. TCP guarantees the bytes arrive in order and complete, but it does *not* preserve your write boundaries. If you need messages, you must impose a framing protocol on top — for example, newline-delimited text (read with `bufio.Scanner`), or a length prefix, or a fixed-size header.

**The TCP server loop.** A server listens, then accepts connections in a loop, typically handling each in its own goroutine so one slow client cannot block the others:

```go
ln, err := net.Listen("tcp", "127.0.0.1:0") // :0 = OS picks a free port
// ...
for {
    conn, err := ln.Accept()
    if err != nil { /* handle */ }
    go handle(conn) // one goroutine per connection
}
```

`net.Listen` returns a `net.Listener`; `Accept` blocks until a client connects and returns a `net.Conn`. Using `127.0.0.1:0` binds to loopback on an OS-assigned port — ideal for tests and self-contained programs, because you never collide with a port already in use. You can discover the chosen port with `ln.Addr()`.

**The TCP client.** `net.Dial("tcp", addr)` returns a connected `net.Conn`. From there it is pure `io`: `conn.Write` to send, `conn.Read` (or `bufio.NewReader(conn)`) to receive. Always `defer conn.Close()`.

**Closing and half-close.** Calling `conn.Close()` tears down the connection. When one side closes, the other side's `Read` eventually returns `io.EOF` — that is how the receiver learns the stream is done. `*net.TCPConn` also supports `CloseWrite`, a *half-close* that says "I'm done sending but still listening," which is how request/response protocols signal the end of a request.

**UDP is messages, not a stream.** UDP has no connection and no delivery guarantee. You bind a socket with `net.ListenPacket("udp", addr)` which returns a `net.PacketConn`. You receive datagrams with `ReadFrom(buf)` — which returns the byte count, the *sender's address*, and an error — and you reply with `WriteTo(data, addr)`. Each datagram is independent: it may be lost, duplicated, or reordered, and there is no `io.EOF` because there is no stream to end. The byte count `n` from `ReadFrom` is the size of exactly one datagram.

**Deadlines instead of blocking forever.** Network reads block. To avoid hanging forever you set a deadline with `conn.SetReadDeadline(time.Now().Add(d))`; when it elapses, the blocked `Read` returns a timeout error (which satisfies `net.Error` with `Timeout() == true`). This is Go's answer to socket timeouts — explicit, per-operation, and built into the same `Read`/`Write` calls.

### Design Rationale

By making `net.Conn` an `io.Reader`/`io.Writer`, Go unified files and sockets under one vocabulary. The same `io.Copy`, the same `bufio.Scanner`, the same partial-read discipline — there is nothing new to learn for the *data-handling* part of networking. Compare this with other ecosystems.

**Java** separates `Socket`/`ServerSocket` (blocking) from `java.nio` `SocketChannel`/`Selector` (non-blocking), with `InputStream`/`OutputStream` adapters bridging into the IO hierarchy. To get scalable concurrency you traditionally needed the complex selector/reactor model or a framework like Netty.

**Node.js** exposes sockets as event-emitting streams (`net.Socket`) with `'data'`, `'end'`, and `'error'` callbacks. It is non-blocking by default, but that forces all your logic into callbacks or async/await and makes backpressure something you must actively manage.

**Python** has low-level blocking sockets plus `asyncio` for concurrency, two quite different programming models.

Go's bet is goroutines: write *blocking*, sequential code — `conn.Read` simply waits — and run one goroutine per connection. The runtime multiplexes thousands of blocked goroutines onto a handful of OS threads using an internal event poller (epoll/kqueue/IOCP), so you get the scalability of non-blocking IO with the readability of blocking code. The tradeoff is that you must be disciplined about goroutine lifetimes (every accepted connection's goroutine must eventually exit) and about the stream-versus-message distinction, which the API does not hide from you.

### Common Mistakes

**Assuming one `Write` equals one `Read` on TCP.** Developers expect message boundaries that TCP simply does not provide. *Why it fails:* TCP is a byte stream; the network stack coalesces and splits writes freely. Code that reads "one message per Read" works on localhost with tiny payloads and breaks the moment packets fragment or Nagle's algorithm batches writes. Impose explicit framing (delimiters or length prefixes).

**Leaking connections and goroutines by not closing.** Forgetting `defer conn.Close()`, or spawning a per-connection goroutine that never returns, leaks descriptors and memory. *Why it fails:* each open connection holds a descriptor and each goroutine holds a stack; under load these accumulate until the process exhausts descriptors or memory. The server's `Accept` loop and every handler must have a clear exit.

**Not handling `io.EOF` as the signal the peer closed.** On TCP, a clean peer close surfaces as `io.EOF` from `Read`. *Why it fails:* if you treat EOF as an unexpected error you log noise and may retry pointlessly; if you ignore the error entirely you spin forever reading zero bytes.

**Forgetting that UDP `ReadFrom` gives you a datagram, and a buffer that is too small truncates it.** *Why it fails:* unlike TCP, a UDP read returns at most one datagram, and if your buffer is smaller than the datagram, the excess bytes are *discarded*, not delivered on the next read. Size buffers to your maximum expected datagram.

**Blocking forever with no deadline.** A `Read` on a silent peer never returns. *Why it fails:* without `SetReadDeadline`, a stalled or malicious peer hangs your goroutine indefinitely, which is a denial-of-service waiting to happen.

### Key Takeaways

- `net.Conn` satisfies `io.Reader`/`io.Writer`, so TCP data handling is identical to file IO — same partial reads, same `io.EOF`.
- TCP is a *byte stream*: write boundaries are not preserved, so you must add framing (delimiters or length prefixes) to recover messages.
- UDP is *datagrams*: `ReadFrom`/`WriteTo` exchange independent, unreliable messages with the peer's address, and there is no `io.EOF`.
- Bind servers to `127.0.0.1:0` to get a free OS-assigned port; read it back with `ln.Addr()`.
- Handle each connection in its own goroutine and guarantee it exits — `defer conn.Close()` and bounded loops prevent descriptor and goroutine leaks.
- Use `SetReadDeadline` to bound blocking reads so a silent peer cannot hang your program forever.

---

## Broken Code

```go
// broken: assumes one TCP Write arrives as exactly one Read (TCP is a byte
// stream, not messages), and leaks the connection by never closing it.
package main

import (
    "fmt"
    "net"
)

func handle(conn net.Conn) {
    // broken: no defer conn.Close() — connection and descriptor leak
    buf := make([]byte, 1024)
    n, _ := conn.Read(buf) // broken: ignores error; can't detect io.EOF/close
    // broken: assumes this single Read holds the entire "message" the client sent
    fmt.Println("got message:", string(buf[:n]))
}

func main() {
    ln, _ := net.Listen("tcp", "127.0.0.1:9000")
    for {
        conn, _ := ln.Accept() // broken: ignores Accept error; loop can spin
        go handle(conn)
        // broken: nothing ever stops this loop or the program
    }
}
```

---

## Correct Code

```go
// correct: a self-contained TCP echo server on an OS-assigned loopback port,
// with a client that sends a newline-framed message and reads the reply.
package main

import (
    "bufio"
    "errors"
    "fmt"
    "io"
    "net"
)

// handle echoes back each newline-delimited line the client sends.
// Newlines are our framing: TCP gives us a byte stream, bufio.Scanner
// reconstructs the messages.
func handle(conn net.Conn) {
    defer conn.Close()
    scanner := bufio.NewScanner(conn)
    for scanner.Scan() {
        line := scanner.Text()
        if _, err := fmt.Fprintf(conn, "echo: %s\n", line); err != nil {
            return // client went away
        }
    }
    // scanner stops on io.EOF (clean client close) — not an error to report.
}

func main() {
    // :0 lets the OS pick a free port on loopback — no collisions, no cleanup.
    ln, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        fmt.Println("listen:", err)
        return
    }
    defer ln.Close()
    addr := ln.Addr().String()
    fmt.Println("server listening on", addr)

    // Accept exactly one connection for this demo, then stop the server.
    go func() {
        conn, err := ln.Accept()
        if err != nil {
            return // listener closed
        }
        handle(conn)
    }()

    // --- client side, in the same program ---
    conn, err := net.Dial("tcp", addr)
    if err != nil {
        fmt.Println("dial:", err)
        return
    }
    defer conn.Close()

    // Send two newline-framed messages.
    if _, err := io.WriteString(conn, "hello\nworld\n"); err != nil {
        fmt.Println("write:", err)
        return
    }
    // Half-close our write side so the server's scanner sees EOF and stops.
    if tcp, ok := conn.(*net.TCPConn); ok {
        tcp.CloseWrite()
    }

    // Read the framed replies back.
    reply := bufio.NewScanner(conn)
    for reply.Scan() {
        fmt.Println("client received:", reply.Text())
    }
    if err := reply.Err(); err != nil && !errors.Is(err, io.EOF) {
        fmt.Println("read:", err)
    }
}
```

---

## Explanation

The broken version embodies the two cardinal sins of TCP programming. It assumes that a single `conn.Read` returns exactly one logical message, when TCP is a *byte stream* with no message boundaries — the client's data could arrive split across several reads or coalesced with later data. It also never closes the connection and runs an infinite `Accept` loop that ignores every error, so connections, descriptors, and goroutines leak indefinitely and the program never terminates. On localhost with a tiny payload it might appear to "work," which is exactly what makes the bug so insidious in production.

The correct version is a complete, terminating echo server plus client in one program. The server binds to `127.0.0.1:0`, letting the OS assign a free port that the client then reads back via `ln.Addr()`. Framing is solved explicitly: messages are newline-delimited, and `bufio.Scanner` reconstructs them on both ends regardless of how TCP splits the underlying bytes. Each connection is handled with `defer conn.Close()` so descriptors are released, and the handler's scanner loop ends naturally when the client closes — `io.EOF` here is the normal stop, not an error. The client sends two framed lines, then calls `CloseWrite` to half-close its send side; this is what lets the server's scanner observe EOF and finish echoing. Because the server goroutine returns after handling that one connection and the listener is deferred-closed, the whole program exits cleanly and quickly.

---

## Design Tradeoff

The central tradeoff Go asks you to accept is *blocking code with explicit lifetimes* in exchange for scalability without callbacks. You write `conn.Read` as a simple blocking call and spawn a goroutine per connection; the runtime's network poller makes that scale to thousands of connections on a few threads. This is far more readable than the event-loop or selector models of Node and Java NIO — but it shifts a real burden onto you: every goroutine you spawn must have a guaranteed exit, or you trade callback complexity for leak complexity. The discipline of `defer conn.Close()` and bounded loops is not optional bookkeeping; it is the price of the blocking model.

The second tradeoff is that Go refuses to hide the stream-versus-datagram distinction. TCP gives you a byte stream with no framing, and Go makes you implement framing yourself rather than pretending writes are messages. UDP gives you lossy datagrams, and Go's `ReadFrom`/`WriteTo` make that nature visible. A higher-level framework might paper over these with built-in message protocols, but it would also hide the performance and reliability characteristics you need to reason about. Go's choice is to expose the protocol honestly and give you `bufio`, `io`, and goroutines as the simple, composable tools to build exactly the framing and concurrency your application requires.

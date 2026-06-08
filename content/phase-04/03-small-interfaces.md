---
id: small-interfaces
phase: 4
phase_title: Interfaces (Core Abstraction)
sequence: 3
title: Small Interfaces
---

## Description

### Concept Overview

Go culture has a saying: **"The bigger the interface, the weaker the abstraction."** Good Go interfaces are *small* — often one method, rarely more than three. The standard library's most reused interfaces prove the point: `io.Reader` has one method, `io.Writer` has one method, `fmt.Stringer` has one method, `error` has one method. These tiny contracts compose into nearly every Go program ever written.

A small interface is a strong abstraction precisely *because* it asks for little. The fewer methods an interface lists, the more types can satisfy it, the easier it is to implement, the simpler it is to fake in tests, and the more freely it composes with other interfaces. A large interface, by contrast, is a weak abstraction: few types can satisfy it, implementing it is a chore, mocking it in tests is painful, and it couples its consumers to a broad surface they probably do not all need.

This kata teaches you to *decompose* fat interfaces into focused ones and to *accept the narrowest interface that does the job*. It is the Interface Segregation Principle, but it arises naturally in Go rather than being bolted on.

### Technical Explanation

**Single-method interfaces are the Go ideal.** They are so common that Go has a naming convention: a one-method interface is named by the method plus an `-er` suffix. `Read` → `Reader`. `Write` → `Writer`. `Close` → `Closer`. `String` → `Stringer`. This convention signals to every Go programmer "this is a small behavioral contract."

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

type Closer interface {
    Close() error
}
```

**Larger contracts are built by embedding small ones**, not by listing many methods:

```go
type ReadWriter interface {
    Reader
    Writer
}

type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

This is how `io.ReadWriteCloser` is actually defined in the standard library. The big interface is a *composition* of small interfaces, so a function that needs only reading can ask for `io.Reader`, while a function that needs reading and closing can ask for the composed `io.ReadCloser`. Each consumer depends on exactly the slice of behavior it uses.

**Accept the narrowest interface that works.** The classic example: a function that copies bytes from a source to a destination should accept `io.Reader` and `io.Writer`, not `*os.File`. By depending on the small interfaces, the function works with files, network connections, in-memory buffers, compressors, and test fakes — anything that can read or write.

```go
// Narrow: works with any source and any sink.
func copyAll(dst io.Writer, src io.Reader) (int64, error) {
    return io.Copy(dst, src)
}
```

The table below summarizes the asymmetry:

| Property                         | Small interface | Large interface |
|----------------------------------|-----------------|-----------------|
| Types that can satisfy it        | Many            | Few             |
| Effort to implement              | Trivial         | High            |
| Effort to fake in tests          | Trivial         | High            |
| Composability                    | High            | Low             |
| Coupling imposed on consumers    | Low             | High            |

### Design Rationale

The "accept interfaces, return structs" guideline is what makes small interfaces pay off. When a function *returns* a concrete struct, callers get the full, rich type. When a function *accepts* a small interface, it imposes the minimum requirement on its callers. The combination keeps dependencies flowing in the loose direction.

Compare with the nominal-typing world. In **Java**, interfaces historically trended large because each one is a declared contract that every implementer must satisfy in full; adding a method to a widely implemented interface is a breaking change across the entire codebase (this is partly why Java 8 added default methods). The friction pushes designers toward fat interfaces defined up front. The Interface Segregation Principle exists in the SOLID canon precisely as a *corrective* against this gravity — a rule you must consciously apply.

In Go, the gravity runs the other way. Because satisfaction is implicit and structural (see the previous kata), defining a new one-method interface costs nothing and instantly matches every type that already has the method. There is no penalty for having many tiny interfaces and no reward for bundling methods together. So Go programmers naturally produce small interfaces — segregation is the path of least resistance, not a principle to remember.

**C#** mirrors Java's nominal model and the same pressures, though it too leans on small interfaces like `IDisposable` (one method) for its most reused contracts — a quiet acknowledgment that small wins. **TypeScript**, being structural like Go, also composes interfaces freely, but its interfaces are compile-time-only shapes without the runtime method dispatch that makes Go's `io.Reader` a true polymorphic value.

The deeper rationale is about *the unit of reuse*. A one-method interface is the smallest possible unit of behavioral abstraction. By keeping that unit tiny, Go maximizes how often each abstraction can be reused and recombined. `io.Reader` is reusable across the entire ecosystem precisely because it asks for one thing.

### Common Mistakes

**Designing a fat interface up front "to be safe."** Beginners coming from nominal languages define an interface with every method a concrete type currently has — `type Storage interface { Get; Put; Delete; List; Count; Flush; Backup; ... }`. Now every consumer is coupled to all of it, every fake must stub all of it, and only one concrete type can ever satisfy it. The interface has become a second copy of the struct, adding coupling and zero abstraction.

**Putting the interface next to the implementation instead of the consumer.** A small interface is most powerful when defined where it is *used*. If you define interfaces only in the package that implements them, you tend to make them mirror the implementation (fat), and consumers in other packages cannot easily depend on a narrower slice.

**Accepting a concrete type when a small interface would do.** A function written as `func process(f *os.File)` cannot be tested without a real file and cannot operate on a buffer or socket. If it only reads, it should accept `io.Reader`. Over-specifying the parameter type is the most common form of unnecessary coupling.

**Forgetting that big interfaces can be composed from small ones.** Some learners think "small interfaces" means you can never express a richer requirement. You can — by embedding. Need read+close? Embed `Reader` and `Closer`. The richness comes from *composition*, while each building block stays minimal and independently reusable.

**Adding methods to an interface that only one consumer needs.** Every method you add shrinks the set of types that satisfy the interface. If a method is needed by exactly one call path, that path can type-assert to a richer interface locally rather than widening the shared one for everybody.

### Key Takeaways

- "The bigger the interface, the weaker the abstraction" — prefer one-method interfaces, named with the `-er` convention.
- Small interfaces are satisfied by more types, implemented and faked more easily, and composed more freely.
- Build large contracts by *embedding* small interfaces (`io.ReadWriteCloser = Reader + Writer + Closer`), not by listing many methods.
- "Accept interfaces, return structs": take the narrowest interface a function actually needs, and return rich concrete types.
- Define interfaces next to the *consumer* that needs the behavior, keeping them minimal and decoupled from implementations.
- In Go, interface segregation is the natural default because implicit satisfaction makes tiny interfaces free to define and instant to match.

---

## Broken Code

```go
// broken: a fat "do everything" interface forces consumers to depend on
// behavior they never use, makes the type hard to fake in tests, and means
// almost nothing can satisfy it. logAll only logs, yet it demands the works.
package main

import "fmt"

// One giant interface bundling unrelated behaviors.
type DataStore interface {
    Connect() error
    Disconnect() error
    Read(key string) (string, error)
    Write(key, value string) error
    Delete(key string) error
    Backup() error
    Restore() error
    Log(msg string)
}

// logAll only needs to LOG, but it is coupled to the entire DataStore surface.
// To test it you must stub Connect, Disconnect, Read, Write, Delete, Backup,
// Restore — eight methods — just to exercise logging.
func logAll(ds DataStore, messages []string) {
    for _, m := range messages {
        ds.Log(m)
    }
}

func main() {
    fmt.Println("any fake passed to logAll must implement all 8 methods")
}
```

---

## Correct Code

```go
// correct: decompose the fat interface into small, focused ones. Each
// consumer accepts the narrowest interface it needs, so types are trivial
// to fake and broadly reusable. Rich contracts come from composition.
package main

import (
	"fmt"
	"strings"
)

// Small, single-purpose interfaces — the -er convention.
type Reader interface {
	Read(key string) (string, error)
}

type Writer interface {
	Write(key, value string) error
}

type Logger interface {
	Log(msg string)
}

// A richer contract is COMPOSED from small ones, not hand-listed.
type ReadWriter interface {
	Reader
	Writer
}

// memStore happens to satisfy all of the small interfaces, but consumers
// never have to know that.
type memStore struct {
	data    map[string]string
	logSink *strings.Builder
}

func newMemStore() *memStore {
	return &memStore{data: make(map[string]string), logSink: &strings.Builder{}}
}

func (m *memStore) Read(key string) (string, error) {
	v, ok := m.data[key]
	if !ok {
		return "", fmt.Errorf("read: key %q not found", key)
	}
	return v, nil
}

func (m *memStore) Write(key, value string) error {
	m.data[key] = value
	return nil
}

func (m *memStore) Log(msg string) {
	m.logSink.WriteString(msg + "\n")
}

// Each function accepts ONLY the behavior it uses.
func logAll(l Logger, messages []string) {
	for _, msg := range messages {
		l.Log(msg)
	}
}

func seed(rw ReadWriter, pairs map[string]string) error {
	for k, v := range pairs {
		if err := rw.Write(k, v); err != nil {
			return fmt.Errorf("seed %q: %w", k, err)
		}
	}
	return nil
}

func main() {
	store := newMemStore()

	if err := seed(store, map[string]string{"name": "Ada", "lang": "Go"}); err != nil {
		fmt.Println("seed failed:", err)
		return
	}

	logAll(store, []string{"started", "seeded 2 keys"})

	// Reading through the narrow Reader interface.
	var r Reader = store
	for _, key := range []string{"name", "missing"} {
		if v, err := r.Read(key); err != nil {
			fmt.Println("err:", err)
		} else {
			fmt.Printf("%s = %s\n", key, v)
		}
	}

	fmt.Print("\nlog contents:\n", store.logSink.String())
}
```

---

## Explanation

The broken version bundles connecting, disconnecting, reading, writing, deleting, backing up, restoring, and logging into one `DataStore` interface. The `logAll` function needs only the ability to log, yet by accepting `DataStore` it couples itself to all eight methods. This has cascading costs. Only a type that implements the entire surface can be passed to `logAll`, so a lightweight fake for a logging test must stub seven irrelevant methods. The abstraction is weak: it says almost nothing reusable, because "the set of types that can do all eight of these things" is tiny and arbitrary. The interface is really just the concrete store's full API copied into interface form — coupling with no abstraction benefit.

The correct version decomposes the fat contract into `Reader`, `Writer`, and `Logger`, each a single method. Now `logAll` accepts `Logger` and nothing more — a one-method fake is enough to test it. The `seed` function needs to write (and conceptually read-back), so it accepts the *composed* `ReadWriter`, demonstrating that richer requirements come from embedding small interfaces rather than from inflating any one of them. The concrete `memStore` satisfies all three small interfaces implicitly, but each consumer depends only on the slice it uses. The same `store` value flows in as a `Logger`, as a `ReadWriter`, and as a `Reader` depending on the call, with the compiler verifying the right subset at each site.

The net effect is that every function in the correct version states its true dependencies precisely. You can read a signature and know exactly what behavior it touches, you can fake exactly that behavior in a test, and any new concrete type only has to implement the small interfaces the functions it is passed to actually require.

---

## Design Tradeoff

Favoring small interfaces trades a little *up-front discoverability* for a lot of *flexibility and testability*. A single fat `DataStore` interface is, admittedly, easy to find: it is one named contract listing the full capability of a subsystem in one place, which can read like documentation. Splitting it into `Reader`, `Writer`, `Logger`, and composed variants spreads the description across several declarations, and a newcomer must assemble the full picture from the pieces.

But that scatter is exactly what produces loose coupling. With small interfaces, each consumer depends only on what it uses, fakes are trivial to write, and any type that grows the right one or two methods participates immediately. Rich requirements are still expressible through embedding, so you lose no power — you only gain the ability to *ask for less*. Go's implicit satisfaction makes this the natural default: defining another tiny interface costs nothing and bundling methods together buys nothing, so the language quietly steers you toward the strong, small abstractions that make its standard library so endlessly reusable.

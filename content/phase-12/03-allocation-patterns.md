---
id: allocation-patterns
phase: 12
phase_title: Memory, Performance & GC Awareness
sequence: 3
title: Allocation Patterns
---

## Description

### Concept Overview

Once you understand that heap allocations create work for the garbage collector, the next question is practical: how do you write code that allocates *less* on the paths where it matters? Go gives you a handful of well-understood patterns — **preallocating slices and maps**, **reusing buffers** instead of creating new ones, and **pooling objects** with `sync.Pool` — that dramatically cut allocation count and GC pressure on hot loops.

These are not techniques to sprinkle everywhere. Each adds a little complexity, and most code does not need them. But on a hot path — a request handler, a parser, a serialization loop — reducing allocations from millions to thousands can be the difference between a service that hums and one that spends its CPU collecting garbage. The skill is knowing the patterns *and* knowing when they are justified.

### Technical Explanation

**Preallocating slices.** A slice has three parts: a pointer, a length, and a capacity. When you `append` past the current capacity, Go allocates a new, larger backing array (typically growing by ~2x for small slices, less for large ones) and copies the old elements over. If you append `n` items to a slice that started empty, you may trigger several reallocations and copies along the way — each one a heap allocation plus a memcpy. If you know (or can estimate) the final size, preallocate the capacity:

```go
result := make([]int, 0, n) // length 0, capacity n
for i := 0; i < n; i++ {
    result = append(result, i*i) // no reallocation
}
```

Now `append` never reallocates, because the backing array is big enough from the start. One allocation instead of many.

**Preallocating maps.** Maps grow similarly: as you add keys, the map periodically rehashes into a larger table. If you know roughly how many entries you will insert, give `make` a size hint:

```go
m := make(map[string]int, n) // hint that ~n entries are coming
```

This lets the runtime allocate an appropriately sized table up front, avoiding repeated rehashing.

**Reusing buffers.** Creating a fresh `[]byte` or `bytes.Buffer` on every iteration generates garbage proportional to your loop count. Often you can allocate the buffer *once* outside the loop and reset it each iteration:

```go
buf := make([]byte, 0, 4096)
for _, item := range items {
    buf = buf[:0]               // reset length, keep capacity
    buf = appendEncoded(buf, item)
    write(buf)
}
```

`buf = buf[:0]` reuses the same backing array — the capacity (and its heap allocation) is preserved across iterations. This is one of the most effective allocation-reduction patterns in Go and underlies much of the standard library's `Append`-style API design.

**`sync.Pool`.** When objects are expensive to create and short-lived, `sync.Pool` lets you recycle them across goroutines. You `Get` an object (the pool returns a recycled one or calls your `New` function), use it, and `Put` it back when done:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

b := bufPool.Get().(*bytes.Buffer)
b.Reset()
// ... use b ...
bufPool.Put(b)
```

The catch: `sync.Pool` is a *cache*, not a guarantee. The GC may clear the pool at any time, so you cannot rely on a specific object coming back. It is for reducing allocation pressure, not for managing object lifetime or limited resources (use a real resource pool for that). It shines for temporary buffers in high-throughput servers.

**Measuring allocations.** The decisive tool is the allocation count from a benchmark or from `runtime.MemStats.Mallocs`. The benchmark flag `go test -bench=. -benchmem` reports `allocs/op` and `B/op` per operation. If your "optimization" does not reduce `allocs/op`, it is not helping.

### Design Rationale

Go's standard library is full of `Append`-shaped functions — `strconv.AppendInt`, `time.Time.AppendFormat`, `fmt.Appendf` — precisely because the language designers wanted allocation reduction to be *expressible in idiomatic code*. The pattern "pass in a reusable buffer, return the extended slice" lets callers control allocation without the library imposing it. This is a deliberate API philosophy: give the caller the lever, do not hide it.

This contrasts with languages where allocation is more opaque. In Java, you often cannot avoid allocating intermediate objects because the APIs return new objects; reuse requires specialized pools or off-heap tricks. Go's slice model — an explicit pointer/length/capacity triple with `append` semantics you can reason about — makes buffer reuse a natural, visible pattern rather than a dark art.

The existence of `sync.Pool` with its "GC may clear me" semantics is also a rationale in itself. The Go team resisted giving you a permanent, guaranteed object pool because that would fight the garbage collector and risk leaks. Instead, `sync.Pool` is explicitly a *GC-cooperative* cache: it reduces churn when the GC is not under pressure, and gracefully gives memory back when it is. This keeps the pattern aligned with Go's "the GC is in charge" philosophy rather than working against it.

Underlying all of this is Go's bias toward **explicit, measurable** optimization. There is no hidden allocator magic. You preallocate by writing `make([]T, 0, n)`. You reuse by writing `buf[:0]`. The cost and the saving are right there in the code, and `-benchmem` quantifies them. Optimization in Go is something you can see and verify, not something you invoke by incantation.

### Common Mistakes

- **Preallocating with the wrong form: `make([]int, n)` instead of `make([]int, 0, n)`.** The first creates a slice of *length* `n` full of zero values; appending to it then adds elements *after* those zeros, doubling your data. You want length 0 and capacity `n`. This is the single most common slice bug in optimization attempts.

- **Reusing a buffer whose contents are still referenced.** If you `buf = buf[:0]` and reuse the backing array, but something is still holding a slice of the old data (e.g., you appended `buf` to a result list without copying), you will corrupt that earlier data. Reuse is only safe when nothing outside the loop retains a reference to the old bytes. When in doubt, copy.

- **Putting objects back into `sync.Pool` while still using them, or assuming `Get` returns a clean object.** Pooled objects come back in whatever state the last user left them — you must `Reset()` them. And you must not `Put` an object you (or anything you handed it to) still reference, or two goroutines will mutate the same object.

- **Using `sync.Pool` for objects that are cheap to allocate.** The pool's synchronization and interface boxing have their own cost. For small, cheap objects, pooling can be *slower* than just allocating. Pool only expensive, frequently-churned objects, and prove the win with `-benchmem`.

- **Optimizing allocations on cold paths.** Trimming allocations in code that runs once at startup, or rarely, adds complexity for zero benefit. Spend the effort only where a profile shows the allocations are actually hot.

### Key Takeaways

- **Preallocate** slices with `make([]T, 0, n)` and maps with `make(map[K]V, n)` when you can estimate the size — this turns many allocations into one.
- **Reuse buffers** across loop iterations with `buf = buf[:0]`, which keeps the backing array (and its allocation) instead of churning new ones.
- **`sync.Pool`** recycles expensive, short-lived objects, but it is a GC-cooperative cache — always `Reset` on `Get` and never `Put` something still in use.
- Go's `Append`-style stdlib APIs exist to make caller-controlled allocation idiomatic and visible.
- The watch out: `make([]T, n)` (length n) is not the same as `make([]T, 0, n)` (capacity n) — confusing them doubles your data.
- **Measure with `-benchmem` (`allocs/op`, `B/op`)** — if an optimization does not lower allocation count, it is not an optimization.

---

## Broken Code

```go
// broken: needless allocation on every iteration.
// The slice starts empty and regrows repeatedly, and a fresh buffer is
// built from scratch each loop, generating piles of garbage.
package main

import (
	"fmt"
	"runtime"
	"strconv"
)

func buildLines(n int) []string {
	// No capacity hint: append reallocates the backing array many times.
	var lines []string

	for i := 0; i < n; i++ {
		// Build the line by allocating a brand-new []byte every iteration,
		// then converting to string (another allocation).
		var b []byte
		b = append(b, "row-"...)
		b = strconv.AppendInt(b, int64(i), 10)
		lines = append(lines, string(b))
	}
	return lines
}

func main() {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)

	lines := buildLines(50_000)

	runtime.ReadMemStats(&after)
	fmt.Println("lines built:", len(lines))
	fmt.Println("allocations:", after.Mallocs-before.Mallocs)
}
```

---

## Correct Code

```go
// correct: preallocate the result slice and reuse a single scratch buffer.
// The result slice is sized once; the scratch buffer's backing array is
// reused every iteration via buf[:0], slashing allocation count.
package main

import (
	"fmt"
	"runtime"
	"strconv"
)

func buildLines(n int) []string {
	// Preallocate capacity: append never reallocates the backing array.
	lines := make([]string, 0, n)

	// One scratch buffer, reused across all iterations.
	buf := make([]byte, 0, 32)

	for i := 0; i < n; i++ {
		buf = buf[:0] // reset length, keep the capacity (no new allocation)
		buf = append(buf, "row-"...)
		buf = strconv.AppendInt(buf, int64(i), 10)
		// string(buf) must copy (strings are immutable), but that is the
		// only allocation we cannot avoid here, and it is one per line.
		lines = append(lines, string(buf))
	}
	return lines
}

func main() {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)

	lines := buildLines(50_000)

	runtime.ReadMemStats(&after)
	fmt.Println("lines built:", len(lines))
	fmt.Println("first/last:", lines[0], lines[len(lines)-1])
	fmt.Println("allocations:", after.Mallocs-before.Mallocs)
	fmt.Println()
	fmt.Println("Tip: benchmark with `go test -bench=. -benchmem` to see allocs/op.")
}
```

---

## Explanation

The broken version allocates in two avoidable ways. First, `var lines []string` starts with zero capacity, so as the loop appends 50,000 strings, the runtime reallocates and copies the backing array a dozen or so times — each a heap allocation. Second, inside every iteration it builds the line in a fresh `var b []byte` that starts empty and grows from nothing, so each line construction allocates its own backing array. Multiply that by 50,000 and the `Mallocs` counter climbs steeply.

The correct version applies two patterns. It preallocates the result with `make([]string, 0, n)`, so `append` never has to grow the backing array — one allocation for the whole slice. And it hoists a single scratch buffer out of the loop, resetting it each iteration with `buf = buf[:0]`. That reset keeps the existing backing array (and the capacity we already paid for) while discarding the old length, so building each line reuses the same memory. The only allocation we cannot eliminate is the final `string(buf)`, because strings are immutable and must own their bytes — but that is now the sole per-line allocation, down from several.

The result is a large drop in the `Mallocs` delta for identical output. Note the safety detail flagged in the comments: reusing `buf` is sound here precisely because we copy its contents into an immutable string before the next reset. If we had instead appended the raw `buf` slice to a result list, every entry would alias the same backing array and the reset would corrupt earlier data. Buffer reuse is powerful but demands that nothing outside the loop retains the old bytes.

---

## Design Tradeoff

These patterns trade a little extra code and a little extra care for a real reduction in allocation count and GC pressure. Preallocation requires you to know or estimate the size; buffer reuse requires you to reason about aliasing; `sync.Pool` requires disciplined `Reset` and `Put`. None of this is free in terms of cognitive load, and applied indiscriminately it makes code harder to read and easier to get wrong — the corrupted-aliasing bug is a classic example.

So the discipline is the same as the rest of this phase: write clear, straightforward code by default, and apply these patterns only where measurement justifies them. Use `go test -bench=. -benchmem` to confirm an optimization actually lowers `allocs/op` before keeping it. On a genuinely hot path, cutting allocations from millions to thousands is transformative; on a cold path, the same change is just complexity with no payoff. Let the numbers, not the instinct to optimize, decide where these patterns earn their keep.

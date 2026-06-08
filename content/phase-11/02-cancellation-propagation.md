---
id: cancellation-propagation
phase: 11
phase_title: Context & Lifecycles
sequence: 2
title: Cancellation Propagation
---

## Description

### Concept Overview

Cancellation propagation is the mechanism by which a single "stop" signal travels through an entire tree of derived contexts and reaches every goroutine doing work on behalf of an operation. When you cancel a context, you do not just stop one function — you stop everything descended from it. A web handler that fans out three database queries, two cache lookups, and an outbound HTTP call can cancel all of them at once by cancelling one root context. This is what makes `context.Context` powerful: cancellation is not a point event, it is a wave that flows down the call tree.

The model is a **tree**. Every context except the root is derived from a parent via `WithCancel`, `WithTimeout`, `WithDeadline`, or `WithValue`. Cancelling a node cancels that node and every node beneath it, recursively. Cancellation never flows *upward* — cancelling a child leaves its parent and siblings untouched. Understanding this directionality is the key to wiring concurrent operations that shut down cleanly and never leak goroutines.

### Technical Explanation

**Contexts form a tree rooted at `Background()`.** Each `With...` call links a new child to its parent. Internally, a cancellable context registers itself with its parent: when the parent's `Done()` channel closes, the runtime walks the child list and closes each child's `Done()` channel in turn. This recursion is how one cancellation reaches an arbitrarily deep subtree.

```go
root := context.Background()
ctxA, cancelA := context.WithCancel(root)
ctxB, cancelB := context.WithCancel(ctxA) // child of A
ctxC, cancelC := context.WithCancel(ctxA) // sibling of B
```

Calling `cancelA()` cancels `ctxA`, `ctxB`, and `ctxC` — the whole subtree. Calling `cancelB()` cancels only `ctxB`; `ctxA` and `ctxC` keep running. **Propagation is strictly downward.**

**The first cancellation wins, and it is permanent.** A context can be cancelled exactly once. Whether it is cancelled by an explicit `cancel()` call, by a parent's cancellation, or by a deadline expiring, whichever happens first sets the error returned by `Err()`. Subsequent `cancel()` calls are no-ops. After cancellation, `Done()` stays closed forever — a cancelled context never reverts to active.

**`Err()` tells you the cause.** After `Done()` closes, `Err()` returns one of:
- `context.Canceled` — someone called `cancel()` (directly or via an ancestor).
- `context.DeadlineExceeded` — a deadline or timeout expired first.

Because the cause propagates with the cancellation, a deeply nested goroutine can inspect `ctx.Err()` and learn whether the operation was deliberately aborted or simply ran out of time, even though it has no idea who cancelled it.

**Every cancellation function must be called.** When a child function returns, calling its `cancel()` *detaches* the child from the parent's child list and frees the bookkeeping. If you never call it, the child stays linked to the parent until the parent itself is cancelled — a slow leak in long-lived servers where the root context lives for the lifetime of the process. The idiom is `defer cancel()` immediately after deriving the context.

**Honoring propagation requires plumbing.** A signal that reaches `ctx` only matters if your code passes that same `ctx` into every downstream call and selects on `<-ctx.Done()` in every loop. Propagation through the *context tree* is automatic; propagation through *your call tree* is your responsibility — you must hand `ctx` to each function you invoke. A goroutine that captures a stale parent context, or starts work with `context.Background()`, severs itself from the cancellation wave.

### Design Rationale

Go models cancellation as a tree because real programs decompose into trees of sub-operations. A request spawns sub-tasks; each sub-task may spawn its own. The natural shape of "stop this operation and everything it started" is "cancel this node and its subtree." By making derived contexts children of their parent, Go gets this fan-out for free: one `cancel()` at the top cleanly stops an arbitrarily complex computation without the caller needing to know how many goroutines it ultimately spawned.

The strict one-directional flow — down, never up — exists so that a sub-operation can give up (time out, fail, cancel itself) without poisoning the work that launched it. If a child's cancellation flowed upward, one slow database replica timing out could abort the entire request, including the two replicas that answered fine. Downward-only propagation keeps failures contained: a parent decides the fate of its children, but children cannot dictate the fate of their parent. This mirrors structured concurrency — the lifetime of child work is nested inside the lifetime of the parent.

This is the deeper meaning of "context defines when work should stop": the *shape* of when-to-stop follows the *shape* of how-work-was-spawned. The cancellation tree and the call tree are deliberately the same tree.

### Common Mistakes

**Expecting cancellation to flow upward.** Cancelling a child does not cancel its parent or siblings. Developers sometimes cancel a sub-task's context expecting the whole request to abort, then are surprised the rest keeps running. If you want to stop the whole operation, cancel the *parent* (or root), not a leaf.

**Starting downstream work from `Background()` instead of the inherited `ctx`.** If a function receives `ctx` but then calls a child operation with `context.Background()`, it has detached that child from the cancellation tree. The parent's cancel will never reach it. Always derive from and pass along the context you were given.

**Never calling `cancel`, causing a slow leak.** When you derive a context for a bounded sub-task, you must call its `cancel` when the sub-task finishes, even if it completed successfully. Skipping it keeps the child attached to a long-lived parent, accumulating memory over the life of the server. `defer cancel()` is the fix; `go vet` warns when it is missing.

**Assuming propagation alone stops the work.** Closing `Done()` only signals; it does not preempt. If your goroutine is blocked in a `time.Sleep`, a tight CPU loop, or a syscall that ignores context, the closed channel changes nothing. You must actively `select` on `<-ctx.Done()` (or use context-aware APIs) at the points where stopping is possible.

**Racing on the cancellation cause.** After a parent cancels for one reason and a child's own deadline expires for another, the child's `Err()` reflects whichever fired first. Do not assume `Err()` is `Canceled` just because you called `cancel()` — if a deadline beat you to it, you will see `DeadlineExceeded`. Inspect `Err()` rather than assuming.

### Key Takeaways

- Contexts form a tree; cancelling a node cancels that node and its entire subtree, recursively.
- Propagation is strictly downward — cancelling a child never affects its parent or siblings.
- The first cause to fire wins and is permanent; `Err()` reports `context.Canceled` or `context.DeadlineExceeded`.
- Automatic propagation works only if you pass the inherited `ctx` into every downstream call — never substitute `context.Background()` mid-tree.
- Always `defer cancel()` for derived contexts to detach them from long-lived parents and avoid leaks.
- A closed `Done()` channel signals but does not preempt; goroutines must actively select on it to actually stop.

---

## Broken Code

```go
// broken: a child detaches itself from the cancellation tree
package main

import (
	"context"
	"fmt"
	"time"
)

func search(ctx context.Context, replica string, out chan<- string) {
	// Bug: ignores the inherited ctx and starts fresh from Background(),
	// severing this goroutine from the parent's cancellation wave.
	ownCtx := context.Background()

	select {
	case <-ownCtx.Done(): // never fires — Background() is never cancelled
		return
	case <-time.After(500 * time.Millisecond):
		out <- replica + " result"
	}
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan string, 2)

	go search(ctx, "replica-1", out)
	go search(ctx, "replica-2", out)

	// We decide to give up early...
	cancel()

	// ...but the searches ignored ctx and keep running the full 500ms.
	fmt.Println(<-out)
	fmt.Println("main returns, goroutines leaked past cancel")
}
```

---

## Correct Code

```go
// correct: cancellation propagates from one root through the whole subtree
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// search honors the INHERITED ctx so a parent cancel reaches it.
// It returns ctx.Err() when stopped early so the cause propagates back.
func search(ctx context.Context, replica string, results chan<- string, wg *sync.WaitGroup) {
	defer wg.Done()

	// A per-replica timeout, derived from the parent: cancelling the
	// parent cancels this child too (downward propagation).
	ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()

	select {
	case <-ctx.Done():
		fmt.Printf("%s: stopped (%v)\n", replica, ctx.Err())
	case <-time.After(40 * time.Millisecond):
		results <- replica + " result"
	}
}

func main() {
	// Root of this operation's cancellation tree.
	root, cancelAll := context.WithCancel(context.Background())
	defer cancelAll()

	results := make(chan string, 3)
	var wg sync.WaitGroup

	// Fan out three children, all derived from the same root.
	for _, replica := range []string{"replica-1", "replica-2", "replica-3"} {
		wg.Add(1)
		go search(root, replica, results, &wg)
	}

	// Collect the first answer, then cancel the whole subtree at once.
	first := <-results
	fmt.Println("first answer:", first)
	cancelAll() // one cancel stops every still-running child

	// Wait for all children to acknowledge and exit — no leaks.
	wg.Wait()
	close(results)

	// Demonstrate directionality on a fresh tree: cancelling a child
	// leaves its parent untouched.
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	child, cancelChild := context.WithCancel(parent)
	cancelChild() // cancel ONLY the child
	fmt.Println("child.Err():", child.Err())                // context.Canceled
	fmt.Println("parent still active:", parent.Err() == nil) // true
}
```

---

## Explanation

The broken version shows how easy it is to silently sever a goroutine from the cancellation tree. `search` receives `ctx` — the signal it is supposed to honor — but immediately throws it away and creates `ownCtx := context.Background()`. Because `Background()` is the root that is never cancelled, the `select` waits on a `Done()` channel that will never close. When `main` calls `cancel()`, that wave reaches `ctx`, but the goroutines are watching a different, unreachable context. They run the full 500ms regardless. The lesson: propagation through the context tree is automatic, but only if every goroutine actually watches the context it inherited.

The correct version wires a real cancellation tree. `main` creates a `root` context and fans out three `search` goroutines, passing `root` to each. Inside `search`, each goroutine derives its *own* timeout context **from the inherited `ctx`** with `context.WithTimeout(ctx, ...)`. This is the crucial link: each child is a node beneath `root`. When `main` collects the first answer and calls `cancelAll()`, the closure propagates downward through every child's derived context — each blocked `select` immediately chooses `<-ctx.Done()` and prints the cause. The `sync.WaitGroup` guarantees `main` waits for every child to acknowledge cancellation and return before exiting, so no goroutine leaks. Each child also `defer cancel()`s its own timeout context to detach it from `root`.

The closing lines demonstrate directionality explicitly: deriving a `child` from `root` and cancelling *only the child* sets `child.Err()` to `context.Canceled` while `root` remains active. Cancellation flowed to the child but not back up to the root — proving the strict downward-only rule. The whole program completes in well under a second because every blocking operation is bounded and every goroutine has a guaranteed exit path.

---

## Design Tradeoff

Tree-shaped propagation gives you effortless fan-out cancellation — one `cancel()` stops an arbitrarily deep computation — but it shifts a real burden onto the programmer: you must faithfully thread the inherited context through every layer. The automatic part (the runtime closing child `Done()` channels) only helps if the manual part (passing `ctx` down and selecting on it) is done correctly at every hop. A single function that substitutes `context.Background()` quietly creates an island that no cancellation can reach, and there is no compile-time error to catch it — only a leaked goroutine at runtime.

The strict downward-only direction is also a deliberate constraint with a cost. Because children cannot cancel their parents, you cannot use context alone to express "if any sub-task fails, abort the whole group" — that requires extra coordination, such as `errgroup` or an explicit shared cancel call. Go accepts that gap on purpose: containment is more valuable than convenience. A child timing out should not be able to abort siblings that are succeeding. By keeping cancellation flowing strictly down the same tree that work was spawned along, Go ensures that the question "when should this work stop?" always has a single, clear owner — the ancestor that started it.

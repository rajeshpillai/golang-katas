---
id: packages-and-main
phase: 0
phase_title: Go as a Language
sequence: 1
title: Packages and Main
---

## Description

### Concept Overview

Every Go program belongs to a package. A package is Go's fundamental unit of code organization — it groups related functions, types, and variables into a single namespace. The `main` package holds a special role: it is the entry point of any executable Go program. Within the `main` package, the function `func main()` is where execution begins. Without both of these — `package main` and `func main()` — the Go compiler will refuse to produce an executable binary.

This is not optional. This is not a convention. This is a hard rule enforced by the compiler. Go does not guess which function to run first. You tell it, explicitly, by writing `package main` at the top of your file and defining `func main()` inside it.

### Technical Explanation

**The `package` keyword** must appear as the very first line of every Go source file (after any comments). It declares which package the file belongs to. All files in the same directory must declare the same package name. This is how Go organizes code into coherent units.

```go
package main
```

**Import statements** bring other packages into scope. Go supports two forms of import: single-line and grouped. The grouped form is idiomatic and preferred when importing more than one package:

```go
// Single import
import "fmt"

// Grouped import (preferred)
import (
    "fmt"
    "math"
    "strings"
)
```

The Go compiler resolves packages by looking in a well-defined set of locations. For standard library packages like `fmt`, `os`, and `net/http`, the compiler knows where to find them. For third-party packages, Go uses the module system (`go.mod`) to track dependencies and their versions. The import path is not a file path — it is a logical path that the Go toolchain resolves.

**The `main` package** is special in exactly one way: when you run `go build` or `go run` on a package named `main`, the Go compiler produces an executable binary. Any other package name produces a library — code that can be imported by other packages but cannot be run directly. There is no configuration file that designates an entry point. The package name itself is the configuration.

**The `func main()` function** is the entry point. It takes no arguments and returns no values. When the executable starts, the Go runtime initializes itself, runs any `init()` functions, and then calls `main()`. When `main()` returns, the program exits.

**`init()` functions** are a special mechanism in Go. Any package can define one or more `init()` functions, and they run automatically before `main()` is called. They run in the order the packages are imported, and within a package, in the order they appear in the source files. `init()` functions are used for setup tasks like initializing package-level variables, registering drivers, or validating configuration. However, overusing `init()` is considered a code smell — it makes program startup harder to reason about because the execution is implicit.

```go
package main

import "fmt"

func init() {
    fmt.Println("init runs before main")
}

func main() {
    fmt.Println("main runs after init")
}
```

### Design Rationale

Go requires explicit package declarations because it eliminates an entire class of problems that plague other languages. Consider the alternatives:

**Python** uses an implicit module system. Every `.py` file is automatically a module, and the `if __name__ == "__main__":` idiom is a convention, not a requirement. This means any Python file can be accidentally executed as a script or imported as a module, and the boundary between the two is blurry. Python's flexibility here leads to subtle bugs — code that runs on import, circular import errors, and confusion about what constitutes the entry point of a program.

**JavaScript** evolved through multiple module systems (CommonJS, AMD, UMD, ES Modules) precisely because it started without one. The lack of an explicit module system in early JavaScript led to global namespace pollution, dependency hell, and years of tooling complexity. ES Modules finally brought explicit imports and exports, but the ecosystem still carries the scars of that evolution.

Go learned from these mistakes. By requiring every file to declare its package and by making the compiler enforce unused import errors, Go ensures that:

1. You always know what package a file belongs to.
2. You never have hidden dependencies — every dependency is listed at the top of the file.
3. You never have dead imports cluttering your code.
4. The entry point of any program is unambiguous.

This strictness is a deliberate design choice. It trades a small amount of convenience (you cannot leave an import "for later" while debugging) for significant gains in readability and maintainability. Every Go file tells you exactly what it depends on, right at the top.

### Common Mistakes

**Forgetting `package main`**: If you name your package anything other than `main` and try to run it, Go will not produce an executable. The error message will tell you that the package is not a `main` package. This is the most common mistake for beginners coming from scripting languages where any file can be "the program."

**Using uppercase package names**: Package names in Go must be lowercase. Writing `package Main` or `package MAIN` is a compilation error. Go conventions are strict about naming — package names are lowercase, single-word, and descriptive. This is not just style; the compiler enforces lowercase.

**Forgetting to import used packages**: If you call `fmt.Println()` but forget the `import "fmt"` statement, the compiler will error. This is straightforward, but it catches beginners who are used to languages with auto-importing or global namespaces.

**Importing unused packages**: This is the one that surprises people most. In Go, importing a package you do not use is a **compilation error**, not a warning. The compiler will refuse to build your program. This is intentional — Go's designers believe that unused imports are a sign of sloppy code and that they slow down compilation. If you need to import a package only for its side effects (like its `init()` function), you use the blank identifier: `import _ "some/package"`.

**Defining `main()` with parameters or return values**: Unlike C's `int main(int argc, char *argv[])`, Go's `main()` takes no arguments and returns nothing. Command-line arguments are accessed via `os.Args`, and the exit code is set via `os.Exit()`. Writing `func main(args []string)` is a compilation error.

### Key Takeaways

- Every Go source file must start with a `package` declaration — this is enforced by the compiler, not by convention.
- The `main` package with `func main()` is the only way to create an executable program in Go.
- Use grouped imports with parentheses when importing multiple packages — this is the idiomatic style.
- Go will not compile if you import a package you do not use — this keeps dependencies explicit and code clean.
- `init()` functions run before `main()` and are useful for setup, but should be used sparingly to keep startup behavior transparent.
- Package names must be lowercase, short, and descriptive — the compiler enforces lowercase, and convention enforces the rest.

---

## Broken Code

```go
// broken: this program will not compile
package foo

import "fmt"

func main() {
    fmt.Println("Hello, Go!")
}
```

---

## Correct Code

```go
// correct: a proper Go executable
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("Hello, Go!")
    fmt.Println("Running on:", runtime.GOOS)
}
```

---

## Explanation

The broken version declares `package foo` instead of `package main`. When you try to run this program with `go run`, the Go toolchain will report an error: it cannot find a `main` package to execute. The file compiles as a library package named `foo`, but libraries are not executable — they exist to be imported by other packages.

The fix is simple but reveals a deep design principle: Go does not scan your code for a `main` function and decide to run it. The package name is the signal. `package main` tells the compiler "this is an executable," and `func main()` tells it "start here." Both are required. This explicitness means there is never ambiguity about what a Go source file is — you can tell from the very first line whether it is part of an executable or a library.

The correct version also demonstrates grouped imports. By importing both `fmt` and `runtime`, we show the idiomatic way to declare multiple dependencies. Notice that both imports are used — removing either one would cause a compilation error.

---

## Design Tradeoff

Go's strictness about package declarations, unused imports, and the `main` entry point trades developer convenience for codebase clarity. In languages like Python or JavaScript, you can leave unused imports in your code indefinitely — they are harmless clutter at worst. In Go, the compiler forces you to clean up after yourself.

This has real consequences during development. When you are experimenting or debugging, you might temporarily stop using a package — and Go will immediately refuse to compile. This can feel rigid, especially coming from dynamic languages. Tools like `goimports` exist specifically to manage this friction by automatically adding and removing import statements.

But the tradeoff pays off at scale. In a large Go codebase, you can trust that every import in every file is actually used. You can trust that every file declares its package honestly. You can read any file and understand its dependencies in seconds. This is the essence of Go's design philosophy: optimize for the reader, not the writer. Code is read far more often than it is written, and Go's strictness ensures that reading Go code is predictable and fast.

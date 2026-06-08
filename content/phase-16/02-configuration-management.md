---
id: configuration-management
phase: 16
phase_title: Advanced Systems Patterns
sequence: 2
title: Configuration Management
---

## Description

### Concept Overview

Every non-trivial service needs configuration: the port to listen on, the database URL, timeouts, feature flags, log level. The hard part is not reading a value — it is deciding *where* a value comes from when it could come from several places at once, and *failing fast* when the resulting configuration is invalid. A good configuration layer has three properties: a single typed struct that the rest of the program reads from, a clear **precedence** order among sources (defaults, then files, then environment, then flags), and **validation** that runs once at startup so a misconfiguration crashes the process immediately instead of causing a confusing failure an hour later.

In Go, you assemble this from standard-library pieces — `flag` for command-line arguments, `os.Getenv` for environment variables, `encoding/json` (or another decoder) for files — layered in a deliberate order into one struct, followed by a `Validate()` method. There is no framework. The configuration code is plain Go you can read top to bottom, which is exactly what you want for the part of the program that decides how everything else behaves.

### Technical Explanation

**Start with a typed config struct and explicit defaults.** The struct is the single source of truth; everything else mutates it:

```go
type Config struct {
    Addr        string
    LogLevel    string
    ReadTimeout time.Duration
    MaxConns    int
}

func defaults() Config {
    return Config{
        Addr:        ":8080",
        LogLevel:    "info",
        ReadTimeout: 5 * time.Second,
        MaxConns:    100,
    }
}
```

**Layer sources in increasing precedence.** A common, predictable order is: defaults (lowest) -> config file -> environment variables -> command-line flags (highest). Each layer overrides the previous only for the values it actually provides. The principle is *least surprise*: an operator who passes `--addr` on the command line expects it to win over whatever the file said.

```go
cfg := defaults()
loadFile(&cfg, path)  // override from file if present
loadEnv(&cfg)         // override from environment
loadFlags(&cfg, args) // override from flags (wins)
```

**Read the environment explicitly and convert types.** `os.Getenv` returns a string and an empty string for "unset" — there is no error. You must check presence and parse the type yourself, because configuration values are `int`, `Duration`, `bool`, not strings:

```go
func loadEnv(cfg *Config) {
    if v := os.Getenv("APP_ADDR"); v != "" {
        cfg.Addr = v
    }
    if v := os.Getenv("APP_MAX_CONNS"); v != "" {
        if n, err := strconv.Atoi(v); err == nil {
            cfg.MaxConns = n
        }
    }
}
```

**Validate once, at startup, with a method that returns an error.** Validation turns "garbage in" into a clear, immediate failure. Check ranges, enumerations, and cross-field invariants:

```go
func (c Config) Validate() error {
    if c.MaxConns <= 0 {
        return fmt.Errorf("max_conns must be > 0, got %d", c.MaxConns)
    }
    switch c.LogLevel {
    case "debug", "info", "warn", "error":
    default:
        return fmt.Errorf("invalid log_level %q", c.LogLevel)
    }
    return nil
}
```

**Never log secrets.** If the config holds passwords or tokens, give `Config` a `String()` method that redacts them, so an accidental `log.Printf("%v", cfg)` does not leak credentials into your logs.

### Design Rationale

Go favors explicit, code-driven configuration over the convention-heavy, annotation-driven configuration of frameworks like Spring Boot, where a `@ConfigurationProperties` class is populated by reflection from a layered hierarchy of YAML files, profiles, and property sources you cannot easily trace. That magic is convenient until you need to answer "where did this value actually come from?" — at which point you are reading framework documentation about source ordering instead of reading your own code.

The Go approach makes precedence a sequence of function calls you can read in order. `defaults()` runs, then `loadFile`, then `loadEnv`, then `loadFlags`. The last writer wins, and the order of the calls *is* the precedence policy. There is no hidden profile resolution, no implicit property source ranking. If a value is wrong, you can set a breakpoint and watch each layer mutate the struct. This is the same philosophy as the plugin kata: wiring that matters should be ordinary, inspectable code.

Validation as an explicit `Validate()` method reflects Go's "errors are values, handled at the boundary" design. Rather than scattering defensive checks throughout the program ("is `MaxConns` positive?" repeated everywhere it is used), you assert all invariants once, at startup, and let the rest of the code trust the config. This is the configuration equivalent of *parse, don't validate*: after `Validate()` returns nil, a `Config` is known-good, and downstream code never re-checks it. Failing fast at startup — before accepting any traffic — is far better than failing under load when a bad value finally gets exercised.

### Common Mistakes

**Reading environment variables ad hoc, scattered across the codebase.** Calling `os.Getenv("DB_URL")` deep inside a handler means configuration is invisible, untyped, and impossible to validate centrally. Worse, a typo in the variable name silently yields an empty string. Funnel every source through one config-loading function and one struct so all configuration is in one auditable place.

**No validation, so bad config fails late and cryptically.** Without a `Validate()` step, `MaxConns: 0` does not fail at startup — it fails when the connection pool deadlocks under load, producing a stack trace that points nowhere near the actual cause. Validate ranges and enums at startup so the process refuses to start with a clear message.

**Treating `os.Getenv("FLAG") == ""` as "false".** An unset boolean env var and an explicit `FLAG=false` are different intents, but `Getenv` collapses both to checking the string. Parse booleans with `strconv.ParseBool` and decide deliberately how "unset" maps to your default, rather than relying on string emptiness.

**Wrong precedence — letting files override flags.** If an operator passes `--log-level=debug` to diagnose a problem and the config file's `info` silently overrides it, you have violated least surprise and wasted their afternoon. Command-line flags are the operator's most direct, most intentional input; they should sit at the top of the precedence order.

**Logging the whole config, secrets included.** A debug line like `log.Printf("starting with %+v", cfg)` is a credential leak waiting to happen. Implement a redacting `String()` method on configs that contain secrets, and prefer logging individual non-sensitive fields.

### Key Takeaways

- Centralize configuration in **one typed struct** that the rest of the program reads from — never scatter `os.Getenv` calls around.
- Layer sources in a deliberate **precedence order**: defaults < file < environment < flags (flags win, because they are the operator's most direct input).
- Each source overrides only the values it provides; the order of the loading calls *is* the precedence policy, written as readable code.
- **Validate once at startup** with a `Validate() error` method, and refuse to start on invalid config — fail fast, fail clearly.
- After validation passes, treat the config as known-good; downstream code should not re-check it (*parse, don't validate*).
- Redact secrets in any `String()`/log representation so configuration never leaks credentials.

---

## Broken Code

```go
// broken: config scattered across os.Getenv calls, no defaults, no
// precedence, no validation, and secrets logged in plaintext.
package main

import (
    "fmt"
    "net/http"
    "os"
    "strconv"
)

func main() {
    // broken: reading env vars ad hoc, deep in main, untyped, no defaults.
    addr := os.Getenv("APP_ADDR") // "" if unset -> http.ListenAndServe("")
    maxConns, _ := strconv.Atoi(os.Getenv("APP_MAX_CONNS")) // "" -> 0, ignored error

    // broken: no validation. maxConns can be 0 or negative and nothing complains.
    // broken: logs the secret token straight into stdout.
    token := os.Getenv("APP_TOKEN")
    fmt.Printf("starting addr=%q maxConns=%d token=%s\n", addr, maxConns, token)

    // This "works" with empty/zero values and fails confusingly later.
    _ = maxConns
    http.ListenAndServe(addr, nil)
}
```

---

## Correct Code

```go
// correct: one typed config struct, layered precedence (defaults < env <
// flags), startup validation, and redaction of secrets. Loads from defaults
// and a simulated environment, validates, then prints the resolved config.
package main

import (
    "flag"
    "fmt"
    "os"
    "strconv"
    "time"
)

type Config struct {
    Addr        string
    LogLevel    string
    ReadTimeout time.Duration
    MaxConns    int
    Token       string // secret: must be redacted when printed
}

// String redacts the secret so accidental logging cannot leak it.
func (c Config) String() string {
    redacted := "<unset>"
    if c.Token != "" {
        redacted = "***redacted***"
    }
    return fmt.Sprintf("Config{Addr:%q LogLevel:%q ReadTimeout:%s MaxConns:%d Token:%s}",
        c.Addr, c.LogLevel, c.ReadTimeout, c.MaxConns, redacted)
}

func defaults() Config {
    return Config{
        Addr:        ":8080",
        LogLevel:    "info",
        ReadTimeout: 5 * time.Second,
        MaxConns:    100,
    }
}

// loadEnv overrides only the fields actually present in the environment.
func loadEnv(cfg *Config, getenv func(string) string) {
    if v := getenv("APP_ADDR"); v != "" {
        cfg.Addr = v
    }
    if v := getenv("APP_LOG_LEVEL"); v != "" {
        cfg.LogLevel = v
    }
    if v := getenv("APP_MAX_CONNS"); v != "" {
        if n, err := strconv.Atoi(v); err == nil {
            cfg.MaxConns = n
        }
    }
    if v := getenv("APP_TOKEN"); v != "" {
        cfg.Token = v
    }
}

// loadFlags has the highest precedence: it overrides env and defaults.
func loadFlags(cfg *Config, args []string) error {
    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    fs.StringVar(&cfg.Addr, "addr", cfg.Addr, "listen address")
    fs.StringVar(&cfg.LogLevel, "log-level", cfg.LogLevel, "log level")
    fs.IntVar(&cfg.MaxConns, "max-conns", cfg.MaxConns, "max connections")
    return fs.Parse(args)
}

// Validate asserts every invariant once, at startup.
func (c Config) Validate() error {
    if c.MaxConns <= 0 {
        return fmt.Errorf("max_conns must be > 0, got %d", c.MaxConns)
    }
    if c.ReadTimeout <= 0 {
        return fmt.Errorf("read_timeout must be > 0, got %s", c.ReadTimeout)
    }
    switch c.LogLevel {
    case "debug", "info", "warn", "error":
    default:
        return fmt.Errorf("invalid log_level %q (want debug|info|warn|error)", c.LogLevel)
    }
    return nil
}

func Load(args []string, getenv func(string) string) (Config, error) {
    cfg := defaults()  // lowest precedence
    loadEnv(&cfg, getenv) // overrides defaults
    if err := loadFlags(&cfg, args); err != nil { // overrides env (highest)
        return Config{}, fmt.Errorf("parsing flags: %w", err)
    }
    if err := cfg.Validate(); err != nil {
        return Config{}, fmt.Errorf("invalid config: %w", err)
    }
    return cfg, nil
}

func main() {
    // Simulate an environment instead of relying on the real one, so the
    // example is deterministic. APP_LOG_LEVEL and APP_MAX_CONNS override
    // defaults; APP_TOKEN sets a secret.
    env := map[string]string{
        "APP_LOG_LEVEL": "debug",
        "APP_MAX_CONNS": "250",
        "APP_TOKEN":     "s3cr3t-value",
    }
    getenv := func(k string) string { return env[k] }

    // Flags win: --addr overrides the default, even over env if env set it.
    args := []string{"--addr", ":9090"}

    cfg, err := Load(args, getenv)
    if err != nil {
        fmt.Fprintln(os.Stderr, "config error:", err)
        os.Exit(1)
    }

    // Token is redacted; the rest is the resolved, validated config.
    fmt.Println("resolved:", cfg)
    fmt.Println("addr came from flag, log_level/max_conns from env, timeout from default")
}
```

---

## Explanation

The broken version treats configuration as a handful of `os.Getenv` calls scattered through `main`. It has no defaults, so an unset `APP_ADDR` yields `""` and `http.ListenAndServe("")` binds to a surprising address. It has no validation, so `APP_MAX_CONNS` parsing the empty string to `0` (with the error discarded) silently produces a zero connection limit that will only manifest as a deadlock under load. And it logs the secret token in plaintext, so the credential lands in stdout and, eventually, in a log aggregator. Each of these is the kind of bug that looks harmless in review and detonates in production.

The correct version funnels every source through one `Load` function that mutates a single typed `Config`. Precedence is encoded as the *order of the calls*: `defaults()` first, then `loadEnv`, then `loadFlags` — so flags override the environment, which overrides defaults, and you can read that policy straight down the function body. Each layer touches only the fields it actually provides, so an unset env var leaves the default intact rather than zeroing it. After loading, `Validate()` asserts every invariant once; a bad `MaxConns` or an unknown `LogLevel` aborts startup with a precise message instead of failing mysteriously later. Finally, the secret is protected by a redacting `String()` method, so printing the config — even by accident — never leaks the token.

Notice that `Load` takes `args` and a `getenv` function as parameters rather than reaching for the global `os.Args` and `os.Getenv` directly. That small inversion makes the configuration layer testable and the example deterministic: the same logic that reads the real environment in production reads a fixed map here, with no behavioral difference.

---

## Design Tradeoff

Writing configuration by hand — defaults, per-source override functions, a validation method — is more verbose than annotating a struct and letting a framework populate it by reflection. Spring Boot's layered property resolution or Viper's source merging will get you running with less typing. The cost of that convenience is traceability: when a value is wrong, you debug the framework's precedence rules and source ordering instead of reading a short sequence of function calls that you wrote and fully understand.

Go's explicit approach front-loads a modest amount of boilerplate to buy a configuration layer that is greppable, testable, and fail-fast. Precedence is a readable call order; validation is a single method that turns bad input into an immediate, descriptive startup error; secrets are redacted by a method you control. For a long-running service whose correct behavior hinges entirely on its configuration, that transparency is worth far more than the keystrokes it costs — and when you genuinely outgrow the hand-rolled version, you can adopt a library knowing exactly what behavior you are delegating.

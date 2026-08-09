# `getView()` Safety Contract

## Short Version

Use `get()` by default. `getView()` is a specialized zero-copy API for measured
hot paths that read a small part of a large binary value inside a short,
synchronous read transaction.

`getView()` returns a standard `DataView` over memory owned by MDBX. The caller,
not the view, owns the transaction lifetime. Keep a strong reference to the
transaction and never carry a borrowed view across `await`, timers, or
callbacks.

## Allowed And Forbidden

| Allowed | Forbidden |
|---|---|
| Read synchronously inside an active read transaction | Use the view after `commit()` or `abort()` |
| Read fields, then return scalars or an owned copy | Return, cache, or capture the borrowed view |
| Complete the transaction explicitly in `finally` | Keep it across `await`, timers, or callbacks |
| Keep `trackBorrowedViews: true` in the environment options | Call DataView setters or create writable aliases |
| Open the same database from separate OS processes | Detach or transfer the backing `ArrayBuffer` |

Write transactions and `MDBX_WRITEMAP` environments are rejected.

## Safe Pattern

```javascript
const txn = env.startRead();

try {
    const view = dbi.getView(txn, "order");
    return view === undefined ? undefined : view.getUint32(0, true);
} finally {
    if (txn.isActive()) {
        txn.abort();
    }
}
```

A missing key returns `undefined`. An empty value returns an ordinary
zero-length `DataView` that borrows no MDBX memory.

If data must outlive the transaction, copy it before completion and transfer
only the copy after completion:

```javascript
function readOwned(dbi, env, key) {
    const txn = env.startRead();

    try {
        const view = dbi.getView(txn, key);
        if (view === undefined) {
            return undefined;
        }
        return Uint8Array.from(
            new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        );
    } finally {
        if (txn.isActive()) {
            txn.abort();
        }
    }
}

const owned = readOwned(dbi, env, "order");
if (owned !== undefined) {
    worker.postMessage(owned.buffer, [owned.buffer]);
}
```

The Worker may consume this owned copy and may load its own `mdbxmou` addon
instance. It must create its own wrappers and use a separate database path.

## Lifetime Modes

### Tracked, Default

With `trackBorrowedViews: true`, the transaction tracks non-empty borrowed
buffers and detaches them before completion releases the MDBX snapshot. A kept
view object then remains in JavaScript, but its data is invalid and its backing
buffer has `byteLength === 0`.

Detach runs before native transaction completion. If completion throws and the
transaction remains active, all previously issued tracked views stay detached.

Still complete transactions explicitly. If an active transaction reaches GC,
the addon attempts detach followed by abort. If it cannot prove that cleanup is
safe, it intentionally terminates the Node.js process instead of continuing
with an invalid native pointer.

### Untracked, Unsafe Opt-Out

With `trackBorrowedViews: false`, the addon does not retain or detach borrowed
buffers. Every view must be discarded before transaction completion. A retained
view may still look attached while pointing to released memory; later access
can crash the process.

Use this mode only after measuring a real tracking bottleneck.

## Transfer And Worker Limits

Do not call `ArrayBuffer.prototype.transfer()`, use a transfer list, or manually
detach `view.buffer`. These operations can bypass transaction tracking; memory
safety is no longer guaranteed after that contract violation.

The addon may be loaded independently in multiple V8 isolates within one
Node.js process, including `worker_threads`. Each isolate must create its own
environment, transaction, DBI, and cursor wrappers and use a separate database
path. Opening the same database path from multiple isolates of one process is
not supported or verified in this release.

Passing a borrowed view, its backing buffer, an MDBX wrapper, or a native
pointer to another isolate remains unsupported. Copy the bytes first.

Separate OS processes may open the same MDBX database under normal MDBX locking
rules. Process-local addon state is not shared between them. MDBX exclusive
mode remains exclusive.

## Performance

`getView()` removes a copy; it does not accelerate parsing, checksums, or
business logic. The largest gain is expected when only a few fields are read
from a large value. On small values it can be slower than `get()`, while full
scans of large values usually retain only a small gain. Benchmark the actual
access pattern before switching.

See [PERFORMANCE.md](PERFORMANCE.md) for the benchmark and measured results. If
the lifetime rules above are not obviously satisfied, use `get()`.

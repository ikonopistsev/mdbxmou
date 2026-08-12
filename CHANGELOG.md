# Changelog

All notable changes to this project will be documented in this file.

## [0.5.4] - 2026-08-12

### Added

- **ID:** `MDBXMOU-0007-CHECKPOINT`
  **Summary:** Write transactions can publish a batch without releasing the
  writer lock.
  **Long description:** `MDBX_Txn.checkpoint()` now wraps
  `mdbx_txn_checkpoint(MDBX_TXN_NOWEAKING)`. A dirty checkpoint returns `true`
  and keeps the same wrapper active as the continuation write transaction; an
  empty checkpoint returns `false`. Terminal native failures release wrapper
  ownership without aborting the environment-owned basal handle a second
  time. Callers must finish the continuation promptly because it blocks all
  other writers while readers can already observe checkpointed data.

## [0.5.3] - 2026-08-10

### Added

- **ID:** `MDBXMOU-0006-COMMIT-READ`
  **Summary:** Write transactions can become their exact post-commit read
  snapshot.
  **Long description:** `MDBX_Txn.commitAndStartRead()` now wraps
  `mdbx_txn_commit_embark_read()` and keeps the same JavaScript transaction
  object active as a read transaction selected before the write lock is
  released. The binding preserves native handle ownership on pre-commit errors
  and becomes inactive when libmdbx consumed the handle. In the latter case an
  exception may follow a successful commit, so callers must verify state with
  a fresh read before retrying the write.

## [0.5.2] - 2026-08-10

### Fixed

- **ID:** `MDBXMOU-0005-LIBMDBX-0143`
  **Summary:** Bundled libmdbx was updated to the stable v0.14.3 release.
  **Long description:** The binding now requires and packages official
  libmdbx v0.14.3. Removed C++ cursor methods were migrated to
  `scan_until()` and `scan_until_from()` without changing JavaScript traversal
  semantics. Build metadata is read from the bundled upstream `VERSION.json`;
  a package missing that file now fails closed instead of generating stale
  v0.13.7 metadata.
- **ID:** `MDBXMOU-0005-COPY-PAYLOAD`
  **Summary:** Non-compacting database copies preserve their payload again.
  **Long description:** The libmdbx v0.14.3 copy fix restores payload data in
  `copyTo()` and `copyToSync()` when called with `copyFlag.defaults`. Regression
  coverage compares exact record counts and digests for the main and a named
  database after synchronous and asynchronous copies.
- **ID:** `MDBXMOU-0005-WRITER-ORACLE`
  **Summary:** Cross-thread write-lock regressions use a deterministic test
  barrier.
  **Long description:** A test-only native writer reports exact transaction
  state without retaining the JavaScript wrapper mutex while it owns the
  native write transaction. Environment calls capture that state at the native
  return boundary, so scheduler timing cannot produce a false lock result. The
  hook is absent from release builds and does not change the public API.

## [0.5.1] - 2026-08-10

### Fixed

- **ID:** `MDBXMOU-0004-WORKER-STATE`
  **Summary:** Native constructor state is isolated per Node.js environment.
  **Long description:** Process-static wrapper constructor references were
  replaced by state owned through `Napi::Env::SetInstanceData()`. The main
  thread and multiple Workers can now load the addon independently without
  replacing another isolate's references. A bounded regression suite covers
  natural and forced Worker teardown, parallel initialization, the root async
  export, and `mdbxmou/async`. Wrappers and borrowed buffers remain
  isolate-local, and each isolate uses a separate database path.

## [0.5.0] - 2026-08-08

### Added
- **ID:** `MDBXMOU-0001-S6-DOCS`
  **Summary:** Public lifetime contract for zero-copy `getView()` reads.
  **Long description:** README and TypeScript declarations now document raw
  borrowed views, tracked and untracked transaction lifetimes, detach behavior,
  read-only and WRITEMAP restrictions, and the current single-isolate boundary.
  `GETVIEW.md` separately lists the caller-owned constraints, GC/transfer risks,
  Worker limitation and cases where applications should keep using `get()`.
- **ID:** `MDBXMOU-0001-S5-BENCH`
  **Summary:** Reproducible public `get()`/`getView()` benchmark runner.
  **Long description:** A standalone benchmark now compares copied, tracked,
  and untracked reads for partial and full payload consumption. It also records
  transaction completion, retention, GC, and memory observations without
  imposing a performance threshold or joining the regular test suite. The
  measured baseline and methodology are published in `PERFORMANCE.md`.
- **ID:** `MDBXMOU-0001-S3-M2`
  **Summary:** CommonJS named type export for borrowed views.
  **Long description:** The CommonJS declaration entrypoint now exposes
  `MDBX_BorrowedView`, so consumers can use
  `import type { MDBX_BorrowedView } from "mdbxmou"`. The type continues to
  have a single definition in `lib/types.d.ts`.
- **DBI drop() method**: Added `dbi.drop(txn, delete_db)` method for clearing database contents
  - `dbi.drop(txn, false)`: Clears all data but keeps database structure
  - `dbi.drop(txn, true)`: Completely removes database and closes DBI handle
- **Enhanced forEach error handling**: forEach method now properly handles empty databases without throwing exceptions
- **Comprehensive test coverage**: Added test/e6.js for drop functionality testing

### Changed
- **ID:** `MDBXMOU-0001-S3-M3`
  **Summary:** Explicit `undefined` preserves borrowed-view tracking defaults.
  **Long description:** `trackBorrowedViews` remains strict for explicit
  non-boolean values, while an explicitly supplied `undefined` is treated like
  an omitted optional property and retains the safe default value `true`.
- **API Documentation**: Complete README.md overhaul with transaction-based examples
  - All examples now properly show transaction parameter as first argument
  - Removed outdated MDBX_Async_Env references
  - Added comprehensive API reference with correct syntax
  - **Fixed argument order**: Corrected `createMap` and `openMap` method signatures to match actual implementation
- **Async Keys API**: Updated documentation for `env.keys()` method variants
  - `await env.keys(dbi)`: Direct DBI object passing
  - `await env.keys({dbi: dbi})`: Object parameter with DBI
  - `await env.keys([dbi, dbi])`: Multiple DBI objects
  - `await env.keys([{dbi: dbi, limit: 1, from: 1}])`: Advanced configuration
- **forEach method**: Added entry count check before cursor operations to prevent MDBX_NOTFOUND errors on empty databases
- **CursorMode constants**: Updated to camelCase naming convention (e.g., `keyGreaterThan` instead of `key_greater_than`)

### Fixed
- **ID:** `MDBXMOU-0001-S4-M1`
  **Summary:** DBI identity no longer depends on JavaScript prototypes.
  **Long description:** DBI wrappers now carry an N-API type tag. Cursor and
  asynchronous query parsing validate that tag before unwrapping native state,
  so prototype-spoofed objects fail with a stable JavaScript error instead of being
  interpreted as an `MDBX_Dbi` wrapper.
- **ID:** `MDBXMOU-0001-S3-M1`
  **Summary:** Native transaction identity no longer depends on JavaScript
  prototypes.
  **Long description:** Transaction wrappers now carry an N-API type tag.
  Validation checks that tag without invoking JavaScript traps, so revoked
  proxies and prototype-spoofed native wrappers fail with a stable `TypeError`
  instead of terminating Node or allowing native type confusion.
- **Empty database handling**: forEach no longer throws exceptions when called on empty databases
- **Transaction syntax**: All code examples updated to match actual API requirements

### Technical Details
- **libmdbx version**: 0.14.2
- **Node.js compatibility**: `>=22`, native C++ bindings with N-API
- **Build system**: CMake with Ninja generator

### Test Results
- test/e2.js: Basic functionality test (passes)
- test/e5.js: Async keys API test (passes)
- test/e6.js: Drop method comprehensive test (passes)
- All existing tests remain functional

### Migration Guide

#### From previous version

- **Query API**: Replace database name strings with DBI objects in async operations
- **CursorMode**: Update constant names to camelCase if used directly
- No breaking changes for existing synchronous API usage

## [0.3.13] - 2026-05-16

### Changed
- **libmdbx dependency**: Updated bundled `deps/libmdbx` from `v0.13.11` to `v0.13.12`
  - Includes stable-branch fixes for dupsort nested tree counting, neighbor nested cursor adjustment after dupsort deletion, snapshot info page size reporting, dump/load tooling, and corrupted meta-page handling.
- **Release process**: Removed the GitHub Actions npm publish workflow. Releases are now published manually with `npm publish`.

## [0.3.12] - 2026-04-01

### Added
- **Public put flags for sync DBI**: `dbi.put(txn, key, value, [flags])` now accepts `MDBX_Param.putFlag.*`
- **Range count API**: Added `dbi.getCount(txn, options)` for bounded range counts without materializing results
- **Ordinal duplicate values**: Added support for `valueMode.multiOrdinal` (`MDBX_DUPSORT | MDBX_DUPFIXED | MDBX_INTEGERDUP`)
  - `put/get`, cursor methods, range methods, `forEach()` and `query()` now support numeric duplicate values
  - Default JS representation for `multiOrdinal` values is `number`
  - `valueFlag.number` and `valueFlag.bigint` are now exported

### Changed
- **Query write flags**: `queryMode` remains the base operation mode, while write-only MDBX flags are passed separately through `putFlag`
- **Range internals**: `getRange()` and `getCount()` now share the same bounded scan path
- **keymou cleanup**: `keymou` was reduced to a thin wrapper over `valuemou`, keeping only key-specific helpers
- **convmou creation**: Removed positional constructors and switched sync DBI conversion policy creation to `convmou::for_dbi()`

## [0.3.11] - 2026-03-31

### Added
- **Sync range API**: Added `dbi.getRange(txn, options)`, `dbi.keysRange(txn, options)` and `dbi.valuesRange(txn, options)`
  - Supports `start`, `end`, `reverse`, `limit`, `offset`, `includeStart` and `includeEnd`
- **Type definitions for ranges**: Added `MDBXRangeOptions` and range method declarations to TypeScript typings

### Changed
- **Shared conversion layer**: Centralized native key/value to JS conversion in `convmou` and reused it across DBI, cursor and async query/keys paths
- **Transaction argument validation**: Added reusable `txnmou::is_instance()` and `txnmou::unwrap_checked()` helpers and switched DBI methods to them
- **base_flag cleanup**: Tightened `base_flag` handling around single-value semantics and added small helper methods for clearer flag checks
- **Async keysFrom scan path**: Simplified `do_keys_from()` with a shared templated scan helper while keeping ordinal and non-ordinal specializations

### Fixed
- **Cursor key consistency**: Non-ordinal cursor methods now respect `keyFlag` and return `Buffer` or `string` consistently
- **Async keysFrom buffer bug**: Fixed non-ordinal async `keysFrom()` to store keys in `key_buf` instead of the ordinal field
- **Environment option exports**: `envOption` constants now map directly to `MDBX_option` values, including `maxReaders`

## [0.3.0] - 2026-01-10

### Added
- **Cursor API**: New `cursormou` class for low-level database traversal
  - `txn.openCursor(dbi)`: Create cursor from transaction and DBI
  - `cursor.first()`, `cursor.last()`: Navigate to first/last record
  - `cursor.next()`, `cursor.prev()`: Sequential navigation
  - `cursor.seek(key)`: Exact key match
  - `cursor.seekGE(key)`: Find key greater or equal (lower_bound)
  - `cursor.current()`: Get current position
  - `cursor.put(key, value, [flags])`: Insert/update record
  - `cursor.del([flags])`: Delete current record
  - `cursor.close()`: Explicit cursor close
  - Returns `{key, value}` objects or `undefined` at end

### Fixed
- **Critical: String data corruption bug**: Fixed `valuemou` constructor using `reserve()` instead of `resize()` when copying strings from JavaScript, causing data to be written to uninitialized memory
- **Memory leak in cursor operations**: Fixed `cursormou_managed` to properly close cursor in destructor
- **Memory leak in transactions**: Simplified `txnmou_managed` - removed redundant `unique_ptr` guard, now uses single `handle_` pointer with proper RAII

### Changed
- **RAII improvements**: Refactored `txnmou_managed` and `cursormou_managed` to match libmdbx's `txn_managed`/`cursor_managed` pattern
  - Removed redundant `unique_ptr` - now uses single pointer with `std::exchange` in commit/abort
  - Cleaner move constructors using `std::exchange`
- **README**: Updated to remove "zero-copy" claims (not applicable for Node.js bindings)

### Technical
- `txnmou_managed::commit()` and `abort()` now use `std::exchange()` for atomic handle release
- Cursor uses `keymou`/`valuemou` directly with implicit `MDBX_val` conversion

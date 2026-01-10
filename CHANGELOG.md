# Changelog

All notable changes to this project will be documented in this file.

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

## [Unreleased]

### Added
- **DBI drop() method**: Added `dbi.drop(txn, delete_db)` method for clearing database contents
  - `dbi.drop(txn, false)`: Clears all data but keeps database structure 
  - `dbi.drop(txn, true)`: Completely removes database and closes DBI handle
- **Enhanced forEach error handling**: forEach method now properly handles empty databases without throwing exceptions
- **Comprehensive test coverage**: Added test/e6.js for drop functionality testing

### Changed
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
- **Empty database handling**: forEach no longer throws exceptions when called on empty databases
- **Transaction syntax**: All code examples updated to match actual API requirements

### Technical Details
- **libmdbx version**: 0.13.7
- **Node.js compatibility**: Native C++ bindings with N-API
- **Build system**: CMake with Ninja generator

## Test Results
- ✅ test/e2.js: Basic functionality test (passes)
- ✅ test/e5.js: Async keys API test (passes)
- ✅ test/e6.js: Drop method comprehensive test (passes)
- ✅ All existing tests remain functional

## Migration Guide
### From previous version:
- **Query API**: Replace database name strings with DBI objects in async operations
- **CursorMode**: Update constant names to camelCase if used directly
- No breaking changes for existing synchronous API usage

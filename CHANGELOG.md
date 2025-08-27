# Changelog

All notable changes to this project will be documented in this file.

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

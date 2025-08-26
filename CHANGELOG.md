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
- **forEach method**: Added entry count check before cursor operations to prevent MDBX_NOTFOUND errors on empty databases

### Fixed
- **Empty database handling**: forEach no longer throws exceptions when called on empty databases
- **Transaction syntax**: All code examples updated to match actual API requirements

### Technical Details
- **libmdbx version**: 0.13.7
- **Node.js compatibility**: Native C++ bindings with N-API
- **Build system**: CMake with Ninja generator

## Test Results
- ✅ test/e2.js: Basic functionality test (passes)
- ✅ test/e6.js: Drop method comprehensive test (passes)
- ✅ All existing tests remain functional

## Migration Guide
No breaking changes in this release. The drop() method is a new addition that doesn't affect existing code.

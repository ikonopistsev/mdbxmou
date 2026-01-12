# mdbxmou

High-performance Node.js binding for libmdbx — a fast, lightweight, embedded key-value database.

## Features

- **Synchronous API** — Direct MDBX operations in main thread
- **Asynchronous API** — Background operations with async/await
- **Transactions** — ACID transactions with read/write modes
- **Multiple key/value types** — String, binary, ordinal (integer) keys
- **Batch operations** — Efficient multi-key read/write
- **Memory-mapped** — High-performance memory-mapped I/O

## Installation

```bash
npm install mdbxmou
```

## Quick Start

CommonJS:

```javascript
const { MDBX_Env, MDBX_Param } = require('mdbxmou');

// Create environment
const env = new MDBX_Env();
await env.open({ 
  path: './data',
  keyFlag: MDBX_Param.keyFlag.string,    // Default key encoding (optional)
  valueFlag: MDBX_Param.valueFlag.string // Default value encoding (optional)
});

// Write data
const txn = env.startWrite();
const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);
dbi.put(txn, 1, "hello");
dbi.put(txn, 2, "world");
txn.commit();

// Read data
const readTxn = env.startRead();
const readDbi = readTxn.openMap(BigInt(MDBX_Param.keyMode.ordinal));
const value = readDbi.get(readTxn, 1);
console.log(value); // "hello"
readTxn.commit();

await env.close();
```

ESM:

```javascript
import { MDBX_Env, MDBX_Param } from "mdbxmou";
```

## API Reference

### Environment (MDBX_Env)

#### Constructor
```javascript
const env = new MDBX_Env();
```

#### Methods

**open(options) → Promise**
```javascript
await env.open({
  path: './database',           // Database directory
  keyFlag: MDBX_Param.keyFlag.string,    // Default key encoding (optional)
  valueFlag: MDBX_Param.valueFlag.string, // Default value encoding (optional)
  flags: MDBX_Param.envFlag.nostickythreads
});
```

Options:
- `path` - Database directory path
- `flags` - Environment flags (optional, defaults to `0`)
- `keyFlag` - Default key encoding for all operations (optional, defaults to Buffer)
  - Only `string` can be set (ordinal mode uses `number`/`bigint` separately)
- `valueFlag` - Default value encoding for all operations (optional, defaults to Buffer)
- `maxDbi` - Maximum number of databases (optional, default `32`)
- `mode` - Filesystem permissions mode (optional, default `0664`)
- `geometry` - Map size/geometry options (optional)

Note: When `keyFlag` or `valueFlag` are set at environment level, they become defaults for all subsequent operations unless explicitly overridden.

### Key Type Configuration

The library uses a two-level system for configuring key types:

#### Level 1: Environment (`keyFlag`)

When opening the environment, `keyFlag` controls how **string/binary keys** are returned:

| `keyFlag` value | String/Binary keys returned as |
|-----------------|-------------------------------|
| `0` (default)   | `Buffer`                      |
| `keyFlag.string` (2) | `String`                 |

```javascript
// Keys returned as Buffer (default)
await env.open({ path: './data' });

// Keys returned as String
await env.open({ 
  path: './data',
  keyFlag: MDBX_Param.keyFlag.string 
});
```

#### Level 2: Database (`keyMode`)

When opening/creating a database, the **argument type** determines how **ordinal (integer) keys** are returned:

| Argument type | Ordinal keys returned as |
|---------------|-------------------------|
| `Number`      | `Number`                |
| `BigInt`      | `BigInt`                |

```javascript
// Ordinal keys as Number
const dbi = txn.openMap(MDBX_Param.keyMode.ordinal);        // keyMode.ordinal = 8
dbi.keys(txn);  // [0, 1, 2, 3, ...]

// Ordinal keys as BigInt  
const dbi = txn.openMap(BigInt(MDBX_Param.keyMode.ordinal)); // BigInt(8)
dbi.keys(txn);  // [0n, 1n, 2n, 3n, ...]
```

#### Summary

| Key type | Configuration level | Option | Result type |
|----------|--------------------|--------------------|-------------|
| String/Binary | env.open() | `keyFlag: 0` | `Buffer` |
| String/Binary | env.open() | `keyFlag: keyFlag.string` | `String` |
| Ordinal | openMap/createMap | `keyMode.ordinal` (Number) | `Number` |
| Ordinal | openMap/createMap | `BigInt(keyMode.ordinal)` | `BigInt` |

**close() → Promise**
```javascript
await env.close();
```

**openSync(options)**
```javascript
env.openSync({
  path: './database',
  valueFlag: MDBX_Param.valueFlag.string
});
```

**closeSync()**
```javascript
env.closeSync();
```

**startWrite() → Transaction**
```javascript
const txn = env.startWrite();
```

**startRead() → Transaction**
```javascript
const txn = env.startRead();
```

**query(requests) → Promise<Array>** (Async batch operations)
```javascript
const result = await env.query([
  {
    dbMode: MDBX_Param.dbMode.accede,
    keyMode: MDBX_Param.keyMode.ordinal,
    mode: MDBX_Param.queryMode.get,
    item: [{ key: 1 }, { key: 2 }]
  }
]);
```

### Transaction

#### Methods

**createMap([db_name | keyMode], [keyMode | valueMode], [valueMode]) → DBI**
```javascript
// No arguments - default DB with string keys
const dbi = txn.createMap();

// One argument - keyMode only
const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);

// One argument - db_name only (uses default keyMode)
const namedDbi = txn.createMap("my-table");

// Two arguments - keyMode + valueMode
const dbi = txn.createMap(MDBX_Param.keyMode.ordinal, MDBX_Param.valueMode.multi);

// Two arguments - db_name + keyMode
const namedDbi = txn.createMap("my-table", MDBX_Param.keyMode.ordinal);

// Three arguments - db_name + keyMode + valueMode  
const namedDbi = txn.createMap("my-table", MDBX_Param.keyMode.ordinal, MDBX_Param.valueMode.multi);
```

> **Note**: Use `createMap` in write transactions - it will create the database if it doesn't exist, or open it if it does. This is safer for new environments.

**openMap([db_name | keyMode], [keyMode]) → DBI**
```javascript
// No arguments - default DB with string keys
const dbi = txn.openMap();

// One argument - keyMode only
// Number keyMode - keys returned as numbers
const dbi = txn.openMap(MDBX_Param.keyMode.ordinal);
// BigInt keyMode - keys returned as BigInts
const dbi = txn.openMap(BigInt(MDBX_Param.keyMode.ordinal));

// One argument - db_name only (uses default keyMode)
const namedDbi = txn.openMap("my-table");

// Two arguments - db_name + keyMode
const namedDbi = txn.openMap("my-table", MDBX_Param.keyMode.ordinal);
const namedDbiBigInt = txn.openMap("my-table", BigInt(MDBX_Param.keyMode.ordinal));
```

> **Note**: Use `openMap` in read transactions or when you're sure the database already exists. For write transactions on new environments, prefer `createMap`.

> **Note**: When using ordinal keyMode, the key type in results depends on how you specify keyMode:
> - `keyMode: number` → keys returned as `number`
> - `keyMode: BigInt(number)` → keys returned as `BigInt`

**commit()**
```javascript
txn.commit();
```

**abort()**
```javascript
txn.abort();
```

### DBI (Database Instance)

#### Methods

**put(txn, key, value)**
```javascript
dbi.put(txn, 123, "value");
dbi.put(txn, "key", Buffer.from("binary data"));
```

**get(txn, key) → value**
```javascript
const value = dbi.get(txn, 123);
const binary = dbi.get(txn, "key");
```

**del(txn, key) → boolean**
```javascript
const deleted = dbi.del(txn, 123);
```

**has(txn, key) → boolean**
```javascript
const exists = dbi.has(txn, 123);
```

**stat(txn) → Object**
```javascript
const stats = dbi.stat(txn);
// { pageSize: 4096, depth: 1, entries: 10, ... }
```

**forEach(txn, callback)**
```javascript
dbi.forEach(txn, (key, value, index) => {
  console.log(`${key}: ${value}`);
  return false; // continue iteration (or undefined)
  // return true; // stop iteration
});
```

> **Note**: forEach continues scanning while callback returns `undefined` or `false`, and stops when callback returns `true`.

**keys(txn) → Array**
```javascript
// Get all keys
const allKeys = dbi.keys(txn);
```

**keysFrom(txn, startKey, [limit], [cursorMode]) → Array**
```javascript
// Get keys starting from specific key
const keys = dbi.keysFrom(txn, 42, 50); // 50 keys starting from 42

// With cursor mode
const keys = dbi.keysFrom(txn, 42, 50, 'keyGreaterOrEqual');

// BigInt keys
const bigIntKeys = dbi.keysFrom(txn, 42n, 50);

// Key equal mode (for multi-value databases)
const equalKeys = dbi.keysFrom(txn, 5, 10, 'keyEqual');
```

**drop(txn, [delete_db]) → void**
```javascript
// Clear database contents (keep structure)
dbi.drop(txn, false);

// Delete database completely
dbi.drop(txn, true);

// Default behavior (clear contents)
dbi.drop(txn);
```

### Cursor (MDBX_Cursor)

Cursors provide low-level control for database traversal with positioning and iteration capabilities.

#### Creating a Cursor
```javascript
const txn = env.startRead();
const dbi = txn.openMap();
const cursor = txn.openCursor(dbi);
```

#### Navigation Methods

**first() → {key, value} | undefined**
```javascript
const item = cursor.first();
if (item) {
  console.log(item.key, item.value);
}
```

**last() → {key, value} | undefined**
```javascript
const item = cursor.last();
```

**next() → {key, value} | undefined**
```javascript
const item = cursor.next();
```

**prev() → {key, value} | undefined**
```javascript
const item = cursor.prev();
```

**current() → {key, value} | undefined**
```javascript
const item = cursor.current();
```

#### Search Methods

**seek(key) → {key, value} | undefined**

Exact key match. Returns `undefined` if key not found.
```javascript
const item = cursor.seek('user:123');
if (item) {
  console.log('Found:', item.value);
}
```

**seekGE(key) → {key, value} | undefined**

Find first key greater or equal to given key (lower_bound).
```javascript
const item = cursor.seekGE('user:100');
// Returns first key >= 'user:100'
```

#### Modification Methods

**put(key, value, [flags])**

Insert or update a record at cursor position.
```javascript
cursor.put('newKey', 'newValue');

// With flags (MDBX_NOOVERWRITE, etc.)
cursor.put('key', 'value', MDBX_Param.queryMode.insertUnique);
```

**del([flags]) → boolean**

Delete record at current cursor position. Returns `true` if deleted, `false` if not found.
```javascript
cursor.seek('keyToDelete');
const deleted = cursor.del();
```

#### Control Methods

**close()**
```javascript
cursor.close();
```

#### Cursor Examples

**Iterate all records:**
```javascript
const cursor = txn.openCursor(dbi);

for (let item = cursor.first(); item; item = cursor.next()) {
  console.log(item.key, item.value.toString());
}

cursor.close();
txn.abort();
```

**Range iteration:**
```javascript
const cursor = txn.openCursor(dbi);

// Find all keys starting with 'user:'
for (let item = cursor.seekGE('user:'); item; item = cursor.next()) {
  if (!item.key.startsWith('user:')) break;
  console.log(item.key, item.value.toString());
}

cursor.close();
```

**Pagination:**
```javascript
function getPage(cursor, offset, limit) {
  const results = [];
  
  let item = cursor.first();
  
  // Skip offset
  for (let i = 0; i < offset && item; i++) {
    item = cursor.next();
  }
  
  // Collect limit items
  for (let i = 0; i < limit && item; i++) {
    results.push({ key: item.key, value: item.value.toString() });
    item = cursor.next();
  }
  
  return results;
}

const txn = env.startRead();
const dbi = txn.openMap();
const cursor = txn.openCursor(dbi);

const page1 = getPage(cursor, 0, 10);   // First 10 items
const page2 = getPage(cursor, 10, 10);  // Next 10 items

cursor.close();
txn.abort();
```

**Reverse iteration:**
```javascript
const cursor = txn.openCursor(dbi);

for (let item = cursor.last(); item; item = cursor.prev()) {
  console.log(item.key, item.value.toString());
}

cursor.close();
```

**Bulk insert with cursor:**
```javascript
const txn = env.startWrite();
const dbi = txn.createMap();
const cursor = txn.openCursor(dbi);

for (let i = 0; i < 1000; i++) {
  cursor.put(`key${i}`, `value${i}`);
}

cursor.close();
txn.commit();
```

**Delete with cursor:**
```javascript
const txn = env.startWrite();
const dbi = txn.openMap();
const cursor = txn.openCursor(dbi);

// Delete specific key
if (cursor.seek('keyToDelete')) {
  cursor.del();
}

// Delete range
for (let item = cursor.seekGE('prefix:'); item; item = cursor.next()) {
  if (!item.key.startsWith('prefix:')) break;
  cursor.del();
}

cursor.close();
txn.commit();
```

## Key and Value Types

### Key Modes (MDBX_Param.keyMode)

- **Default (0)** - Buffer keys (no flags, default behavior)
- **reverse** - Keys sorted in reverse order
- **ordinal** - Integer keys (4 or 8 bytes, native endian)

### Value Modes (MDBX_Param.valueMode)

- **single** - Single value per key (default)
- **multi** - Multiple values per key (dupsort)

### Value Flags (MDBX_Param.valueFlag)

- **binary** - Raw binary data (default)
- **string** - UTF-8 strings

## Examples

### Basic Usage (Synchronous)

```javascript
const { MDBX_Env, MDBX_Param } = require('mdbxmou');

function syncExample() {
  const env = new MDBX_Env();
  
  // Synchronous open
  env.openSync({ path: './data' });

  // Write transaction
  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  
  for (let i = 0; i < 1000; i++) {
    dbi.put(writeTxn, i, `value_${i}`);
  }
  writeTxn.commit();

  // Read transaction with number keys
  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(MDBX_Param.keyMode.ordinal); // keys as numbers
  
  const value = readDbi.get(readTxn, 42);
  console.log(value); // "value_42"
  
  // Iterate with cursor
  readDbi.forEach(readTxn, (key, value, index) => {
    console.log(`Key ${key} (type: ${typeof key}): ${value}`); // key is number
    return index >= 9; // stop after 10 items (indices 0-9)
  });
  
  // Get specific keys
  const someKeys = readDbi.keysFrom(readTxn, 100, 50);
  console.log(`Keys 100-149:`, someKeys); // array of numbers
  
  readTxn.commit();
  
  // Synchronous close
  env.closeSync();
}

async function asyncExample() {
  const env = new MDBX_Env();
  await env.open({ path: './data-async' });

  // Write transaction  
  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  
  for (let i = 0; i < 1000; i++) {
    dbi.put(writeTxn, i, `value_${i}`);
  }
  writeTxn.commit();

  // Read transaction with BigInt keys
  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(BigInt(MDBX_Param.keyMode.ordinal)); // keys as BigInts
  
  const value = readDbi.get(readTxn, 42);
  console.log(value); // "value_42"
  
  // Iterate with BigInt keys
  readDbi.forEach(readTxn, (key, value, index) => {
    console.log(`Key ${key} (type: ${typeof key}): ${value}`); // key is bigint
    return index >= 9; // stop after 10 items (indices 0-9)
  });
  
  // Get BigInt keys
  const bigIntKeys = readDbi.keysFrom(readTxn, 100n, 50);
  console.log(`Keys 100n-149n:`, bigIntKeys); // array of BigInts
  
  readTxn.commit();
  await env.close();
}
```

### Key Type Behavior

```javascript
const { MDBX_Env, MDBX_Param } = require('mdbxmou');

function keyTypesExample() {
  const env = new MDBX_Env();
  env.openSync({ path: './key-types' });

  const txn = env.startWrite();
  const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);
  
  // Store some data
  dbi.put(txn, 1, "one");
  dbi.put(txn, 2, "two");
  dbi.put(txn, 3, "three");
  txn.commit();

  // Read with number keyMode
  const readTxn1 = env.startRead();
  const numberDbi = readTxn1.openMap(MDBX_Param.keyMode.ordinal);
  
  numberDbi.forEach(readTxn1, (key, value) => {
    console.log(`Number key: ${key} (${typeof key})`); // number
    // return undefined; // continue iteration (default)
  });
  readTxn1.commit();

  // Read with BigInt keyMode  
  const readTxn2 = env.startRead();
  const bigintDbi = readTxn2.openMap(BigInt(MDBX_Param.keyMode.ordinal));
  
  bigintDbi.forEach(readTxn2, (key, value) => {
    console.log(`BigInt key: ${key} (${typeof key})`); // bigint
    // return false; // continue iteration
  });
  readTxn2.commit();

  env.closeSync();
}
```

### Cursor Operations

```javascript
const { MDBX_Env, MDBX_Param } = require('mdbxmou');

function cursorExample() {
  const env = new MDBX_Env();
  env.openSync({ path: './cursor-data' });

  const txn = env.startWrite();
  const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);
  
  // Store test data
  for (let i = 0; i < 100; i++) {
    dbi.put(txn, i, `value_${i}`);
  }
  txn.commit();

  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(MDBX_Param.keyMode.ordinal);
  
  // Get all keys
  const allKeys = readDbi.keys(readTxn);
  console.log(`Total keys: ${allKeys.length}`);
  
  // Get limited keys - use keysFrom with limit
  const firstTen = readDbi.keysFrom(readTxn, 0, 10);
  console.log(`First 10 keys:`, firstTen);
  
  // Get keys from specific position
  const fromFifty = readDbi.keysFrom(readTxn, 50, 20);
  console.log(`Keys 50-69:`, fromFifty);
  
  // Reverse iteration - need manual logic or forEach
  const allKeysForReverse = readDbi.keys(readTxn);
  const lastTen = allKeysForReverse.slice(-10).reverse();
  console.log(`Last 10 keys:`, lastTen);
  
  // Manual iteration with forEach
  let count = 0;
  readDbi.forEach(readTxn, (key, value, index) => {
    if (key >= 80) {
      console.log(`Key ${key}: ${value}`);
      count++;
    }
    return count >= 5; // stop after 5 items >= 80
  });
  
  readTxn.commit();
  env.closeSync();
}
```

### Query API (Advanced Async)

```javascript
const { MDBX_Env, MDBX_Param } = require('mdbxmou');

async function queryExample() {
  const env = new MDBX_Env();
  await env.open({ path: './query-data' });

  // Create DBI first in synchronous transaction
  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  writeTxn.commit();

  // Async query with DBI object (not database name)
  const results = await env.query([
    {
      dbi: dbi,
      mode: MDBX_Param.queryMode.insertUnique,
      item: [
        { key: 1, value: JSON.stringify({ name: "Alice" }) },
        { key: 2, value: JSON.stringify({ name: "Bob" }) }
      ]
    },
    {
      dbi: dbi,
      mode: MDBX_Param.queryMode.get,
      item: [
        { key: 1 },
        { key: 2 }
      ]
    }
  ]);

  console.log('Query results:', JSON.stringify(results, null, 2));
  await env.close();
}
```

### Async Keys API

```javascript
const { MDBX_Env, MDBX_Param } = require('mdbxmou');

async function keysExample() {
  const env = new MDBX_Env();
  await env.open({ path: './keys-data' });

  // Create DBI first
  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  
  // Add some test data
  for (let i = 1; i <= 10; i++) {
    dbi.put(writeTxn, i, `value-${i}`);
  }
  writeTxn.commit();

  // Get all keys from DBI
  const allKeys = await env.keys(dbi);
  console.log("All keys:", allKeys);

  // Get keys with DBI object parameter  
  const allKeys2 = await env.keys({ dbi: dbi });
  console.log("All keys (object):", allKeys2);

  // Get keys from multiple DBIs
  const multiKeys = await env.keys([dbi, dbi]);
  console.log("Multi DBI keys:", multiKeys);

  // Get limited keys from specific position
  const limitedKeys = await env.keys([
    { dbi: dbi, limit: 3, from: 5 }
  ]);
  console.log("Limited keys:", limitedKeys);

  await env.close();
}
```

## Error Handling

```javascript
try {
  const env = new MDBX_Env();
  await env.open({ path: './data' });
  
  const txn = env.startWrite();
  const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);
  
  // This might throw if key already exists with MDBX_NOOVERWRITE
  dbi.put(txn, 123, "value");
  
  txn.commit();
} catch (error) {
  console.error('Database error:', error.message);
  if (txn) txn.abort();
}
```

## Configuration Options

### Available Constants (MDBX_Param)

```javascript
const { MDBX_Param } = require('mdbxmou');

// Key modes
MDBX_Param.keyMode.reverse    // MDBX_REVERSEKEY - reverse key order
MDBX_Param.keyMode.ordinal    // MDBX_INTEGERKEY - integer keys (use with number/bigint)
// Default (0) - Buffer keys (no flags)

// Key flags (optional, control key representation)
MDBX_Param.keyFlag.string     // UTF-8 string encoding
MDBX_Param.keyFlag.number     // Number type (used with ordinal mode)
MDBX_Param.keyFlag.bigint     // BigInt type (used with ordinal mode)
// Default - Buffer representation

Note: For ordinal (integer) keys, use keyFlag.number or keyFlag.bigint to specify the data type.
```

### Environment Flags
- `MDBX_Param.envFlag.nostickythreads` - Don't stick reader transactions to threads
- `MDBX_Param.envFlag.rdonly` - Open database in read-only mode
- `MDBX_Param.envFlag.validation` - Enable page validation
- `MDBX_Param.envFlag.exclusive` - Exclusive mode
- `MDBX_Param.envFlag.accede` - Open existing environment
- `MDBX_Param.envFlag.writemap` - Use writable memory map
- `MDBX_Param.envFlag.nordahead` - Disable OS readahead
- `MDBX_Param.envFlag.nomeminit` - Disable memory initialization
- `MDBX_Param.envFlag.liforeclaim` - LIFO reclaim
- `MDBX_Param.envFlag.nometasync` - Disable metadata flushes
- `MDBX_Param.envFlag.safeNosync` - Safe nosync mode
- `MDBX_Param.envFlag.utterlyNosync` - Utterly nosync mode

### Database Modes  
- `MDBX_Param.dbMode.create` - Create database if it doesn't exist
- `MDBX_Param.dbMode.accede` - Open existing database with any flags

### Query Modes
- `MDBX_Param.queryMode.get` - Read operations
- `MDBX_Param.queryMode.upsert` - Write operations (insert or update)
- `MDBX_Param.queryMode.update` - Update existing (MDBX_CURRENT)
- `MDBX_Param.queryMode.insertUnique` - Insert unique (MDBX_NOOVERWRITE)
- `MDBX_Param.queryMode.del` - Delete operations

### Cursor Modes
- `MDBX_Param.cursorMode.first` - First key
- `MDBX_Param.cursorMode.last` - Last key  
- `MDBX_Param.cursorMode.next` - Next key
- `MDBX_Param.cursorMode.prev` - Previous key
- `MDBX_Param.cursorMode.keyLesserThan` - Keys less than target
- `MDBX_Param.cursorMode.keyLesserOrEqual` - Keys less than or equal to target
- `MDBX_Param.cursorMode.keyEqual` - Keys exactly equal to target
- `MDBX_Param.cursorMode.keyGreaterOrEqual` - Keys greater than or equal to target  
- `MDBX_Param.cursorMode.keyGreaterThan` - Keys greater than target

> **Note**: Cursor modes can be used with `keysFrom()` and `forEach()` methods to control iteration direction and filtering.

## Performance Tips

1. **Use ordinal keys** for integer data - much faster than string keys
2. **Batch operations** - Use query API for bulk operations
3. **Reuse transactions** - Keep read transactions open for multiple operations
4. **Memory mapping** - MDBX uses memory-mapped files for fast I/O
5. **Transaction scope** - Always pass transaction object to DBI methods

## License

Apache License 2.0

---

**Documentation generated by GitHub Copilot (Claude 3.5 Sonnet) on August 27, 2025**  
**Reviewed and approved by the library author**

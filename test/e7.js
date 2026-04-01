"use strict";

const assert = require("assert");
const fs = require("fs");
const MDBX = require("../lib/nativemou.js");
const { MDBX_Env, MDBX_Param } = MDBX;

let Packr;
let isNativeAccelerationEnabled;
try {
  ({ Packr, isNativeAccelerationEnabled } = require("msgpackr"));
} catch (error) {
  console.error("msgpackr is required for test/e7.js");
  console.error("Install it with: npm install --save-dev msgpackr");
  throw error;
}

const TEST_PATH = "e7";
const TEST_SIZES = [100, 192, 320, 512, 768, 1024, 2048, 4000];
const START_VALUE = Number.parseInt(process.env.E7_START_VALUE ?? "120", 10);
const ROUNDS = Number.parseInt(process.env.E7_ROUNDS ?? "160", 10);
const MODE = process.env.E7_MODE ?? "all";

function makeIntArray(byteSize, fillValue) {
  const intCount = Math.max(1, Math.floor(byteSize / 4));
  const ints = new Array(intCount);
  for (let i = 0; i < intCount; ++i) {
    ints[i] = fillValue;
  }
  return ints;
}

function makeIntBuffer(ints) {
  const buffer = Buffer.allocUnsafe(ints.length * 4);
  for (let i = 0; i < ints.length; ++i) {
    buffer.writeUInt32LE(ints[i] >>> 0, i * 4);
  }
  return buffer;
}

function buildPayload(byteSize, fillValue, round) {
  const ints = makeIntArray(byteSize, fillValue);
  return {
    kind: "e7-msgpackr-roundtrip",
    round,
    fillValue,
    byteSize,
    intCount: ints.length,
    ints,
    intsBuffer: makeIntBuffer(ints),
    meta: {
      tag: `size-${byteSize}`,
      first: ints[0],
      last: ints[ints.length - 1],
    },
  };
}

function toExactBuffer(packed) {
  if (Buffer.isBuffer(packed)) {
    return packed;
  }
  if (packed && typeof packed.byteLength === "number" && packed.buffer) {
    return Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
  }
  throw new TypeError(`Unsupported packed result type: ${typeof packed}`);
}

function describeUnsafeBufferUse(packed, exact) {
  if (!packed || !packed.buffer) {
    return null;
  }

  const unsafe = Buffer.from(packed.buffer);
  const sameLength = unsafe.length === exact.length;
  const sameBytes = sameLength && unsafe.compare(exact) === 0;
  if (sameLength && sameBytes) {
    return null;
  }

  return {
    unsafeLength: unsafe.length,
    exactLength: exact.length,
    byteOffset: packed.byteOffset ?? 0,
    backingLength: packed.buffer.byteLength,
  };
}

function runRoundTripTest() {
  fs.rmSync(TEST_PATH, { recursive: true, force: true });

  const packr = new Packr();
  const { keyMode } = MDBX_Param;
  const db = new MDBX_Env();
  const summaries = [];
  let unsafeBufferMismatches = 0;
  let unsafeExample = null;

  console.log("=== e7 msgpackr round-trip test ===");
  console.log("msgpackr native acceleration:", typeof isNativeAccelerationEnabled === "function"
    ? isNativeAccelerationEnabled()
    : "unknown");
  console.log("rounds:", ROUNDS, "startValue:", START_VALUE);
  console.log("sizes:", TEST_SIZES.join(", "));

  db.openSync({ path: TEST_PATH, maxDbi: 4 });

  const initTxn = db.startWrite();
  const dbi = initTxn.createMap(BigInt(keyMode.ordinal));
  initTxn.commit();

  for (let sizeIndex = 0; sizeIndex < TEST_SIZES.length; ++sizeIndex) {
    const byteSize = TEST_SIZES[sizeIndex];
    const key = BigInt(sizeIndex + 1);
    let previousPackedLength = -1;
    const transitions = [];

    console.log(`\n--- size=${byteSize} ---`);
    for (let round = 0; round < ROUNDS; ++round) {
      const fillValue = START_VALUE + round;
      const payload = buildPayload(byteSize, fillValue, round);
      const packedView = packr.pack(payload);
      const packed = toExactBuffer(packedView);

      const unsafeInfo = describeUnsafeBufferUse(packedView, packed);
      if (unsafeInfo) {
        ++unsafeBufferMismatches;
        if (!unsafeExample) {
          unsafeExample = {
            byteSize,
            round,
            fillValue,
            ...unsafeInfo,
          };
        }
      }

      if (previousPackedLength !== -1 && previousPackedLength !== packed.length) {
        transitions.push({
          round,
          fillValue,
          from: previousPackedLength,
          to: packed.length,
        });
        console.log(
          `size transition: round=${round} fillValue=${fillValue} ${previousPackedLength} -> ${packed.length}`
        );
      }
      previousPackedLength = packed.length;

      const writeTxn = db.startWrite();
      dbi.put(writeTxn, key, packed);
      writeTxn.commit();

      const readTxn = db.startRead();
      const stored = dbi.get(readTxn, key);
      readTxn.abort();

      assert.ok(Buffer.isBuffer(stored), `stored value must be Buffer for size=${byteSize}, round=${round}`);
      assert.strictEqual(
        stored.length,
        packed.length,
        `packed length mismatch for size=${byteSize}, round=${round}`
      );
      assert.strictEqual(
        stored.compare(packed),
        0,
        `stored bytes mismatch for size=${byteSize}, round=${round}`
      );

      const unpacked = packr.unpack(stored);
      assert.deepStrictEqual(
        unpacked,
        payload,
        `unpacked payload mismatch for size=${byteSize}, round=${round}`
      );
    }

    summaries.push({
      byteSize,
      lastPackedLength: previousPackedLength,
      transitions,
    });
  }

  db.closeSync();

  console.log("\n=== Summary ===");
  for (const summary of summaries) {
    console.log(
      `size=${summary.byteSize} lastPackedLength=${summary.lastPackedLength} transitions=${summary.transitions.length}`
    );
  }

  console.log("unsafe .buffer mismatches observed:", unsafeBufferMismatches);
  if (unsafeExample) {
    console.log("unsafe .buffer example:", JSON.stringify(unsafeExample));
    console.log(
      "unsafe note: use packed directly or Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength)"
    );
  }

  for (const summary of summaries) {
    assert.ok(
      summary.transitions.length >= 2,
      `expected at least two packed-size transitions for size=${summary.byteSize}, got ${summary.transitions.length}`
    );
  }

  console.log("e7 ok");
}

function runPackrCompareMode() {
  const comparePath = `${TEST_PATH}-compare`;
  fs.rmSync(comparePath, { recursive: true, force: true });

  const { keyMode } = MDBX_Param;
  const db = new MDBX_Env();
  db.openSync({ path: comparePath, maxDbi: 8 });

  const scenarios = [
    { id: 1, value: { id: 1, symbol: "EURUSD", price: 1.1, qty: 10 } },
    { id: 2, value: { id: 2, symbol: "EURUSD", price: 1.1, qty: 10, side: "buy" } },
    { id: 3, value: { id: 3, symbol: "EURUSD", price: 1.1, qty: 10, side: "buy", flags: [1, 2, 3] } },
    { id: 4, value: { id: 4, symbol: "EURUSD", price: 1.1, side: "buy", flags: [1, 2, 3] } },
    { id: 5, value: { id: 5, symbol: "EURUSD", price: 1.1, side: "buy", flags: [1, 2, 3], meta: { source: "e7", active: true } } },
  ];

  const configurations = [
    {
      label: "default-records",
      setup() {
        const packr = new Packr();
        return {
          writer: packr,
          sameReader: packr,
          freshReader: new Packr(),
          expectFreshFailure: false,
        };
      },
    },
    {
      label: "plain-useRecords-false",
      setup() {
        const packr = new Packr({ useRecords: false });
        return {
          writer: packr,
          sameReader: packr,
          freshReader: new Packr({ useRecords: false }),
          expectFreshFailure: false,
        };
      },
    },
    {
      label: "shared-structures",
      setup() {
        const structures = [];
        const packr = new Packr({ structures });
        return {
          writer: packr,
          sameReader: packr,
          freshReader: new Packr({ structures: [] }),
          structures,
          expectFreshFailure: true,
        };
      },
    },
  ];

  console.log("\n=== e7 packr compare mode ===");
  console.log("scenario: this.dbi.put(txn, key, this.packer.pack(value)) + this.packer.unpack(value)");

  for (const configuration of configurations) {
    const runtime = configuration.setup();
    const initTxn = db.startWrite();
    const dbi = initTxn.createMap(configuration.label, BigInt(keyMode.ordinal));
    initTxn.commit();

    const writeTxn = db.startWrite();
    for (const scenario of scenarios) {
      const packed = toExactBuffer(runtime.writer.pack(scenario.value));
      dbi.put(writeTxn, BigInt(scenario.id), packed);
    }
    writeTxn.commit();

    let freshFailures = 0;
    let freshFailureMessage = "";

    console.log(`\n--- compare=${configuration.label} ---`);
    for (const scenario of scenarios) {
      const readTxn = db.startRead();
      const stored = dbi.get(readTxn, BigInt(scenario.id));
      readTxn.abort();

      assert.ok(Buffer.isBuffer(stored), `${configuration.label}: stored value must be Buffer`);

      const sameDecoded = runtime.sameReader.unpack(stored);
      assert.deepStrictEqual(
        sameDecoded,
        scenario.value,
        `${configuration.label}: sameReader mismatch for scenario=${scenario.id}`
      );

      let freshStatus = "ok";
      try {
        const freshDecoded = runtime.freshReader.unpack(stored);
        assert.deepStrictEqual(
          freshDecoded,
          scenario.value,
          `${configuration.label}: freshReader mismatch for scenario=${scenario.id}`
        );
      } catch (error) {
        ++freshFailures;
        freshStatus = error.message;
        if (!freshFailureMessage) {
          freshFailureMessage = error.message;
        }
      }

      console.log(
        `scenario=${scenario.id} len=${stored.length} same=ok fresh=${freshStatus}`
      );
    }

    if (runtime.structures) {
      console.log("shared structures:", JSON.stringify(runtime.structures));
    }

    if (runtime.expectFreshFailure) {
      assert.ok(
        freshFailures > 0,
        `${configuration.label}: expected freshReader failures after structure evolution`
      );
      console.log(`fresh failures: ${freshFailures} first="${freshFailureMessage}"`);
    } else {
      assert.strictEqual(
        freshFailures,
        0,
        `${configuration.label}: did not expect freshReader failures`
      );
      console.log("fresh failures: 0");
    }
  }

  db.closeSync();
  console.log("e7 compare ok");
}

function main() {
  if (MODE === "roundtrip" || MODE === "all") {
    runRoundTripTest();
  }
  if (MODE === "compare" || MODE === "all") {
    runPackrCompareMode();
  }
}

main();

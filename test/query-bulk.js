"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");
const b = x => Buffer.from(x), Q = P.queryMode, A = P.bunchAction;
const put = (dbi, key, value, more = {}) => ({ dbi, mode: Q.upsert, item: [{key, value}], result: false, ...more });
const get = (dbi, key) => ({dbi, item: [{key}], push: true, result: false});
const bulk = (dbi, more = {}) => ({op: "bulk", dbi, action: "range", ...more});
async function fixture(run, options = {}, entries = ["a", "c", "e", "g"].map(k => [k, b(k)])) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "query-bulk-")), env = new MDBX_Env();
    try {
        env.openSync({path: dir, maxDbi: 12});
        const t = env.startWrite();
        const db = t.createMap({name: "data", ...options}), out = t.createMap("out");
        for (const [key,value] of entries) db.put(t, key, value);
        t.commit();
        const rows = (map = db) => {
            const t = env.startRead(), c = t.openCursor(map), result = [];
            try { for (let r = c.first(); r; r = c.next()) result.push(c.current_raw()); return result; }
            finally {c.close(); t.abort();}
        };
        await run({env, db, out, rows});
    } finally {env.closeSync(); fs.rmSync(dir, {recursive: true, force: true});}
}
for (const [name, args, removed] of [
    ["inclusive", {from: "c", to: "e"}, ["c", "e"]],
    ["exclusive", {from: "a", to: "g", includeFrom: false, includeTo: false}, ["c", "e"]],
    ["gaps", {from: "b", to: "f"}, ["c", "e"]],
    ["gaps-exclusive", {from: "b", to: "f", includeFrom: false, includeTo: false}, ["c", "e"]],
    ["open", {}, ["a", "c", "e", "g"]],
    ["open-null-exclusive", {from: null, to: null, includeFrom: false, includeTo: false}, ["a", "c", "e", "g"]],
    ["reverse", {from: "g", to: "a"}, []],
    ["same", {from: "c", to: "c"}, ["c"]],
    ["same-exclusive", {from: "c", to: "c", includeFrom: false}, []],
    ["below", {to: "0"}, []], ["above", {from: "z"}, []],
    ["upper-past-end", {from: "e", to: "z", includeTo: false}, ["e", "g"]],
]) test(`range ${name}`, () => fixture(async ({env, db, rows}) => {
    const before = rows(), deleted = before.filter(r => removed.includes(r.key.toString()));
    const result = await env.query(bulk(db, args));
    assert.deepEqual(result, {count: BigInt(deleted.length), first: deleted[0] ?? null, last: deleted.at(-1) ?? null});
    assert.deepEqual(rows(), before.filter(r => !removed.includes(r.key.toString())));
}));
const effects = {
    currentValue: ["c"], currentMultivalBeforeExcluding: [], currentMultivalBeforeIncluding: ["c"],
    currentMultivalAfterIncluding: ["c"], currentMultivalAfterExcluding: [], currentMultivalAll: ["c"],
    beforeExcluding: ["a"], beforeIncluding: ["a", "c"], afterIncluding: ["c", "e", "g"], afterExcluding: ["e", "g"], whole: ["a", "c", "e", "g"],
};
for (const [action, removed] of Object.entries(effects)) test(`bunch ${action}`, () => fixture(async ({env, db, rows}) => {
    const before = rows(), deleted = before.filter(r => removed.includes(r.key.toString()));
    const result = await env.query([bulk(db, {action: A[action], ...(action === "whole" ? {} : {key: "c"})})]);
    assert.deepEqual(result, {count: BigInt(deleted.length), first: deleted[0] ?? null, last: deleted.at(-1) ?? null});
    assert.deepEqual(rows(), before.filter(r => !removed.includes(r.key.toString())));
}));
test("missing keyed bunch and edge exclusions", () => fixture(async ({env, db, rows}) => {
    const before = rows();
    for (const action of Object.keys(effects).filter(k => k !== "whole"))
        assert.deepEqual(await env.query(bulk(db, {action: A[action], key: "absent"})), {count: 0n, first: null, last: null});
    for (const [action,key] of [[A.beforeExcluding,"a"], [A.afterExcluding,"g"]])
        assert.equal((await env.query(bulk(db, {action,key}))).count, 0n);
    assert.deepEqual(rows(), before);
}));
test("empty range and whole", () => fixture(async ({env,db}) => {
    for (const action of ["range", A.whole]) assert.deepEqual(await env.query(bulk(db,{action})), {count:0n, first:null,last:null});
}, {}, []));
for (const echo of [true,false]) test(`owning endpoints and stack outputs result:${echo}`, () => fixture(async ({env, db, out, rows}) => {
    const before = rows();
    const result = await env.query([
        bulk(db,{result:echo,push:["count","firstKey","firstValue","lastKey","lastValue","count"]}),
        put(db, "a", b("replacement")),
        ...["count2","lastValue","lastKey","firstValue","firstKey","count"].map(k => put(out,k,{pop:true})),
    ]);
    assert.deepEqual(result[0], echo ? {count:4n,first:before[0],last:before.at(-1)} : undefined);
    assert.deepEqual(rows(),[{key:b("a"),value:b("replacement")}]);
    assert.ok(result.slice(1).every(r=>r===undefined));
    const saved = Object.fromEntries(rows(out).map(r=>[r.key.toString(),r.value]));
    assert.equal(saved.count.readBigUInt64BE(),4n); assert.deepEqual(saved.count2,saved.count);
    assert.deepEqual(saved.firstKey,b("a")); assert.deepEqual(saved.lastValue,b("g"));
    assert.deepEqual(saved.lastKey,b("g")); assert.deepEqual(saved.firstValue,b("a"));
    assert.equal(await env.query(bulk(db,{result:false})),undefined);
}));
test("zero count remains present; missing endpoint rolls back whole batch", () => fixture(async ({env,db,out,rows})=>{
    await env.query([bulk(db,{from:"z",push:["count"],result:false}),put(out,"count",{pop:true})]);
    assert.equal(rows(out)[0].value.readBigUInt64BE(),0n);
    const before=rows();
    await assert.rejects(env.query([
        put(db,"new",b("v")),bulk(db,{from:"z",push:["firstKey"],result:false}),put(out,"bad",{pop:true}),
    ]),/operand missing/);
    assert.deepEqual(rows(),before); assert.equal(rows(out).length,1);
}));
test("bound pop order, missing input rollback, own output underflow", () => fixture(async ({env,db,out,rows})=>{
    await env.query([put(out,"lower",b("c")),put(out,"upper",b("e"))]);
    const result=await env.query([get(out,"upper"),get(out,"lower"),bulk(db,{from:{pop:true},to:{pop:true}})]);
    assert.equal(result[2].count,2n);
    const before=rows();
    await assert.rejects(env.query([put(db,"new",b("v")),get(out,"missing"),bulk(db,{from:{pop:true}})]),/operand missing/);
    assert.deepEqual(rows(),before);
    // Even if from lies past the end, a missing to operand must be resolved.
    await assert.rejects(env.query([get(out,"missing"),bulk(db,{from:"z",to:{pop:true}})]),/operand missing/);
    assert.throws(()=>env.query(bulk(db,{from:{pop:true},push:["firstKey"]})),/underflow/);
}));
test("invalid input rejected before Queue; readonly and late failure", () => fixture(async ({env,db,rows})=>{
    const before=rows();
    for(const args of [{from:undefined},{to:undefined},{action:100},{action:NaN},{action:"bad"},
        {action:A.whole,key:"a"},{action:A.currentValue},{action:A.currentValue,key:null},{includeTo:1},
        {push:true},{push:["bad"]},{result:1},{mode:Q.del},{item:[]},{key:"a"}])
        assert.throws(()=>env.query(bulk(db,args)));
    assert.throws(()=>env.query(bulk(db),P.txnMode.ro),/read-only/);
    await assert.rejects(env.query([bulk(db),{dbi:db,mode:Q.insertUnique,item:[{key:"x",value:b("1")},{key:"x",value:b("2")}]}]));
    assert.deepEqual(rows(),before);
}));
test("DUPSORT job rejected before mutation; previous writes rollback", () => fixture(async ({env,db,out,rows})=>{
    const before=rows();
    await assert.rejects(env.query([put(out,"rollback",b("v")),bulk(db)]),/unique DBI/);
    assert.deepEqual(rows(),before);assert.deepEqual(rows(out),[]);
}, {valueMode:P.valueMode.multi}));
for(const [name,options,entries] of [
    ["integer64",{keyMode:P.keyMode.ordinal},[1n,256n,1n<<63n].map(k=>[k,b("v")])],
    ["reverse",{keyMode:P.keyMode.reverse},["ab","ba","ac"].map(k=>[k,b(k)])],
    ["binary/string-output",{valueFlag:P.valueFlag.string},[[b([0,255]),"a"],[b([1,128]),""],[b([2,0]),"z"]]],
]) test(`raw endpoints and native comparator ${name}`,()=>fixture(async ({env,db,rows})=>{
    const before=rows();
    const ordered=entries.map(([k])=>k).sort((a,c)=>{
        const index=k=>before.findIndex(r=>typeof k==="bigint"?r.key.readBigUInt64LE()===k:r.key.equals(Buffer.isBuffer(k)?k:b(k)));
        return index(a)-index(c);
    });
    const result=await env.query(bulk(db,{from:ordered[0],to:ordered[1]}));
    assert.deepEqual(result,{count:2n,first:before[0],last:before[1]});assert.deepEqual(rows(),before.slice(2));
},options,entries));
test("large range has compact boundary result and no JS transaction",()=>fixture(async ({env,db})=>{
    Object.defineProperty(env,"startWrite",{value:()=>{throw Error("sync transaction forbidden");}});
    const result=await env.query(bulk(db));
    assert.equal(result.count,2000n);assert.equal(result.first.value.length,1024);assert.equal(result.last.value.length,1024);
}, {}, Array.from({length:2000},(_,i)=>[String(i).padStart(6,"0"),Buffer.alloc(1024,i%256)])));

test("literal bound bytes owned before Queue and concurrent jobs serialize",()=>fixture(async ({env,db})=>{
    const from=b("c"),to=b("e");
    const p=env.query(bulk(db,{from,to}));from.fill(0);to.fill(255);
    assert.equal((await p).count,2n);
    const results=await Promise.all([env.query(bulk(db)),env.query(bulk(db))]);
    assert.equal(results.reduce((n,r)=>n+r.count,0n),2n);
}));
test("integer32 comparator through raw key wrapper",()=>fixture(async ({env,db,rows})=>{
    const k=n=>{const v=Buffer.alloc(4);v.writeUInt32LE(n);return v;};
    const before=rows();
    assert.deepEqual(await env.query(bulk(db,{from:k(2),to:k(512)})),{count:2n,first:before[0],last:before[1]});
    assert.deepEqual(rows(),before.slice(2));
},{flags:0x40008,keyFlag:0},[2,512,65536].map(n=>{const k=Buffer.alloc(4);k.writeUInt32LE(n);return[k,b("v")];})));

test("ordinal bounds from byte stack preserve native endian and width",()=>fixture(async ({env,db,out,rows})=>{
    const before=rows();
    await env.query([put(out,"lower",before[1].key),put(out,"upper",before[2].key)]);
    const result=await env.query([get(out,"upper"),get(out,"lower"),bulk(db,{from:{pop:true},to:{pop:true}})]);
    assert.deepEqual(result[2],{count:2n,first:before[1],last:before[2]});
    assert.deepEqual(rows(),before.slice(0,1));
},{keyMode:P.keyMode.ordinal},[1n,256n,1n<<63n].map(k=>[k,b("v")])));

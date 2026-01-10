const { MDBX_Env, MDBX_Param } = require('../lib/nativemou.js');
const fs = require('fs');

const dbPath = './cursor-test-db';

// Очистка
if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
}
fs.mkdirSync(dbPath);

const env = new MDBX_Env();
env.openSync({ 
    path: dbPath, 
    flag: MDBX_Param.envFlag.nostickythreads | MDBX_Param.envFlag.writemap,
    mode: 664 
});

// Заполняем данные
{
    const txn = env.startWrite();
    const dbi = txn.createMap();
    
    for (let i = 1; i <= 10; i++) {
        dbi.put(txn, `key${i.toString().padStart(2, '0')}`, `value${i}`);
    }
    
    txn.commit();
}

// Тестируем курсор
{
    const txn = env.startRead();
    const dbi = txn.openMap();
    
    console.log('=== Cursor Test ===\n');
    
    const cursor = txn.openCursor(dbi);
    
    console.log('--- first() ---');
    let item = cursor.first();
    console.log('first:', item);
    
    console.log('\n--- next() loop ---');
    while ((item = cursor.next())) {
        console.log('next:', item);
    }
    
    console.log('\n--- last() ---');
    item = cursor.last();
    console.log('last:', item);
    
    console.log('\n--- prev() loop ---');
    while ((item = cursor.prev())) {
        console.log('prev:', item);
    }
    
    console.log('\n--- seekGE("key05") ---');
    item = cursor.seekGE('key05');
    console.log('seekGE:', item);
    
    console.log('\n--- seek("key07") ---');
    item = cursor.seek('key07');
    console.log('seek:', item);
    
    console.log('\n--- seek("nonexistent") ---');
    item = cursor.seek('nonexistent');
    console.log('seek:', item);
    
    console.log('\n--- forEach() ---');
    let count = 0;
    cursor.forEach(({key, value}) => {
        count++;
        console.log(`forEach[${count}]: ${key}`);
    });
    console.log('forEach total:', count);
    
    console.log('\n--- forEach() with early exit ---');
    let earlyCount = 0;
    cursor.forEach(({key}) => {
        earlyCount++;
        console.log(`early[${earlyCount}]: ${key}`);
        if (earlyCount >= 3) return false; // остановить после 3
    });
    console.log('forEach stopped after:', earlyCount);
    
    console.log('\n--- forEach(backward=true) ---');
    let backCount = 0;
    cursor.forEach(({key}) => {
        backCount++;
        if (backCount <= 3) console.log(`back[${backCount}]: ${key}`);
        if (backCount >= 3) return false;
    }, true);
    console.log('backward stopped after:', backCount);
    
    cursor.close();
    txn.abort();
}

// Тестируем cursor.put()
{
    console.log('\n=== Cursor Put Test ===\n');
    
    const txn = env.startWrite();
    const dbi = txn.openMap();
    const cursor = txn.openCursor(dbi);
    
    // Добавляем новые записи через курсор
    cursor.put('cursor_key1', 'cursor_value1');
    cursor.put('cursor_key2', 'cursor_value2');
    cursor.put('cursor_key3', 'cursor_value3');
    
    console.log('Added 3 keys via cursor.put()');
    
    // Проверяем что они добавились
    let item = cursor.seek('cursor_key1');
    console.log('seek cursor_key1:', item ? item.key : 'not found');
    
    item = cursor.seek('cursor_key2');
    console.log('seek cursor_key2:', item ? item.key : 'not found');
    
    item = cursor.seek('cursor_key3');
    console.log('seek cursor_key3:', item ? item.key : 'not found');
    
    cursor.close();
    txn.commit();
}

// Тестируем cursor.del()
{
    console.log('\n=== Cursor Del Test ===\n');
    
    const txn = env.startWrite();
    const dbi = txn.openMap();
    const cursor = txn.openCursor(dbi);
    
    // Считаем записи до удаления
    let count = 0;
    for (let item = cursor.first(); item; item = cursor.next()) {
        count++;
    }
    console.log('Records before del:', count);
    
    // Удаляем cursor_key2
    let item = cursor.seek('cursor_key2');
    if (item) {
        const deleted = cursor.del();
        console.log('Deleted cursor_key2:', deleted);
    }
    
    // Удаляем key05
    item = cursor.seek('key05');
    if (item) {
        const deleted = cursor.del();
        console.log('Deleted key05:', deleted);
    }
    
    // Считаем записи после удаления
    count = 0;
    for (item = cursor.first(); item; item = cursor.next()) {
        count++;
    }
    console.log('Records after del:', count);
    
    // Проверяем что удалённые записи не находятся
    item = cursor.seek('cursor_key2');
    console.log('seek cursor_key2 after del:', item ? 'found (ERROR!)' : 'not found (OK)');
    
    item = cursor.seek('key05');
    console.log('seek key05 after del:', item ? 'found (ERROR!)' : 'not found (OK)');
    
    cursor.close();
    txn.commit();
}

// Финальная проверка
{
    console.log('\n=== Final State ===\n');
    
    const txn = env.startRead();
    const dbi = txn.openMap();
    const cursor = txn.openCursor(dbi);
    
    console.log('All remaining records:');
    for (let item = cursor.first(); item; item = cursor.next()) {
        console.log(' ', item.key, '=', item.value.toString());
    }
    
    cursor.close();
    txn.abort();
}

// Тест защиты: commit/abort при открытых курсорах
{
    console.log('\n=== Cursor Count Protection Test ===\n');
    
    const txn = env.startRead();
    const dbi = txn.openMap();
    const cursor = txn.openCursor(dbi);
    cursor.first();
    
    // Пробуем abort без закрытия курсора
    try {
        txn.abort();
        console.log('ERROR: abort() should have thrown!');
        process.exit(1);
    } catch (e) {
        console.log('abort() correctly rejected:', e.message);
    }
    
    // Теперь закрываем курсор и пробуем снова
    cursor.close();
    txn.abort();
    console.log('After cursor.close() - abort() succeeded');
    
    // То же для commit
    const txn2 = env.startWrite();
    const dbi2 = txn2.createMap();
    const cursor2 = txn2.openCursor(dbi2);
    cursor2.first();
    
    try {
        txn2.commit();
        console.log('ERROR: commit() should have thrown!');
        process.exit(1);
    } catch (e) {
        console.log('commit() correctly rejected:', e.message);
    }
    
    cursor2.close();
    txn2.commit();
    console.log('After cursor.close() - commit() succeeded');
}

env.closeSync();

// Очистка
fs.rmSync(dbPath, { recursive: true });

console.log('\n=== All cursor tests passed! ===');

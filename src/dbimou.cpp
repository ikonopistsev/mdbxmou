#include "dbimou.hpp"
#include "envmou.hpp"
#include "txnmou.hpp"
#include "typemou.hpp"
#include <limits>

namespace mdbxmou {

namespace {

enum class range_output {
    items,
    keys,
    values,
};

std::size_t parse_size_option(const Napi::Env& env, const Napi::Object& options, const char* key)
{
    auto value = options.Get(key);
    if (value.IsUndefined() || value.IsNull()) {
        return std::numeric_limits<std::size_t>::max();
    }
    if (!value.IsNumber()) {
        throw Napi::TypeError::New(env, std::string(key) + " must be a number");
    }
    auto parsed = value.As<Napi::Number>().Int64Value();
    if (parsed < 0) {
        throw Napi::TypeError::New(env, std::string(key) + " must be >= 0");
    }
    return static_cast<std::size_t>(parsed);
}

bool parse_bool_option(const Napi::Env& env, const Napi::Object& options, const char* key, bool fallback)
{
    auto value = options.Get(key);
    if (value.IsUndefined() || value.IsNull()) {
        return fallback;
    }
    if (!value.IsBoolean()) {
        throw Napi::TypeError::New(env, std::string(key) + " must be a boolean");
    }
    return value.As<Napi::Boolean>().Value();
}

struct range_options final
{
    bool has_start{};
    bool has_end{};
    bool reverse{};
    bool include_start{true};
    bool include_end{true};
    std::size_t limit{std::numeric_limits<std::size_t>::max()};
    std::size_t offset{};
    std::uint64_t start_num{};
    std::uint64_t end_num{};
    buffer_type start_buf{};
    buffer_type end_buf{};
    keymou start_key{};
    keymou end_key{};
};

range_options parse_range_options(const Napi::Env& env, const Napi::Value& arg0, const dbimou& self)
{
    range_options options{};
    if (arg0.IsUndefined() || arg0.IsNull()) {
        return options;
    }
    if (!arg0.IsObject()) {
        throw Napi::TypeError::New(env, "getRange options must be an object");
    }

    auto obj = arg0.As<Napi::Object>();
    options.limit = parse_size_option(env, obj, "limit");

    auto offset = obj.Get("offset");
    if (!offset.IsUndefined() && !offset.IsNull()) {
        if (!offset.IsNumber()) {
            throw Napi::TypeError::New(env, "offset must be a number");
        }
        auto parsed = offset.As<Napi::Number>().Int64Value();
        if (parsed < 0) {
            throw Napi::TypeError::New(env, "offset must be >= 0");
        }
        options.offset = static_cast<std::size_t>(parsed);
    }

    options.reverse = parse_bool_option(env, obj, "reverse", false);
    options.include_start = parse_bool_option(env, obj, "includeStart", true);
    options.include_end = parse_bool_option(env, obj, "includeEnd", true);

    auto start = obj.Get("start");
    if (!start.IsUndefined() && !start.IsNull()) {
        options.has_start = true;
        options.start_key = mdbx::is_ordinal(self.get_key_mode()) ?
            keymou::from(start, env, options.start_num) :
            keymou::from(start, env, options.start_buf);
    }

    auto end = obj.Get("end");
    if (!end.IsUndefined() && !end.IsNull()) {
        options.has_end = true;
        options.end_key = mdbx::is_ordinal(self.get_key_mode()) ?
            keymou::from(end, env, options.end_num) :
            keymou::from(end, env, options.end_buf);
    }

    return options;
}

bool cursor_get(cursormou_managed& cursor, MDBX_cursor_op op, mdbx::slice& key, mdbx::slice& value)
{
    auto rc = ::mdbx_cursor_get(cursor, &key, &value, op);
    switch (rc) {
        case MDBX_SUCCESS:
        case MDBX_RESULT_TRUE:
            return true;
        case MDBX_NOTFOUND:
            return false;
        default:
            mdbx::error::throw_exception(rc);
            return false;
    }
}

bool outside_range(MDBX_txn* txn, MDBX_dbi dbi, const mdbx::slice& key, const range_options& options)
{
    if (options.reverse) {
        if (!options.has_start) {
            return false;
        }
        auto cmp = ::mdbx_cmp(
            txn, dbi,
            static_cast<const MDBX_val*>(&key),
            static_cast<const MDBX_val*>(&options.start_key));
        return cmp < 0 || (!options.include_start && cmp == 0);
    }

    if (!options.has_end) {
        return false;
    }
    auto cmp = ::mdbx_cmp(
        txn, dbi,
        static_cast<const MDBX_val*>(&key),
        static_cast<const MDBX_val*>(&options.end_key));
    return cmp > 0 || (!options.include_end && cmp == 0);
}

MDBX_cursor_op range_start_op(const range_options& options)
{
    if (options.reverse) {
        if (!options.has_end) {
            return MDBX_LAST;
        }
        return options.include_end ? MDBX_TO_KEY_LESSER_OR_EQUAL : MDBX_TO_KEY_LESSER_THAN;
    }

    if (!options.has_start) {
        return MDBX_FIRST;
    }
    return options.include_start ? MDBX_TO_KEY_GREATER_OR_EQUAL : MDBX_TO_KEY_GREATER_THAN;
}

MDBX_cursor_op range_turn_op(const range_options& options)
{
    return options.reverse ? MDBX_PREV : MDBX_NEXT;
}

Napi::Array collect_range(const Napi::Env& env, dbimou& self, txnmou& txn, const range_options& options, range_output output)
{
    Napi::Array result = Napi::Array::New(env);
    if (options.limit == 0) {
        return result;
    }

    auto conv = self.get_convmou();
    auto cursor = self.open_cursor(txn);
    mdbx::slice key{};
    mdbx::slice value{};

    if (options.reverse) {
        if (options.has_end) {
            key = options.end_key;
        }
    } else if (options.has_start) {
        key = options.start_key;
    }

    if (!cursor_get(cursor, range_start_op(options), key, value)) {
        return result;
    }

    std::size_t skipped{};
    std::size_t index{};
    auto turn_op = range_turn_op(options);

    while (true) {
        if (outside_range(txn, self.get_id(), key, options)) {
            break;
        }

        if (skipped < options.offset) {
            ++skipped;
        } else {
            switch (output) {
                case range_output::items: {
                    result.Set(index, conv.make_result(env, keymou{key}, valuemou{value}));
                    break;
                }
                case range_output::keys:
                    result.Set(index, conv.convert_key(env, keymou{key}));
                    break;
                case range_output::values:
                    result.Set(index, conv.convert_value(env, valuemou{value}));
                    break;
            }

            ++index;
            if (index >= options.limit) {
                break;
            }
        }

        if (!cursor_get(cursor, turn_op, key, value)) {
            break;
        }
    }

    return result;
}

Napi::Value run_range_query(const Napi::CallbackInfo& info, dbimou& self, const char* method_name, range_output output)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, std::string(method_name) + ": txnmou required");
    }

    auto txn = txnmou::unwrap_checked(env, info[0], method_name);

    try {
        auto options = info.Length() > 1 ?
            parse_range_options(env, info[1], self) :
            range_options{};
        return collect_range(env, self, *txn, options, output);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string(method_name) + ": " + e.what());
    }
}

} // namespace

Napi::FunctionReference dbimou::ctor{};

void dbimou::init(const char *class_name, Napi::Env env)
{
    auto func = DefineClass(env, class_name, {
        InstanceMethod("put", &dbimou::put),
        InstanceMethod("get", &dbimou::get),
        InstanceMethod("del", &dbimou::del),
        InstanceMethod("has", &dbimou::has),
        InstanceMethod("forEach", &dbimou::for_each),
        InstanceMethod("stat", &dbimou::stat),
        InstanceMethod("keys", &dbimou::keys),
        InstanceMethod("keysFrom", &dbimou::keys_from),
        InstanceMethod("getRange", &dbimou::get_range),
        InstanceMethod("keysRange", &dbimou::keys_range),
        InstanceMethod("valuesRange", &dbimou::values_range),
        InstanceMethod("drop", &dbimou::drop),
        
        // Свойства только для чтения
        InstanceAccessor("id", &dbimou::get_id, nullptr),
        InstanceAccessor("dbMode", &dbimou::get_mode, nullptr),
        InstanceAccessor("keyMode", &dbimou::get_key_mode, nullptr),
        InstanceAccessor("valueMode", &dbimou::get_value_mode, nullptr),
        InstanceAccessor("keyFlag", &dbimou::get_key_flag, nullptr),
        InstanceAccessor("valueFlag", &dbimou::get_value_flag, nullptr),
    });

    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
}

Napi::Value dbimou::put(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 3) {
        throw Napi::Error::New(env, "put: txnmou, key and value required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "put");
    try {
        std::uint64_t t;
        auto key = mdbx::is_ordinal(key_mode_) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);

        auto val = valuemou::from(info[2], env, val_buf_);
        dbi::put(*txn, key, val, *this);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("put: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::get(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "get: txnmou and key required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "get");

    try {
        auto conv = get_convmou();
        std::uint64_t t;
        auto key = mdbx::is_ordinal(key_mode_) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        
        auto val = dbi::get(*txn, key);
        if (val.is_null()) {
            return env.Undefined();
        }
        
        return conv.convert_value(env, val);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("get: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::del(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "del: txnmou and key required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "del");

    try {
        std::uint64_t t;
        auto key = mdbx::is_ordinal(key_mode_) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        
        bool result = dbi::del(*txn, key);
        return Napi::Value::From(env, result);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("del: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::has(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "has: txnmou and key required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "has");

    try {
        std::uint64_t t;
        auto key = mdbx::is_ordinal(key_mode_) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);

        bool result = dbi::has(*txn, key);
        return Napi::Value::From(env, result);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("has: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::for_each(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "for_each: txnmou and function required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "for_each");

    // Проверяем тип вызова: forEach(txn, fn), forEach(txn, fromKey, fn) или forEach(txn, fromKey, cursorMode, fn)
    if (info.Length() == 2 && info[1].IsFunction()) {
        // Обычный forEach(txn, fn)
        auto fn = info[1].As<Napi::Function>();
        
        try {
            auto conv = get_convmou();
            auto stat = get_stat(*txn);
            
            // Проверяем, есть ли записи в базе данных
            if (stat.ms_entries == 0) {
                return Napi::Number::New(env, 0);
            }

            auto cursor = open_cursor(*txn);
            uint32_t index{};
            cursor.scan([&](const mdbx::pair& f) {
                keymou key{f.key};
                valuemou val{f.value};
                Napi::Value result = fn.Call({
                    conv.convert_key(env, key),
                    conv.convert_value(env, val),
                    Napi::Number::New(env, static_cast<double>(index))
                });

                index++;

                // true will stop the scan, false will continue
                return result.IsBoolean() ? result.ToBoolean() : false;
            });

            return Napi::Number::New(env, static_cast<double>(index));
        } catch (const std::exception& e) {
            throw Napi::Error::New(env, std::string("forEach: ") + e.what());
        }

    } else if ((info.Length() == 3 && info[2].IsFunction()) || 
               (info.Length() == 4 && info[3].IsFunction())) {
        // forEach(txn, fromKey, fn) или forEach(txn, fromKey, cursorMode, fn) - делегируем внутреннему методу
        return for_each_from(info);
        
    } else {
        throw Napi::TypeError::New(env, "Expected (txn, function), (txn, key, function) or (txn, key, cursorMode, function)");
    }
}

Napi::Value dbimou::for_each_from(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    
    if (arg_len < 3) {
        throw Napi::Error::New(env, "for_each_from: txnmou, fromKey and function required");
    }
    
    auto txn = txnmou::unwrap_checked(env, info[0], "for_each_from");
    
    // Определяем позицию функции: info[2] или info[3]
    Napi::Function fn;
    if (info.Length() == 3 && info[2].IsFunction()) {
        fn = info[2].As<Napi::Function>();
    } else if (info.Length() == 4 && info[3].IsFunction()) {
        fn = info[3].As<Napi::Function>();
    } else {
        throw Napi::TypeError::New(env, "Function argument required");
    }
    
    try {
        auto conv = get_convmou();
        auto cursor = dbi::open_cursor(*txn);
        auto stat = dbi::get_stat(*txn);
        
        // Проверяем, есть ли записи в базе данных
        if (stat.ms_entries == 0) {
            return Napi::Number::New(env, 0);
        }
        
        // Парсим начальный ключ
        std::uint64_t t;
        keymou from_key = (mdbx::is_ordinal(key_mode_)) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        
        // Парсим cursor mode (если передан)
        using move_operation = mdbx::cursor::move_operation;
        auto cursor_mode = move_operation::key_greater_or_equal;
        auto turn_mode = move_operation::next;

        if (info.Length() == 4 && !info[2].IsUndefined()) {
            cursor_mode = parse_cursor_mode(info[2]);
            
            // Определяем направление сканирования на основе операции
            switch (cursor_mode) {
                case move_operation::key_lesser_than:
                case move_operation::key_lesser_or_equal:
                case move_operation::multi_exactkey_value_lesser_than:
                case move_operation::multi_exactkey_value_lesser_or_equal:
                    turn_mode = move_operation::previous;
                    break;
                case move_operation::key_equal:
                case move_operation::multi_exactkey_value_equal:
                    // Для точного совпадения останавливаемся на первом найденном элементе
                    turn_mode = move_operation::next;
                    break;
                default:
                    turn_mode = move_operation::next;
                    break;
            }
        }
        
        std::size_t index{};
        bool is_key_equal_mode = (cursor_mode == move_operation::key_equal || 
                                  cursor_mode == move_operation::multi_exactkey_value_equal);
        cursor.scan_from([&](const mdbx::pair& f) {
            keymou key{f.key};
            valuemou val{f.value};
            if (is_key_equal_mode) {
                if (mdbx::is_ordinal(key_mode_)) {
                    if (t != key.as_int64()) {
                        return true; // останавливаем сканирование
                    }
                } else if (from_key != key) {
                    return true; // останавливаем сканирование
                }
            }

            Napi::Value result = fn.Call({
                conv.convert_key(env, key),
                conv.convert_value(env, val),
                Napi::Number::New(env, static_cast<double>(index))
            });

            index++;

            // true will stop the scan, false will continue
            return result.IsBoolean() ? result.ToBoolean() : false;
        }, from_key, cursor_mode, turn_mode);

        return Napi::Number::New(env, static_cast<double>(index));
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("forEach_from: ") + e.what());
    }
}

Napi::Value dbimou::stat(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 1) {
        throw Napi::Error::New(env, "stat: txnmou required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "stat");
    
    try {
        auto stat = dbi::get_stat(*txn);
        
        Napi::Object result = Napi::Object::New(env);
        
        result.Set("pageSize", Napi::Number::New(env, stat.ms_psize));
        result.Set("depth", Napi::Number::New(env, stat.ms_depth));
        result.Set("branchPages", Napi::Number::New(env, 
            static_cast<double>(stat.ms_branch_pages)));
        result.Set("leafPages", Napi::Number::New(env, 
            static_cast<double>(stat.ms_leaf_pages)));
        result.Set("overflowPages", Napi::Number::New(env, 
            static_cast<double>(stat.ms_overflow_pages)));
        result.Set("entries", Napi::Number::New(env, 
            static_cast<double>(stat.ms_entries)));
        result.Set("modTxnId", Napi::Number::New(env, 
            static_cast<double>(stat.ms_mod_txnid)));
        return result;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("stat: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::keys(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 1) {
        throw Napi::Error::New(env, "keys: txnmou required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "keys");
    
    try {
        auto conv = get_convmou();
        auto stat = get_stat(*txn);
        
        // Создаем массив для ключей
        Napi::Array keys = Napi::Array::New(env, stat.ms_entries);
        if (stat.ms_entries == 0) {
            return keys;
        }

        // Используем batch версию для лучшей производительности
        auto cursor = open_cursor(*txn);

        // Буфер для batch - MDBXMOU_BATCH_LIMIT/2 пар (key, value)
#ifndef MDBXMOU_BATCH_LIMIT
#define MDBXMOU_BATCH_LIMIT 512
#endif // MDBXMOU_BATCH_LIMIT
        std::array<mdbx::slice, MDBXMOU_BATCH_LIMIT> pairs;

        uint32_t index{};
        
        // Первый вызов с MDBX_FIRST
        size_t count = cursor.get_batch(pairs, MDBX_FIRST);
        
        while (count > 0) {
            // pairs[0] = key1, pairs[1] = value1, pairs[2] = key2, ...
            for (size_t i = 0; i < count; i += 2) {
                keymou key{pairs[i]};
                keys.Set(index++, conv.convert_key(env, key));
            }
            
            // Следующий batch
            count = cursor.get_batch(pairs, MDBX_NEXT);
        }

        return keys;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("keys: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::keys_from(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "keysFrom: txnmou and 'from' key required");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "keysFrom");

    try {
        auto conv = get_convmou();
        auto cursor = dbi::open_cursor(*txn);
        
        // Парсим аргументы: txn, from, limit, cursorMode
        std::uint64_t t;
        keymou from_key = (mdbx::is_ordinal(key_mode_)) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        
        std::size_t count = SIZE_MAX;
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            count = info[2].As<Napi::Number>().Uint32Value();
        }
        
        using move_operation = mdbx::cursor::move_operation;
        auto cursor_mode = move_operation::key_greater_or_equal;
        auto turn_mode = move_operation::next;

        if (info.Length() > 3 && !info[3].IsUndefined()) {
            cursor_mode = parse_cursor_mode(info[3]);
            
            // Определяем направление сканирования на основе операции
            switch (cursor_mode) {
                case move_operation::key_lesser_than:
                case move_operation::key_lesser_or_equal:
                case move_operation::multi_exactkey_value_lesser_than:
                case move_operation::multi_exactkey_value_lesser_or_equal:
                    turn_mode = move_operation::previous;
                    break;
                case move_operation::key_equal:
                case move_operation::multi_exactkey_value_equal:
                    // Для точного совпадения останавливаемся на первом найденном элементе
                    turn_mode = move_operation::next;
                    break;
                default:
                    turn_mode = move_operation::next;
                    break;
            }
        }
        
        // Создаем массив для ключей
        Napi::Array keys = Napi::Array::New(env);
        uint32_t index{};
        bool is_key_equal_mode = (cursor_mode == move_operation::key_equal || 
            cursor_mode == move_operation::multi_exactkey_value_equal);
        
        cursor.scan_from([&](const mdbx::pair& f) {
            if (index >= count) {
                return true; // останавливаем сканирование
            }

            keymou key{f.key};
            if (is_key_equal_mode) {
                if (mdbx::is_ordinal(key_mode_)) {
                    if (t != key.as_int64()) {
                        return true; // останавливаем сканирование
                    }
                } else if (from_key != key) {
                    return true; // останавливаем сканирование
                }
            }

            keys.Set(index++, conv.convert_key(env, key));

            return false; // продолжаем сканирование
        }, from_key, cursor_mode, turn_mode);
        
        return keys;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("keysFrom: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::get_range(const Napi::CallbackInfo& info)
{
    return run_range_query(info, *this, "getRange", range_output::items);
}

Napi::Value dbimou::keys_range(const Napi::CallbackInfo& info)
{
    return run_range_query(info, *this, "keysRange", range_output::keys);
}

Napi::Value dbimou::values_range(const Napi::CallbackInfo& info)
{
    return run_range_query(info, *this, "valuesRange", range_output::values);
}

Napi::Value dbimou::drop(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, "First argument must be a transaction");
    }
    auto txn = txnmou::unwrap_checked(env, info[0], "drop");
    bool delete_db = false;
    if (info.Length() > 1 && info[1].IsBoolean()) {
        delete_db = info[1].As<Napi::Boolean>().Value();
    }
    try {
        dbi::drop(*txn, delete_db);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("drop: ") + e.what());
    }
    return env.Undefined();
}

} // namespace mdbxmou

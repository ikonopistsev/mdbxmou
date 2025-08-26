#include "dbimou.hpp"
#include "envmou.hpp"
#include "txnmou.hpp"
#include "typemou.hpp"

namespace mdbxmou {

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
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "put: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);
    try {
        std::uint64_t t;
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        auto val = valuemou::from(info[2], env, val_buf_);
        dbi::put(*txn, key, val, *this);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("put: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::get(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "get: txnmou and key required");
    }
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "get: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);

    try {
        std::uint64_t t;
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        
        auto val = dbi::get(*txn, key);
        if (val.is_null()) {
            return env.Undefined();
        }
        
        return (value_flag_.val & base_flag::string) ? 
            val.to_string(env) : val.to_buffer(env);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("get: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::del(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "del: txnmou and key required");
    }
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "del: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);

    try {
        std::uint64_t t;
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        
        bool result = dbi::del(*txn, key);
        return Napi::Value::From(env, result);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("del: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::has(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "has: txnmou and key required");
    }
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "has: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);

    try {
        std::uint64_t t;
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[1], env, t) : 
            keymou::from(info[1], env, key_buf_);
        
        bool result = dbi::has(*txn, key);
        return Napi::Value::From(env, result);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("has: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::for_each(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "for_each: txnmou and function required");
    }
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "for_each: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);

    // Проверяем тип вызова: forEach(txn, fn), forEach(txn, fromKey, fn) или forEach(txn, fromKey, cursorMode, fn)
    if (info.Length() == 2 && info[1].IsFunction()) {
        // Обычный forEach(txn, fn)
        auto fn = info[1].As<Napi::Function>();
        
        try {
            auto cursor = dbi::open_cursor(*txn);
            auto stat = dbi::get_stat(*txn);
            
            // Проверяем, есть ли записи в базе данных
            if (stat.ms_entries == 0) {
                return Napi::Number::New(env, 0);
            }
            
            uint32_t index{};

            if (key_mode_.val & key_mode::ordinal) {
                cursor.scan([&](const mdbx::pair& f) {
                    keymou key{f.key};
                    valuemou val{f.value};
                    // Конвертируем ключ
                    Napi::Value rc_key = (key_flag_.val & base_flag::bigint) ?
                        key.to_bigint(env) : key.to_number(env);
                    // Конвертируем значение
                    Napi::Value rc_val = (value_flag_.val & base_flag::string) ?
                        val.to_string(env) : val.to_buffer(env);

                    Napi::Value result = fn.Call({ rc_key, rc_val, 
                        Napi::Number::New(env, static_cast<double>(index)) });

                    index++;

                    // true will stop the scan, false will continue
                    return result.IsBoolean() ? result.ToBoolean() : false;
                });
            } else {
                cursor.scan([&](const mdbx::pair& f) {
                    keymou key{f.key};
                    valuemou val{f.value};
                    // Конвертируем ключ
                    Napi::Value rc_key = (key_flag_.val & base_flag::string) ?
                        key.to_string(env) : key.to_buffer(env);

                    // Конвертируем значение
                    Napi::Value rc_val = (value_flag_.val & base_flag::string) ?
                        val.to_string(env) : val.to_buffer(env);
                    
                    Napi::Value result = fn.Call({ rc_key, rc_val, 
                        Napi::Number::New(env, static_cast<double>(index)) });

                    index++;

                    // true will stop the scan, false will continue
                    return result.IsBoolean() ? result.ToBoolean() : false;
                });
            }

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

Napi::Value dbimou::for_each_from(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    
    if (arg_len < 3) {
        throw Napi::Error::New(env, "for_each_from: txnmou, fromKey and function required");
    }
    
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "for_each_from: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);
    
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
        auto cursor = dbi::open_cursor(*txn);
        auto stat = dbi::get_stat(*txn);
        
        // Проверяем, есть ли записи в базе данных
        if (stat.ms_entries == 0) {
            return Napi::Number::New(env, 0);
        }
        
        // Парсим начальный ключ
        std::uint64_t t;
        keymou from_key = (key_mode_.val & key_mode::ordinal) ?
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
        if (key_mode_.val & key_mode::ordinal) {
            cursor.scan_from([&](const mdbx::pair& f) {
                keymou key{f.key};
                valuemou val{f.value};
                if (is_key_equal_mode) {
                    if (t != key.as_int64()) {
                        return true; // останавливаем сканирование
                    }
                }

                // Конвертируем ключ
                Napi::Value rc_key = (key_flag_.val & base_flag::bigint) ?
                    key.to_bigint(env) : key.to_number(env);
                // Конвертируем значение
                Napi::Value rc_val = (value_flag_.val & base_flag::string) ?
                    val.to_string(env) : val.to_buffer(env);

                Napi::Value result = fn.Call({ rc_key, rc_val, 
                    Napi::Number::New(env, static_cast<double>(index)) });

                index++;

                // true will stop the scan, false will continue
                return result.IsBoolean() ? result.ToBoolean() : false;
            }, from_key, cursor_mode, turn_mode);
        } else {
            cursor.scan_from([&](const mdbx::pair& f) {
                keymou key{f.key};
                valuemou val{f.value};
                if (is_key_equal_mode) {
                    if (from_key != key) {
                        return true; // останавливаем сканирование
                    }
                }

                // Конвертируем ключ
                Napi::Value rc_key = (key_flag_.val & base_flag::string) ?
                    key.to_string(env) : key.to_buffer(env);

                // Конвертируем значение
                Napi::Value rc_val = (value_flag_.val & base_flag::string) ?
                    val.to_string(env) : val.to_buffer(env);
                
                Napi::Value result = fn.Call({ rc_key, rc_val, 
                    Napi::Number::New(env, static_cast<double>(index)) });

                index++;

                // true will stop the scan, false will continue
                return result.IsBoolean() ? result.ToBoolean() : false;
            }, from_key, cursor_mode, turn_mode);
        }

        return Napi::Number::New(env, static_cast<double>(index));
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("forEach_from: ") + e.what());
    }
}

Napi::Value dbimou::stat(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 1) {
        throw Napi::Error::New(env, "stat: txnmou required");
    }
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "stat: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);
    
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

Napi::Value dbimou::keys(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 1) {
        throw Napi::Error::New(env, "keys: txnmou required");
    }
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "keys: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);
    
    try {
        auto cursor = dbi::open_cursor(*txn);
        auto stat = dbi::get_stat(*txn);
        
        // Создаем массив для ключей
        Napi::Array keys = Napi::Array::New(env, stat.ms_entries);
        if (stat.ms_entries == 0) {
            return keys;
        }

        uint32_t index{};
        if (key_mode_.val & key_mode::ordinal) {
            cursor.scan([&](const mdbx::pair& f) {
                keymou key{f.key};
                // Конвертируем ключ
                Napi::Value rc_key = (key_flag_.val & base_flag::bigint) ?
                    key.to_bigint(env) : key.to_number(env);
                
                keys.Set(index++, rc_key);
                return false; // продолжаем сканирование
            });
        } else {
            cursor.scan([&](const mdbx::pair& f) {
                keymou key{f.key};
                // Конвертируем ключ
                Napi::Value rc_key = (key_flag_.val & base_flag::string) ?
                    key.to_string(env) : key.to_buffer(env);
                
                keys.Set(index++, rc_key);
                return false; // продолжаем сканирование
            });
        }

        return keys;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("keys: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::keys_from(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "keysFrom: txnmou and 'from' key required");
    }
    auto arg0 = info[0].As<Napi::Object>();
    // Дополнительная проверка - есть ли у объекта нужный constructor
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        throw Napi::TypeError::New(env, "keysFrom: first argument must be MDBX_Txn instance");
    }    
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);

    try {
        auto cursor = dbi::open_cursor(*txn);
        
        // Парсим аргументы: txn, from, limit, cursorMode
        std::uint64_t t;
        keymou from_key = (key_mode_.val & key_mode::ordinal) ?
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
        
        if (key_mode_.val & key_mode::ordinal) {
            cursor.scan_from([&](const mdbx::pair& f) {
                if (index >= count) {
                    return true; // останавливаем сканирование
                }
                
                keymou key{f.key};
                if (is_key_equal_mode) {
                    if (t != key.as_int64()) {
                        return true; // останавливаем сканирование
                    }
                }

                // Конвертируем ключ
                Napi::Value rc_key = (key_flag_.val & base_flag::bigint) ?
                    key.to_bigint(env) : key.to_number(env);
                
                keys.Set(index++, rc_key);
                                
                return false; // продолжаем сканирование
            }, from_key, cursor_mode, turn_mode);
        } else {     
            cursor.scan_from([&](const mdbx::pair& f) {
                if (index >= count) {
                    return true; // останавливаем сканирование
                }

                keymou key{f.key};
                if (is_key_equal_mode) {
                    if (from_key != key) {
                        return true; // останавливаем сканирование
                    }
                }                

                // Конвертируем ключ
                Napi::Value rc_key = (key_flag_.val & base_flag::string) ?
                    key.to_string(env) : key.to_buffer(env);
                
                keys.Set(index++, rc_key);
                
                return false; // продолжаем сканирование
            }, from_key, cursor_mode, turn_mode);
        }
        
        return keys;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("keysFrom: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::drop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "First argument must be a transaction").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto arg0 = info[0].As<Napi::Object>();
    if (!arg0.InstanceOf(txnmou::ctor.Value())) {
        Napi::TypeError::New(env, "First argument must be a txnmou instance").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto txn = Napi::ObjectWrap<txnmou>::Unwrap(arg0);
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
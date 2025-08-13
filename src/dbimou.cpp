#include "dbimou.hpp"
#include "envmou.hpp"
#include "txnmou.hpp"

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
    });

    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
}

Napi::Value dbimou::put(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "put: key and value required");
    }

    try {
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[0], env, id_buf_) : 
            keymou::from(info[0], env, key_buf_);
        auto val = valuemou::from(info[1], env, val_buf_);
        auto flag = static_cast<MDBX_put_flags_t>(key_mode_.val & value_mode_.val);
        auto rc = mdbx_put(*txn_, dbi_, key, val, flag);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("put: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::get(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        throw Napi::Error::New(env, "get: key required");
    }

    try {
        valuemou val{};
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[0], env, id_buf_) : 
            keymou::from(info[0], env, key_buf_);
        auto rc = mdbx_get(*txn_, dbi_, key, val);
        if (rc == MDBX_NOTFOUND)
            return env.Undefined();
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
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

    if (info.Length() < 1) {
        throw Napi::Error::New(env, "del: key required");
    }

    try {
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[0], env, id_buf_) : 
            keymou::from(info[0], env, key_buf_);
        auto rc = mdbx_del(*txn_, dbi_, key, nullptr);
        if (rc == MDBX_NOTFOUND) {
            return Napi::Value::From(env, false);
        }
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }
        return Napi::Value::From(env, true);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("del: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::has(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Key is required");
    }

    try {
        auto key = (key_mode_.val & key_mode::ordinal) ?
            keymou::from(info[0], env, id_buf_) : 
            keymou::from(info[0], env, key_buf_);
        auto rc = mdbx_get(*txn_, dbi_, key, nullptr);
        if (rc == MDBX_NOTFOUND) {
            return Napi::Value::From(env, false);
        }
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }
        return Napi::Value::From(env, true);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("has: ") + e.what());
    }

    return env.Undefined();
}

Napi::Value dbimou::for_each(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!info[0].IsFunction()) {
        throw Napi::TypeError::New(env, "Expected function");
    }
    auto fn = info[0].As<Napi::Function>();
    
    MDBX_cursor* cursor_ptr;
    auto rc = mdbx_cursor_open(*txn_, dbi_, &cursor_ptr);
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }
    
    std::size_t index{};

    try {
        cursormou_managed cursor{ cursor_ptr };
        if (key_mode_.val & key_mode::ordinal) {
            cursor.scan([&](const mdbx::pair& f) {
                keymou key{f.key};
                valuemou val{f.value};
                // Конвертируем ключ
                Napi::Value rc_key;
                    rc_key = (key_flag_.val & base_flag::bigint) ?
                        key.to_bigint(env) : key.to_number(env);
                // Конвертируем значение
                Napi::Value rc_val = (value_flag_.val & base_flag::string) ?
                    val.to_string(env) : val.to_buffer(env);

                Napi::Value result = fn.Call({ rc_key, rc_val, 
                    Napi::Number::New(env, index) });

                index++;

                return result.IsBoolean() ? 
                    result.ToBoolean() : false;
            });
        } else {
            cursor.scan([&](const mdbx::pair& f) {
                keymou key{f.key};
                valuemou val{f.value};
                // Конвертируем ключ
                Napi::Value rc_key;
                rc_key = (key_flag_.val & base_flag::string) ?
                    key.to_string(env) : key.to_buffer(env);

                // Конвертируем значение
                Napi::Value rc_val = (value_flag_.val & base_flag::string) ?
                    val.to_string(env) : val.to_buffer(env);
                
                Napi::Value result = fn.Call({ rc_key, rc_val, 
                    Napi::Number::New(env, index) });

                index++;

                return result.IsBoolean() ? 
                    result.ToBoolean() : false;
            });
        }

    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("forEach: ") + e.what());
    }

    return Napi::Number::New(env, index);
}

Napi::Value dbimou::stat(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        auto stat = get_stat(*txn_, dbi_);
        
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
    
    MDBX_cursor* cursor_ptr;
    auto rc = mdbx_cursor_open(*txn_, dbi_, &cursor_ptr);
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }
    // сохраняем курсор в уникальном указателе
    cursormou_managed cursor{ cursor_ptr };

    try {
        auto arg0 = get_env_userctx(*env_);
        auto stat = get_stat(*txn_, dbi_);
        // Создаем массив для ключей
        Napi::Array keys = Napi::Array::New(env, stat.ms_entries);
        if (stat.ms_entries == 0) {
            return keys;
        }
            
        keymou key{};
        // Получаем первую запись
        rc = mdbx_cursor_get(cursor, key, nullptr, MDBX_FIRST);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

        std::size_t index = 0;
        do {
            // Конвертируем ключ
            Napi::Value rc_key;
            if (key_mode_.val & key_mode::ordinal) {
                rc_key = (key_flag_.val & base_flag::bigint) ?
                    key.to_bigint(env) : key.to_number(env);
            } else {
                rc_key = (key_flag_.val & base_flag::string) ?
                    key.to_string(env) : key.to_buffer(env);
            }

            keys.Set(index++, rc_key);
            
            // Переходим к следующей записи
            rc = mdbx_cursor_get(cursor, key, nullptr, MDBX_NEXT);
        } while (rc == MDBX_SUCCESS);
        
        if (!((rc == MDBX_NOTFOUND) || (rc == MDBX_SUCCESS))) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }
        if (index != stat.ms_entries) {
            throw Napi::Error::New(env, "Keys count mismatch?");
        }

        return keys;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("keys: ") + e.what());
    }

    return env.Undefined();
}

const env_arg0* dbimou::get_env_userctx(MDBX_env* e) 
{
    assert(e);
    auto rc = static_cast<env_arg0*>(mdbx_env_get_userctx(e));
    if (!rc)
        throw std::runtime_error("env: userctx not set");
    return rc;
} 

} // namespace mdbxmou
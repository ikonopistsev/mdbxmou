#include "dbimou.hpp"
#include "envmou.hpp"
#include "txnmou.hpp"

namespace mdbxmou {

Napi::FunctionReference dbimou::ctor{};

static inline MDBX_val cast(Napi::Env env, 
    const Napi::Value &from, std::string& holder) // +stdexcept
{
    MDBX_val rc{};
    
    if (from.IsBuffer())        
    {
        auto key = from.As<Napi::Buffer<char>>();
        rc = MDBX_val{key.Data(), key.Length()};
    } else if (from.IsString()) {
        size_t length;
        napi_status status =
            napi_get_value_string_utf8(env, from, nullptr, 0, &length);
        NAPI_THROW_IF_FAILED(env, status, "");

        holder.reserve(length + 1);
        holder.resize(length);

        status = napi_get_value_string_utf8(
            env, from, holder.data(), holder.capacity(), nullptr);
        NAPI_THROW_IF_FAILED(env, status, "");

        rc = MDBX_val{holder.data(), holder.size()};
    } else {
        throw Napi::TypeError::New(env, "expected string or buffer");
    }

    return rc;
}

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

void dbimou::init(const char *class_name, Napi::Env env, Napi::Object exports) 
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
    exports.Set(class_name, func);
}

Napi::Value dbimou::put(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    auto arg_len = info.Length();
    if (arg_len < 2) {
        throw Napi::Error::New(env, "put: key and value required");
    }

    MDBX_put_flags flags{MDBX_UPSERT};
    if (arg_len == 3) {
        flags = static_cast<MDBX_put_flags>(info[2].As<Napi::Number>().Int32Value());
    }

    try {
        auto key = cast(env, info[0], key_buf_);
        auto val = cast(env, info[1], val_buf_);
        auto rc = mdbx_put(*txn_, dbi_, &key, &val, flags);
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
        auto arg0 = get_env_userctx(*env_);
        auto key = cast(env, info[0], key_buf_);

        MDBX_val val{};
        auto rc = mdbx_get(*txn_, dbi_, &key, &val);
        if (rc == MDBX_NOTFOUND)
            return env.Undefined();

        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }        

        auto p = static_cast<const char*>(val.iov_base);
        if (arg0->key_string) {
            return Napi::String::New(env, p, val.iov_len);
        }
        return Napi::Buffer<char>::Copy(env, p, val.iov_len);
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
        auto key = cast(env, info[0], key_buf_);
        auto rc = mdbx_del(*txn_, dbi_, &key, nullptr);
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
        auto key = cast(env, info[0], key_buf_);
        auto rc = mdbx_get(*txn_, dbi_, &key, nullptr);
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
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        throw Napi::TypeError::New(env, "Expected a function as the first argument");
    }

    Napi::Function fn = info[0].As<Napi::Function>();
    
    MDBX_cursor* cursor;
    auto rc = mdbx_cursor_open(*txn_, dbi_, &cursor);
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }
    // сохраняем курсор в уникальном указателе
    cursor_ptr cursor_guard(cursor);

    MDBX_val key, val;
    // Получаем первую запись
    rc = mdbx_cursor_get(cursor, &key, &val, MDBX_FIRST);
    if (rc == MDBX_NOTFOUND) {
        return env.Undefined();
    }
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }        
    try {
        auto arg0 = get_env_userctx(*env_);
        std::size_t index{};
        // Перебираем все записи
        do {
            // Конвертируем ключ
            Napi::Value rc_key;
            auto p = static_cast<const char*>(key.iov_base);
            if (arg0->key_string) {
                rc_key = Napi::String::New(env, p, key.iov_len);
            } else {
                rc_key = Napi::Buffer<char>::Copy(env, p, key.iov_len);
            }
            
            // Конвертируем значение
            Napi::Value rc_val;
            p = static_cast<const char*>(val.iov_base);
            if (arg0->val_string) {
                rc_val = Napi::String::New(env, p, val.iov_len);
            } else {
                rc_val = Napi::Buffer<char>::Copy(env, p, val.iov_len);
            }
            
            // Вызываем callback(value, key, index)
            Napi::Value result = fn.Call({ rc_key, rc_val, 
                Napi::Number::New(env, index) });
            
            // Проверяем, если callback вернул false - прерываем итерацию
            if (result.IsBoolean() && !result.ToBoolean()) {
                break;
            }
            
            ++index;
            
            // Переходим к следующей записи
            rc = mdbx_cursor_get(cursor, &key, &val, MDBX_NEXT);
            
        } while (rc == MDBX_SUCCESS);
        
        if (!((rc == MDBX_NOTFOUND) || (rc == MDBX_SUCCESS))) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, std::string("forEach: ") + e.what());
    }

    return env.Undefined();
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
    
    MDBX_cursor* cursor;
    auto rc = mdbx_cursor_open(*txn_, dbi_, &cursor);
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }
    // сохраняем курсор в уникальном указателе
    cursor_ptr cursor_guard(cursor);

    try {
        auto arg0 = get_env_userctx(*env_);
        auto stat = get_stat(*txn_, dbi_);
        // Создаем массив для ключей
        Napi::Array keys = Napi::Array::New(env, stat.ms_entries);
        if (stat.ms_entries == 0) {
            return keys;
        }
            
        MDBX_val key, val;
        // Получаем первую запись
        rc = mdbx_cursor_get(cursor, &key, &val, MDBX_FIRST);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

        std::size_t index = 0;
        do {
            // Конвертируем ключ
            Napi::Value js_key;
            auto p = static_cast<const char*>(key.iov_base);
            if (arg0->key_string) {
                js_key = Napi::String::New(env, p, key.iov_len);
            } else {
                js_key = Napi::Buffer<char>::Copy(env, p, key.iov_len);
            }
            keys.Set(index++, js_key);
            
            // Переходим к следующей записи
            rc = mdbx_cursor_get(cursor, &key, &val, MDBX_NEXT);
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
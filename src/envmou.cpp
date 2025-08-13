#include "envmou.hpp"
#include "txnmou.hpp"
#include "async/envmou_copy_to.hpp"
#include "async/envmou_query.hpp"
#include "async/envmou_open.hpp"
#include "async/envmou_keys.hpp"
#include "async/envmou_close.hpp"

namespace mdbxmou {

Napi::FunctionReference envmou::ctor{};

void envmou::init(const char *class_name, Napi::Env env, Napi::Object exports)
{
    auto func = DefineClass(env, class_name, {
        InstanceMethod("open", &envmou::open),
        InstanceMethod("openSync", &envmou::open_sync),
        InstanceMethod("close", &envmou::close),
        InstanceMethod("closeSync", &envmou::close_sync),
        InstanceMethod("copyTo", &envmou::copy_to),
        InstanceMethod("copyToSync", &envmou::copy_to_sync),
        InstanceMethod("version", &envmou::get_version),
        InstanceMethod("startRead", &envmou::start_read),
        InstanceMethod("startWrite", &envmou::start_write),
        InstanceMethod("query", &envmou::query),
        InstanceMethod("keys", &envmou::keys)
    });
    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
    exports.Set(class_name, func);
}

mdbx::env::geometry envmou::parse_geometry(const Napi::Value& arg0) 
{
    mdbx::env::geometry geom{};

    auto obj = arg0.As<Napi::Object>();

    if (obj.Has("fixedSize")) {
        auto value = obj.Get("fixedSize").As<Napi::Number>();
        auto fixed_size = static_cast<intptr_t>(value.Int64Value());
        return geom.make_fixed(fixed_size);
    } else if (obj.Has("dynamicSize")) {
        auto arr = obj.Get("dynamicSize").As<Napi::Array>();
        if (arr.Length() != 2) {
            throw Napi::TypeError::New(obj.Env(), "dynamicSize must be an array of two numbers");
        }
        auto v1 = arr.Get(0u).As<Napi::Number>();
        auto v2 = arr.Get(1u).As<Napi::Number>();
        auto size_lower = static_cast<intptr_t>(v1.Int64Value());
        auto size_upper = static_cast<intptr_t>(v2.Int64Value());
        return geom.make_dynamic(size_lower, size_upper);
    } else {
        if (obj.Has("sizeNow")) {
            auto value = obj.Get("sizeNow").As<Napi::Number>();
            geom.size_now = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("sizeUpper")) {
            auto value = obj.Get("sizeUpper").As<Napi::Number>();
            geom.size_upper = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("growthStep")) {
            auto value = obj.Get("growthStep").As<Napi::Number>();
            geom.growth_step = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("shrinkThreshold")) {
            auto value = obj.Get("shrinkThreshold").As<Napi::Number>();
            geom.shrink_threshold = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("pageSize")) {
            auto value = obj.Get("pageSize").As<Napi::Number>();
            geom.pagesize = static_cast<intptr_t>(value.Int64Value());
        }
    }
    return geom;
}

env_arg0 envmou::parse(const Napi::Value& arg0)
{
    env_arg0 rc;

    auto obj = arg0.As<Napi::Object>();

    rc.path = obj.Get("path").As<Napi::String>().Utf8Value();
    if (obj.Has("maxDbi")) {
        auto value = obj.Get("maxDbi").As<Napi::Number>();
        rc.max_dbi = static_cast<MDBX_dbi>(value.Uint32Value());
    } 

    if (obj.Has("geometry")) {
        rc.geom = parse_geometry(obj.Get("geometry"));
    }

    if (obj.Has("flags")) {
        rc.flag = env_flag::parse(obj.Get("flags"));
    }

    if (obj.Has("mode")) {
        auto value = obj.Get("mode").As<Napi::Number>();
        rc.file_mode = static_cast<mode_t>(value.Int32Value());
    }

    if (obj.Has("keyFlag")) {
        rc.key_flag = base_flag::parse_key(obj.Get("keyFlag"));
    }

    if (obj.Has("valueFlag")) {
        rc.value_flag = base_flag::parse_value(obj.Get("valueFlag"));
    }

    return rc;
}

Napi::Value envmou::open(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto arg0 = parse(info[0].As<Napi::Object>());

    try {
        // асинхронный вызов разлочится внутри worker'a
        if (!try_lock()) {
            throw std::runtime_error("Env: in progress");
        }

        if (is_open()) {
            throw std::runtime_error("Env already opened");
        }          

        auto* worker = new async_open(env, *this, arg0);
        Napi::Promise promise = worker->GetPromise();
        worker->Queue();
        return promise;
    } catch (const std::exception& e) {
        unlock();
        throw Napi::Error::New(env, e.what());
    } catch (...) {
        unlock();
        throw;
    }

    return env.Undefined();
}

Napi::Value envmou::open_sync(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto arg0 = parse(info[0].As<Napi::Object>());

    try {
        lock_guard l(*this);
        if (is_open()) {
            throw std::runtime_error("Env: already opened");
        }
        attach(create_and_open(arg0), arg0);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }

    return env.Undefined();
}

MDBX_env* envmou::create_and_open(const env_arg0& arg0)
{
    MDBX_env *env;
    auto rc = mdbx_env_create(&env);
    if (rc != MDBX_SUCCESS) {
        throw std::runtime_error(mdbx_strerror(rc));
    }

    rc = mdbx_env_set_maxdbs(env, arg0.max_dbi);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    rc = mdbx_env_set_maxreaders(env, arg0.max_readers);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    auto& geom = arg0.geom;
    rc = mdbx_env_set_geometry(env, geom.size_lower, geom.size_now, 
        geom.size_upper, geom.growth_step, geom.shrink_threshold, geom.pagesize);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    auto id = static_cast<std::uint32_t>(pthread_self());
    // выдадим параметры mode, flag и id потока в котором открывается env
    rc = mdbx_env_open(env, arg0.path.c_str(), arg0.flag, arg0.file_mode);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    return env;
}

void envmou::attach(MDBX_env* env, const env_arg0& arg0)
{
    arg0_ = arg0;
    
    auto rc = mdbx_env_set_userctx(env, &arg0_);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    env_.reset(env);
}

Napi::Value envmou::close(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    try {
        // асинхронный вызов разлочится внутри worker'a
        if (!try_lock()) {
            throw std::runtime_error("Env: in progress");
        }

        if (!is_open()) {
            return env.Undefined();
        }

        if (trx_count_.load() > 0) {
            throw std::runtime_error("Env: active transactions");
        }

        auto* worker = new async_close(env, *this);
        Napi::Promise promise = worker->GetPromise();
        worker->Queue();
        return promise;
    } catch (const std::exception& e) {
        unlock();
        throw Napi::Error::New(env, e.what());
    } catch (...) {
        unlock();
        throw;
    }

    return env.Undefined();
}

Napi::Value envmou::close_sync(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    try {
        lock_guard l(*this);

        do_close();

    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
    return env.Undefined();
}

Napi::Value envmou::copy_to_sync(const Napi::CallbackInfo& info) 
{
    auto env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "Expected a string argument for the destination path.");
    }

    MDBX_copy_flags_t flags{MDBX_CP_COMPACT};
    if ((info.Length() > 1) && info[1].IsNumber()) {
        flags = static_cast<MDBX_copy_flags_t>(info[1].As<Napi::Number>().Uint32Value());
    }

    try {
        auto dest_path = info[0].As<Napi::String>().Utf8Value();

        lock_guard l(*this);

        check();

        auto rc = mdbx_env_copy(*this, dest_path.c_str(), flags);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }

    return env.Undefined();
}

Napi::Value envmou::copy_to(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "copyTo(path: string[, flags?: number]) -> Promise<void>");
    }

    MDBX_copy_flags_t flags{MDBX_CP_COMPACT};
    if (info.Length() > 1 && info[1].IsNumber()) {
        flags = static_cast<MDBX_copy_flags_t>(info[1].As<Napi::Number>().Uint32Value());
    }

    try {
        auto dest = info[0].As<Napi::String>().Utf8Value();

        if (!try_lock()) {
            throw std::runtime_error("Env in progress");
        }

        check();

        auto* worker = new mdbxmou::async_copy(env, *this, std::move(dest), flags);
        Napi::Promise promise = worker->GetPromise();
        worker->Queue();
        return promise;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }

    return env.Undefined();
}

Napi::Value envmou::get_version(const Napi::CallbackInfo& info) 
{
    std::string version = "mdbx v" + std::to_string(MDBX_VERSION_MAJOR);
    version += "." + std::to_string(MDBX_VERSION_MINOR);
    return Napi::Value::From(info.Env(), version);
}

Napi::Value envmou::start_transaction(const Napi::CallbackInfo& info, txn_mode mode) 
{
    auto env = info.Env();
    
    try {
        lock_guard l(*this);

        check();

        MDBX_txn* txn;
        auto rc = mdbx_txn_begin(*this, nullptr, mode, &txn);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, std::string("Env: ") + mdbx_strerror(rc));
        }

        // Создаем новый объект txnmou
        auto txn_obj = txnmou::ctor.New({});
        auto txn_wrapper = txnmou::Unwrap(txn_obj);
        txn_wrapper->attach(*this, txn, mode, nullptr);

        return txn_obj;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
}

Napi::Value envmou::query(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    txn_mode mode{};

    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, 
            "Expected array of requests: [{ db: String, db_mode: Number, key_mode: Number, key_flag: Number, value_mode: Number, value_flag: Number, mode: Number, item: [] }, ...]");
    }

    if (info.Length() > 1 || info[1].IsNumber()) {
        mode = txn_mode::parse(info[1].As<Napi::Number>());
    }

    try
    {
        lock_guard lock(*this);

        check();

        auto conf = dbimou::get_env_userctx(*this);

        auto arg0 = info[0];
        query_request query = parse_query(mode, 
            conf->key_flag, conf->value_flag, arg0);
        auto* worker = new async_query(env, *this, mode, 
            std::move(query), arg0.IsObject());
        auto promise = worker->GetPromise();
        worker->Queue();
        
        // Увеличиваем счетчик транзакций после успешного создания
        ++(*this);

        return promise;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    } catch (...) {
        throw Napi::Error::New(env, "envmou::query");
    }
    return env.Undefined();
}

Napi::Value envmou::keys(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    txn_mode mode{};

    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, 
            "Expected array of requests: [{ db: String, db_mode: Number, key_mode: Number, key_flag: Number, value_mode: Number, value_flag: Number }, ...]");
    }

    if (info.Length() > 1 || info[1].IsNumber()) {
        mode = txn_mode::parse(info[1].As<Napi::Number>());
    }

    try
    {
        lock_guard lock(*this);

        check();

        auto conf = dbimou::get_env_userctx(*this);

        auto arg0 = info[0];
        keys_request query = parse_keys(mode, 
            conf->key_flag, conf->value_flag, arg0);

        auto* worker = new async_keys(env, *this, mode, 
            std::move(query), arg0.IsObject());
        auto promise = worker->GetPromise();
        worker->Queue();
        
        // Увеличиваем счетчик транзакций после успешного создания
        ++(*this);

        return promise;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    } catch (...) {
        throw Napi::Error::New(env, "envmou::keys");
    }
    return env.Undefined();
}

} // namespace mdbxmou
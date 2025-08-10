#include "envmou.hpp"
#include "txnmou.hpp"
#include "async/envmou_copy_to.hpp"
#include "async/envmou_query.hpp"
#include "async/envmou_open.hpp"
#include "async/envmou_close.hpp"

namespace mdbxmou {

Napi::FunctionReference envmou::ctor{};

void envmou::init(const char *class_name, Napi::Env env)
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
        InstanceMethod("query", &envmou::query)
    });
    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
}

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
        InstanceMethod("query", &envmou::query)
    });
    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
    exports.Set(class_name, func);
}

mdbx::env::geometry envmou::parse_geometry(Napi::Object obj) 
{
    mdbx::env::geometry geom{};

    if (obj.Has("fixed_size")) {
        auto value = obj.Get("fixed_size").As<Napi::Number>();
        auto fixed_size = static_cast<intptr_t>(value.Int64Value());
        return geom.make_fixed(fixed_size);
    } else if (obj.Has("dynamic_size")) {
        auto arr = obj.Get("dynamic_size").As<Napi::Array>();
        if (arr.Length() != 2) {
            throw Napi::TypeError::New(obj.Env(), "dynamic_size must be an array of two numbers");
        }
        auto v1 = arr.Get(0u).As<Napi::Number>();
        auto v2 = arr.Get(1u).As<Napi::Number>();
        auto size_lower = static_cast<intptr_t>(v1.Int64Value());
        auto size_upper = static_cast<intptr_t>(v2.Int64Value());
        return geom.make_dynamic(size_lower, size_upper);
    } else {
        if (obj.Has("size_now")) {
            auto value = obj.Get("size_now").As<Napi::Number>();
            geom.size_now = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("size_upper")) {
            auto value = obj.Get("size_upper").As<Napi::Number>();
            geom.size_upper = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("growth_step")) {
            auto value = obj.Get("growth_step").As<Napi::Number>();
            geom.growth_step = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("shrink_threshold")) {
            auto value = obj.Get("shrink_threshold").As<Napi::Number>();
            geom.shrink_threshold = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("pagesize")) {
            auto value = obj.Get("pagesize").As<Napi::Number>();
            geom.pagesize = static_cast<intptr_t>(value.Int64Value());
        }
    }
    return geom;
}

MDBX_env_flags_t envmou::parse_env_flags(Napi::Object obj)
{
    // TODO - implement parsing of environment flags
    return MDBX_ACCEDE|MDBX_LIFORECLAIM|MDBX_SAFE_NOSYNC;
}

env_arg0 envmou::parse(Napi::Object arg0)
{
    env_arg0 rc;

    rc.path = arg0.Get("path").As<Napi::String>().Utf8Value();
    if (arg0.Has("max_dbi")) {
        auto value = arg0.Get("max_dbi").As<Napi::Number>();
        rc.max_dbi = static_cast<MDBX_dbi>(value.Uint32Value());
    } 

    if (arg0.Has("geometry")) {
        rc.geom = parse_geometry(arg0.Get("geometry").As<Napi::Object>());
    }

    rc.flags = parse_env_flags(arg0);

    if (arg0.Has("mode")) {
        auto value = arg0.Get("mode").As<Napi::Number>();
        rc.mode = static_cast<mode_t>(value.Int64Value());
    }

    if (arg0.Has("keyString")) {
        rc.key_string = arg0.Get("keyString").As<Napi::Boolean>().Value();
    }

    if (arg0.Has("valString")) {
        rc.val_string = arg0.Get("valString").As<Napi::Boolean>().Value();
    }

    return rc;
}

Napi::Value envmou::open(const Napi::CallbackInfo& info)
{
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: open id=%d\n", gettid());   

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
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: open_sync id=%d\n", gettid());    

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

    rc = mdbx_env_open(env, arg0.path.c_str(), arg0.flags, arg0.mode);
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
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: close id=%d\n", gettid());

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
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: close_sync id=%d\n", gettid());    

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
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: copy_to_sync id=%d\n", gettid());

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
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: copy_to id=%d\n", gettid());    

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

Napi::Value envmou::start_transaction(const Napi::CallbackInfo& info, MDBX_txn_flags_t flags) 
{
    // выдадим идентфикатор потока для лога (thread_id)
    //fprintf(stderr, "TRACE: start_transaction id=%d\n", gettid());    

    auto env = info.Env();
    
    try {
        lock_guard l(*this);

        check();

        MDBX_txn* txn;
        auto rc = mdbx_txn_begin(*this, nullptr, flags, &txn);
        if (rc != MDBX_SUCCESS) {
            const char* txn_type = (flags & MDBX_TXN_RDONLY) ? "read" : "write";
            throw Napi::Error::New(env, std::string("Failed to start ") + txn_type 
                + " transaction: " + mdbx_strerror(rc));
        }

        // Создаем новый объект txnmou
        auto txn_obj = txnmou::ctor.New({});
        auto txn_wrapper = txnmou::Unwrap(txn_obj);
        txn_wrapper->attach(*this, txn, flags, nullptr);

        return txn_obj;
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
}

/*
    // Пример использования get (аргумент get)
    // Запрос
    [ 
        { "db": "name1", "flags": 0, "param": [ "key1", "key2" ] },
        { "db": "name2", "flags": 0, "param": [ "key3" ] } 
    ]
    // await Ответ массив
    [
        [{"key":"key1","value":"value_1","rc":0},{"key":"key2","value":"value_2","rc":0}],
        [{"key":"key3","value":null,"rc":-50}]
    ]
*/
Napi::Value envmou::query(const Napi::CallbackInfo& info)
{
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: query id=%d\n", gettid());    

    Napi::Env env = info.Env();

    MDBX_txn_flags txn_flags{MDBX_TXN_RDONLY};
    // пок сделаем boolean (rw = true)
    if (info.Length() > 1 || info[2].IsBoolean()) {
        txn_flags = info[2].As<Napi::Boolean>().Value() ?
            MDBX_TXN_READWRITE : MDBX_TXN_RDONLY;
    }

    if (info.Length() < 1 || !info[0].IsArray()) {
        throw Napi::TypeError::New(env, 
            "Expected array of requests: [{ db: string, flags: number, key: [] }, ...]");
    }

    auto arg0 = info[0].As<Napi::Array>();

    try
    {
        std::vector<query_db> query_arr;
        // сколько обращений к db
        query_arr.reserve(arg0.Length());
        // для всех бд парсим элементы
        for (std::size_t i = 0; i < arg0.Length(); ++i) 
        {
            auto obj = arg0.Get(i).As<Napi::Object>();
            query_db elem = query_db::parse(env, obj);
            query_arr.push_back(std::move(elem));
        }        

        lock_guard lock(*this);

        check();

        auto conf = dbimou::get_env_userctx(*this);

        // чтобы не переписывать конструктор использую оператор
        auto* worker = new async_query(env, this->operator++(), txn_flags, 
            conf->key_string, conf->val_string, std::move(query_arr));
        auto promise = worker->GetPromise();
        worker->Queue();
        return promise;
    }
    catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    } catch (...) {
        throw Napi::Error::New(env, "envmou::query");
    }
    return env.Undefined();
}

Napi::Value envmou::start_read(const Napi::CallbackInfo& info) 
{
    return start_transaction(info, MDBX_TXN_RDONLY);
}

Napi::Value envmou::start_write(const Napi::CallbackInfo& info) 
{
    return start_transaction(info, MDBX_TXN_READWRITE);
}

} // namespace mdbxmou
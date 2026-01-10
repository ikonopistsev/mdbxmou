#include "txnmou.hpp"
#include "envmou.hpp"

namespace mdbxmou {

Napi::FunctionReference txnmou::ctor{};

void txnmou::init(const char *class_name, Napi::Env env) {
    auto func = DefineClass(env, class_name, {
        InstanceMethod("commit", &txnmou::commit),
        InstanceMethod("abort", &txnmou::abort),
        InstanceMethod("openMap", &txnmou::open_map),
        InstanceMethod("createMap", &txnmou::create_map),
        InstanceMethod("isActive", &txnmou::is_active),
    });

    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
}

Napi::Value txnmou::commit(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!txn_) {
        throw Napi::Error::New(env, "txn already completed");
    }
    
    dec_counter();
    auto rc = mdbx_txn_commit(txn_.release());
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, std::string("txn commit: ") + mdbx_strerror(rc));
    }
    
    return env.Undefined();
}

Napi::Value txnmou::abort(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!txn_) {
        throw Napi::Error::New(env, "txn already completed");
    }
    
    dec_counter();
    auto rc = mdbx_txn_abort(txn_.release());
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, std::string("txn abort: ") + mdbx_strerror(rc));
    }
    
    return env.Undefined();
}

// Уменьшает счетчик транзакций
void txnmou::dec_counter() noexcept
{
    if (env_) {
        --(*env_);
    }
}

Napi::Value txnmou::get_dbi(const Napi::CallbackInfo& info, db_mode db_mode)
{
    Napi::Env env = info.Env();

    if ((mode_.val & txn_mode::ro) && (db_mode.val & db_mode::create)) {
        throw Napi::Error::New(env, "dbi: cannot open DB in read-only transaction");
    }

    key_mode key_mode{};
    value_mode value_mode{};
    std::string db_name{};
    auto conf = get_env_userctx(*env_);
    auto key_flag = conf->key_flag;
    auto value_flag = conf->value_flag;
    auto arg_count = info.Length();
    if (arg_count == 3) {
        auto arg0 = info[0]; // db_name
        auto arg1 = info[1]; // key_mode
        auto arg2 = info[2]; // value_mode
        db_name = arg0.As<Napi::String>().Utf8Value();
        key_mode = parse_key_mode(env, arg1, key_flag);
        value_mode = value_mode::parse(arg2);
    } else if (arg_count == 2) {
        // db_name + key_mode || key_mode + value_mode
        auto arg0 = info[0]; 
        auto arg1 = info[1]; 
        if (arg0.IsString()) {
            db_name = arg0.As<Napi::String>().Utf8Value();
            key_mode = parse_key_mode(env, arg1, key_flag);
        } else if (arg0.IsNumber() || arg0.IsBigInt()) {
            key_mode = parse_key_mode(env, arg0, key_flag);
            value_mode = value_mode::parse(arg1);
        } else {
            throw Napi::Error::New(env, "Invalid argument type for db_name or value_mode");
        }
    } else if (arg_count == 1) {
        // db_name || key_mode
        auto arg0 = info[0];
        if (arg0.IsString()) {
            db_name = arg0.As<Napi::String>().Utf8Value();
        } else if (arg0.IsNumber() || arg0.IsBigInt()) {
            key_mode = parse_key_mode(env, arg0, key_flag);
        } else {
            throw Napi::Error::New(env, "Invalid argument type: expected string (db_name) or number (key_mode)");
        }
    }
    // arg_count == 0: используем значения по умолчанию (строковый ключ, default db)

    if (!txn_) {
        throw Napi::Error::New(env, "txn already completed");
    }

    MDBX_dbi dbi{};
    auto flags = static_cast<MDBX_db_flags_t>(db_mode.val|key_mode.val|value_mode.val);
    auto rc = mdbx_dbi_open(*this, db_name.empty() ? nullptr : db_name.c_str(), flags, &dbi);
    if (rc != MDBX_SUCCESS) {
        throw Napi::Error::New(env, std::string("mdbx_dbi_open: ") + mdbx_strerror(rc));
    }
    // создаем новый объект dbi
    auto obj = dbimou::ctor.New({});
    auto ptr = dbimou::Unwrap(obj);
    ptr->attach(dbi, db_mode, key_mode, 
        value_mode, key_flag, value_flag);
    return obj;
}

Napi::Value txnmou::is_active(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, txn_ != nullptr);
}

void txnmou::attach(envmou& env, MDBX_txn* txn, txn_mode mode) 
{
    env_ = &env;
    mode_ = mode;
    
    ++(*env_);
    txn_.reset(txn);
}

} // namespace mdbxmou
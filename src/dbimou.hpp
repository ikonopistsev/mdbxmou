#pragma once

#include "valuemou.hpp"
#include "querymou.hpp"
#include "env_arg0.hpp"
#include <memory>

namespace mdbxmou {

class envmou;
class txnmou;
struct env_arg0;

class dbimou final
    : public Napi::ObjectWrap<dbimou>
{
    // мы должны отслеживать время жизни evn
    envmou* env_{nullptr};
    txnmou* txn_{nullptr};
    MDBX_dbi dbi_{};
    db_mode mode_{};
    key_mode key_mode_{};
    value_mode value_mode_{};
    base_flag key_flag_{};
    base_flag value_flag_{};
    buffer_type key_buf_{};
    buffer_type val_buf_{};
    std::uint64_t id_buf_{};
    
public:
    static inline MDBX_stat get_stat(MDBX_txn* txn, MDBX_dbi dbi) 
    {
        MDBX_stat stat;
        auto rc = mdbx_dbi_stat(txn, dbi, &stat, sizeof(stat));
        if (rc != MDBX_SUCCESS) {
            throw std::runtime_error(mdbx_strerror(rc));
        }
        return stat;
    }    
    
    static Napi::FunctionReference ctor;

    dbimou(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<dbimou>(info) 
    {  }

    static void init(const char *class_name, Napi::Env env);

    // Основные операции (только синхронные)
    Napi::Value put(const Napi::CallbackInfo&);
    Napi::Value get(const Napi::CallbackInfo&);
    Napi::Value del(const Napi::CallbackInfo&);
    Napi::Value has(const Napi::CallbackInfo&);
    Napi::Value for_each(const Napi::CallbackInfo&);
    Napi::Value stat(const Napi::CallbackInfo&);
    Napi::Value keys(const Napi::CallbackInfo&);

    void attach(envmou* env, txnmou* txn, MDBX_dbi dbi, 
        db_mode mode, key_mode key_mode, value_mode value_mode, 
        base_flag key_flag, base_flag value_flag)
    {
        env_ = env;
        txn_ = txn;
        dbi_ = dbi;
        mode_ = mode;
        key_mode_ = key_mode;
        value_mode_ = value_mode;
        key_flag_ = key_flag;
        value_flag_ = value_flag;
    }

    static const env_arg0* get_env_userctx(MDBX_env* env_ptr);
};

} // namespace mdbxmou

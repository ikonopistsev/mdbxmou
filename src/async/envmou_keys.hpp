#pragma once

#include "querymou.hpp"

namespace mdbxmou {

class envmou;

class async_keys
    : public Napi::AsyncWorker 
{
    Napi::Promise::Deferred deferred_;
    envmou& env_;
    txn_mode txn_mode_{};
    // действия для выполнения
    keys_request query_{};
    // упрощенный режим 1 массив
    bool single_{false};

public:
    async_keys(Napi::Env env, envmou& e, 
        txn_mode txn_mode, keys_request query, bool single = false)
        : Napi::AsyncWorker{env}
        , deferred_{Napi::Promise::Deferred::New(env)}
        , env_{e}
        , txn_mode_{txn_mode}
        , query_{std::move(query)}
        , single_{single}
    {   }

    void Execute() override;

    void OnOK() override;

    void OnError(const Napi::Error& e) override;

    Napi::Promise GetPromise() const { 
        return deferred_.Promise(); 
    }

    txnmou_managed start_transaction();

    void do_keys(txnmou_managed& txn, 
        mdbx::map_handle dbi, keys_line& arg0);

    void do_keys_batch(txnmou_managed& txn, 
        mdbx::map_handle dbi, keys_line& arg0);

    void do_keys_from(txnmou_managed& txn, 
        mdbx::map_handle dbi, keys_line& arg0);
};

} // namespace mdbxmou
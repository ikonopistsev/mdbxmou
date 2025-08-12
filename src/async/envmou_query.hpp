#pragma once

#include "querymou.hpp"

namespace mdbxmou {

class envmou;

class async_query
    : public Napi::AsyncWorker 
{
    Napi::Promise::Deferred deferred_;
    envmou& env_;
    txn_mode txn_mode_{};
    // действия для выполнения
    query_request query_{};
    // упрощенный режим 1 массив
    bool single_{false};

    public:
    async_query(Napi::Env env, envmou& e, 
        txn_mode txn_mode, query_request query, bool single = false)
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

    void do_del(txnmou_managed& txn, 
        mdbx::map_handle dbi, query_line& arg0);    

    void do_get(const txnmou_managed& txn, 
        mdbx::map_handle dbi, query_line& arg0);    

    void do_put(txnmou_managed& txn, 
        mdbx::map_handle dbi, query_line& arg0);   
};

} // namespace mdbxmou
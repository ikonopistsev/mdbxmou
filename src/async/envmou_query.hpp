#pragma once

#include "querymou.hpp"

namespace mdbxmou {

class envmou;

class async_query
    : public Napi::AsyncWorker 
{
    Napi::Promise::Deferred deferred_;
    envmou& env_;
    MDBX_txn_flags txn_flags_{MDBX_TXN_RDONLY};
    bool key_string_{false};
    bool val_string_{false};
    std::vector<query_db> query_arr_{};

public:
    async_query(Napi::Env env, envmou& e, MDBX_txn_flags txn_flags,
       bool key_string, bool val_string, std::vector<query_db> query_arr)
        : Napi::AsyncWorker{env}
        , deferred_{Napi::Promise::Deferred::New(env)}
        , env_{e}
        , txn_flags_{txn_flags}
        , key_string_{key_string}
        , val_string_{val_string}
        , query_arr_{std::move(query_arr)}
    {   }

    void Execute() override;

    void OnOK() override;

    void OnError(const Napi::Error& e) override;

    Napi::Promise GetPromise() const { 
        return deferred_.Promise(); 
    }
};

} // namespace mdbxmou
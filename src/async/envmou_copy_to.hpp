#pragma once
#include <napi.h>
#include <mdbx.h++>

namespace mdbxmou {

class envmou;

class async_copy 
    : public Napi::AsyncWorker 
{
    Napi::Promise::Deferred deferred_;
    envmou& that_;
    std::string dest_{};
    MDBX_copy_flags_t flags_{MDBX_CP_DEFAULTS};

public:
    async_copy(Napi::Env env, envmou& t, 
        std::string dest, MDBX_copy_flags_t flags)
        : Napi::AsyncWorker(env)
        , deferred_(Napi::Promise::Deferred::New(env))
        , that_(t)
        , dest_(std::move(dest))
        , flags_(flags) 
    {   }

    void Execute() override;

    void OnOK() override;

    void OnError(const Napi::Error& e) override;

    Napi::Promise GetPromise() const { 
        return deferred_.Promise(); 
    }
};

} // namespace mdbxmou
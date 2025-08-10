#pragma once

#include "env_arg0.hpp"

namespace mdbxmou {

class envmou;

class async_open final
    : public Napi::AsyncWorker 
{
    Napi::Promise::Deferred deferred_;
    envmou& that_;
    env_arg0 arg0_{};

public:
    async_open(Napi::Env env, envmou& t, const env_arg0& a)
        : Napi::AsyncWorker(env)
        , deferred_(Napi::Promise::Deferred::New(env))
        , that_(t)
        , arg0_(a)
    {   }

    void Execute() override;    
    void OnOK() override;
    void OnError(const Napi::Error& e) override;

    Napi::Promise GetPromise() const { 
        return deferred_.Promise(); 
    }    
};

} // namespace mdbxmou

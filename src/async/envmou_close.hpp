#pragma once

#include <napi.h>
#include <mdbx.h++>

namespace mdbxmou {

class envmou;

class async_close final
    : public Napi::AsyncWorker 
{
    Napi::Promise::Deferred deferred_;
    envmou& that_;

public:
    async_close(Napi::Env env, envmou& t)
        : Napi::AsyncWorker(env)
        , deferred_(Napi::Promise::Deferred::New(env))
        , that_(t)
    {   }

    void Execute() override;    
    void OnOK() override;
    void OnError(const Napi::Error& e) override;

    Napi::Promise GetPromise() const { 
        return deferred_.Promise(); 
    }   
};

} // namespace mdbxmou

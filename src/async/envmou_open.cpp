#include "envmou_open.hpp"
#include "envmou.hpp"

namespace mdbxmou {

void async_open::Execute() 
{
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: async_open id=%d\n", gettid());

    try {
        auto e = envmou::create_and_open(arg0_);
        that_.attach(e, arg0_);
    } catch (const std::exception& e) {
        SetError(e.what());
    }
}

void async_open::OnOK() 
{
    // выдадим идентфикатор потока для лога (thread_id)
    // fprintf(stderr, "TRACE: async_open OnOK id=%d\n", gettid());

    auto env = Env();

    that_.unlock();

    deferred_.Resolve(env.Undefined());
}

void async_open::OnError(const Napi::Error& e) 
{
    that_.unlock();

    deferred_.Reject(e.Value());
}    

} // namespace mdbxmou

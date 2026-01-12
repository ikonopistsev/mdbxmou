#include "envmou_open.hpp"
#include "envmou.hpp"

namespace mdbxmou {

void async_open::Execute() 
{
    try {
        auto e = envmou::create_and_open(arg0_);
        that_.attach(e, arg0_);
    } catch (const std::exception& e) {
        SetError(e.what());
    }
}

void async_open::OnOK() 
{
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

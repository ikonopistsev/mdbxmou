#include "envmou_close.hpp"
#include "envmou.hpp"

namespace mdbxmou {

void async_close::Execute() 
{
    try {
        that_.do_close();
    } catch (const std::exception& e) {
        SetError(e.what());
    }
}

void async_close::OnOK() 
{
    auto env = Env();

    that_.unlock();

    deferred_.Resolve(env.Undefined());
}

void async_close::OnError(const Napi::Error& e) 
{
    that_.unlock();

    deferred_.Reject(e.Value());
}    

} // namespace mdbxmou

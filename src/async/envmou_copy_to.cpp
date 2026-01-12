#include "envmou_copy_to.hpp"
#include "envmou.hpp"

namespace mdbxmou {

void async_copy::Execute() 
{
    auto rc = mdbx_env_copy(that_, dest_.c_str(), flags_);
    if (rc != MDBX_SUCCESS) {
        SetError(mdbx_strerror(rc));
    }
}

void async_copy::OnOK() 
{
    that_.unlock();
    deferred_.Resolve(Env().Undefined());
}

void async_copy::OnError(const Napi::Error& e) 
{
    that_.unlock();
    deferred_.Reject(e.Value());
}    

} // namespace mdbxmou
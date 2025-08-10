#include "envmou.hpp"

using namespace Napi;

Napi::Object Init(Napi::Env env, Napi::Object exports) 
{
    mdbxmou::envmou::init("MDBX_Env", env, exports);
    mdbxmou::txnmou::init("MDBX_Txn", env);
    mdbxmou::dbimou::init("MDBX_Dbi", env);
    return exports;
}

NODE_API_MODULE(addon, Init)

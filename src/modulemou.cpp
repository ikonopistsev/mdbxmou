#include "envmou.hpp"

using namespace Napi;

Napi::Object Init(Napi::Env env, Napi::Object exports) 
{
    mdbxmou::envmou::init("MDBX_Env", env, exports);
    mdbxmou::txnmou::init("MDBX_Txn", env);
    mdbxmou::dbimou::init("MDBX_Dbi", env);

#define MDBXMOU_DECLARE_FLAG(obj, value) \
    obj.Set(#value, Napi::Number::New(env, value));

    Napi::Object db_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DB_DEFAULTS)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_REVERSEKEY)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DUPSORT)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_INTEGERKEY)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DUPFIXED)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_INTEGERDUP)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_REVERSEDUP)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_CREATE)
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DB_ACCEDE)
    exports.Set("MDBX_db_flags", db_flag);  

#undef MDBXMOU_DECLARE_FLAG

    return exports;
}

NODE_API_MODULE(addon, Init)

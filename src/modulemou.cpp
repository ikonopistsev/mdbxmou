#include "envmou.hpp"

using namespace Napi;

Napi::Object Init(Napi::Env env, Napi::Object exports) 
{
#define MDBXMOU_DECLARE_FLAG(obj, value) \
    obj.Set(#value, Napi::Number::New(env, value))

    Napi::Object env_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_ENV_DEFAULTS);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_VALIDATION);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_RDONLY);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_EXCLUSIVE);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_ACCEDE);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_WRITEMAP);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_NOSTICKYTHREADS);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_NORDAHEAD);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_NOMEMINIT);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_LIFORECLAIM);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_NOMETASYNC);
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_SAFE_NOSYNC);   
    MDBXMOU_DECLARE_FLAG(env_flag, MDBX_UTTERLY_NOSYNC);
    exports.Set("MDBX_env_flag", env_flag);    

    Napi::Object txn_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG(txn_flag, MDBX_TXN_READWRITE);
    MDBXMOU_DECLARE_FLAG(txn_flag, MDBX_TXN_RDONLY);
    MDBXMOU_DECLARE_FLAG(txn_flag, MDBX_TXN_TRY);
    MDBXMOU_DECLARE_FLAG(txn_flag, MDBX_TXN_NOMETASYNC);
    MDBXMOU_DECLARE_FLAG(txn_flag, MDBX_TXN_NOSYNC);
    exports.Set("MDBX_txn_flag", txn_flag);

    Napi::Object db_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DB_DEFAULTS);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_REVERSEKEY);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DUPSORT);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_INTEGERKEY);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DUPFIXED);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_INTEGERDUP);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_REVERSEDUP);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_CREATE);
    MDBXMOU_DECLARE_FLAG(db_flag, MDBX_DB_ACCEDE);
    exports.Set("MDBX_db_flag", db_flag);  

    constexpr auto MDBXMOU_GET = -1;
    Napi::Object put_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBXMOU_GET);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_UPSERT);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_NOOVERWRITE);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_NODUPDATA);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_CURRENT);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_ALLDUPS);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_RESERVE);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_APPEND);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_APPENDDUP);
    MDBXMOU_DECLARE_FLAG(put_flag, MDBX_MULTIPLE);
    exports.Set("MDBX_put_flag", put_flag);    

#undef MDBXMOU_DECLARE_FLAG

    mdbxmou::envmou::init("MDBX_Env", env, exports);
    mdbxmou::txnmou::init("MDBX_Txn", env);
    mdbxmou::dbimou::init("MDBX_Dbi", env);

    return exports;
}

NODE_API_MODULE(addon, Init)

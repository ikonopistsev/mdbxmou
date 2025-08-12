#include "envmou.hpp"

using namespace Napi;

Napi::Object Init(Napi::Env env, Napi::Object exports) 
{
#define MDBXMOU_DECLARE_FLAG_NAME(obj, name, value) \
    obj.Set(name, Napi::Number::New(env, value))

    Napi::Object mdbx_mou = Napi::Object::New(env);

    Napi::Object env_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "validation", mdbxmou::env_flag::validation);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "rdonly", mdbxmou::env_flag::rdonly);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "exclusive", mdbxmou::env_flag::exclusive);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "accede", mdbxmou::env_flag::accede);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "writemap", mdbxmou::env_flag::writemap);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "nostickythreads", mdbxmou::env_flag::nostickythreads);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "nordahead", mdbxmou::env_flag::nordahead);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "nomeminit", mdbxmou::env_flag::nomeminit);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "liforeclaim", mdbxmou::env_flag::liforeclaim);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "nometasync", mdbxmou::env_flag::nometasync);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "safe_nosync", mdbxmou::env_flag::safe_nosync);
    MDBXMOU_DECLARE_FLAG_NAME(env_flag, "utterly_nosync", mdbxmou::env_flag::utterly_nosync);

    mdbx_mou.Set("env_flag", env_flag);    

    Napi::Object txn_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(txn_mode, "ro", mdbxmou::txn_mode::ro);
    mdbx_mou.Set("txn_mode", txn_mode);

    Napi::Object key_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(key_mode, "reverse", mdbxmou::key_mode::reverse);
    MDBXMOU_DECLARE_FLAG_NAME(key_mode, "ordinal", mdbxmou::key_mode::ordinal);
    mdbx_mou.Set("key_mode", key_mode);

    Napi::Object key_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "string", mdbxmou::base_flag::string);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "number", mdbxmou::base_flag::number);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "bigint", mdbxmou::base_flag::bigint);
    mdbx_mou.Set("key_flag", key_flag);

    Napi::Object value_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multi", mdbxmou::value_mode::multi);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multi_reverse", mdbxmou::value_mode::multi_reverse);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multi_samelength", mdbxmou::value_mode::multi_samelength);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multi_ordinal", mdbxmou::value_mode::multi_ordinal);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multi_reverse_samelength", mdbxmou::value_mode::multi_reverse_samelength);
    mdbx_mou.Set("value_mode", value_mode);

    Napi::Object value_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(value_flag, "string", mdbxmou::base_flag::string);
    mdbx_mou.Set("value_flag", value_flag);    
    
    Napi::Object db_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(db_mode, "create", mdbxmou::db_mode::create);
    MDBXMOU_DECLARE_FLAG_NAME(db_mode, "accede", mdbxmou::db_mode::accede);
    mdbx_mou.Set("db_mode", db_mode);

    Napi::Object query_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "get", mdbxmou::query_mode::get);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "del", mdbxmou::query_mode::del);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "upsert", mdbxmou::query_mode::upsert);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "update", mdbxmou::query_mode::update);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "insert_unique", mdbxmou::query_mode::insert_unique);
    mdbx_mou.Set("query_mode", query_mode);  

    exports.Set("MDBX_Param", mdbx_mou);

#undef MDBXMOU_DECLARE_FLAG_NAME

    mdbxmou::envmou::init("MDBX_Env", env, exports);
    mdbxmou::txnmou::init("MDBX_Txn", env);
    mdbxmou::dbimou::init("MDBX_Dbi", env);

    return exports;
}

NODE_API_MODULE(addon, Init)

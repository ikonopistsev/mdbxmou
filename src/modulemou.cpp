#include "envmou.hpp"

using namespace Napi;

Napi::Object Init(Napi::Env env, Napi::Object exports) 
{
#define MDBXMOU_DECLARE_FLAG_NAME(obj, name, value) \
    obj.Set(name, Napi::Number::New(env, value))

    Napi::Object mdbx_mou = Napi::Object::New(env);

    Napi::Object envFlag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "validation", mdbxmou::env_flag::validation);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "rdonly", mdbxmou::env_flag::rdonly);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "exclusive", mdbxmou::env_flag::exclusive);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "accede", mdbxmou::env_flag::accede);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "writemap", mdbxmou::env_flag::writemap);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nostickythreads", mdbxmou::env_flag::nostickythreads);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nordahead", mdbxmou::env_flag::nordahead);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nomeminit", mdbxmou::env_flag::nomeminit);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "liforeclaim", mdbxmou::env_flag::liforeclaim);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nometasync", mdbxmou::env_flag::nometasync);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "safeNosync", mdbxmou::env_flag::safe_nosync);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "utterlyNosync", mdbxmou::env_flag::utterly_nosync);

    mdbx_mou.Set("envFlag", envFlag);

    Napi::Object txn_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(txn_mode, "ro", mdbxmou::txn_mode::ro);
    mdbx_mou.Set("txnMode", txn_mode);

    Napi::Object key_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(key_mode, "reverse", mdbxmou::key_mode::reverse);
    MDBXMOU_DECLARE_FLAG_NAME(key_mode, "ordinal", mdbxmou::key_mode::ordinal);
    mdbx_mou.Set("keyMode", key_mode);

    Napi::Object key_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "string", mdbxmou::base_flag::string);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "number", mdbxmou::base_flag::number);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "bigint", mdbxmou::base_flag::bigint);
    mdbx_mou.Set("keyFlag", key_flag);

    Napi::Object value_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multi", mdbxmou::value_mode::multi);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multiReverse", mdbxmou::value_mode::multi_reverse);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multiSamelength", mdbxmou::value_mode::multi_samelength);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multiOrdinal", mdbxmou::value_mode::multi_ordinal);
    MDBXMOU_DECLARE_FLAG_NAME(value_mode, "multiReverseSamelength", mdbxmou::value_mode::multi_reverse_samelength);
    mdbx_mou.Set("valueMode", value_mode);

    Napi::Object value_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(value_flag, "string", mdbxmou::base_flag::string);
    mdbx_mou.Set("valueFlag", value_flag);

    Napi::Object db_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(db_mode, "create", mdbxmou::db_mode::create);
    MDBXMOU_DECLARE_FLAG_NAME(db_mode, "accede", mdbxmou::db_mode::accede);
    mdbx_mou.Set("dbMode", db_mode);

    Napi::Object query_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "upsert", mdbxmou::query_mode::upsert);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "update", mdbxmou::query_mode::update);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "insertUnique", mdbxmou::query_mode::insert_unique);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "get", mdbxmou::query_mode::get);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "keys", mdbxmou::query_mode::keys);
    MDBXMOU_DECLARE_FLAG_NAME(query_mode, "del", mdbxmou::query_mode::del);
    mdbx_mou.Set("queryMode", query_mode);

    exports.Set("MDBX_Param", mdbx_mou);

#undef MDBXMOU_DECLARE_FLAG_NAME

    mdbxmou::envmou::init("MDBX_Env", env, exports);
    mdbxmou::txnmou::init("MDBX_Txn", env);
    mdbxmou::dbimou::init("MDBX_Dbi", env);

    return exports;
}

NODE_API_MODULE(addon, Init)

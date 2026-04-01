#include "envmou.hpp"
#include "cursormou.hpp"

using namespace Napi;

Napi::Object Init(Napi::Env env, Napi::Object exports) 
{
#define MDBXMOU_DECLARE_FLAG_NAME(obj, name, value) \
    obj.Set(name, Napi::Number::New(env, value))

    Napi::Object mdbx_mou = Napi::Object::New(env);

    using mdbxmou::env_flag;
    Napi::Object envFlag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "validation", env_flag::validation);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "rdonly", env_flag::rdonly);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "exclusive", env_flag::exclusive);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "accede", env_flag::accede);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "writemap", env_flag::writemap);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nostickythreads", env_flag::nostickythreads);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nordahead", env_flag::nordahead);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nomeminit", env_flag::nomeminit);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "liforeclaim", env_flag::liforeclaim);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "nometasync", env_flag::nometasync);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "safeNosync", env_flag::safe_nosync);
    MDBXMOU_DECLARE_FLAG_NAME(envFlag, "utterlyNosync", env_flag::utterly_nosync);
    mdbx_mou.Set("envFlag", envFlag);

    Napi::Object envOption = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "maxDb", MDBX_option::MDBX_opt_max_db);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "maxReaders", MDBX_option::MDBX_opt_max_readers);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "syncBytes", MDBX_option::MDBX_opt_sync_bytes);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "syncPeriod", MDBX_option::MDBX_opt_sync_period);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "rpAugmentLimit", MDBX_option::MDBX_opt_rp_augment_limit);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "looseLimit", MDBX_option::MDBX_opt_loose_limit);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "dpReserveLimit", MDBX_option::MDBX_opt_dp_reserve_limit);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "txnDpLimit", MDBX_option::MDBX_opt_txn_dp_limit);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "txnDpInitial", MDBX_option::MDBX_opt_txn_dp_initial);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "spillMaxDenominator", MDBX_option::MDBX_opt_spill_max_denominator);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "spillMinDenominator", MDBX_option::MDBX_opt_spill_min_denominator);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "spillParent4childDenominator", MDBX_option::MDBX_opt_spill_parent4child_denominator);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "mergeThreshold16dot16Percent", MDBX_option::MDBX_opt_merge_threshold_16dot16_percent);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "writethroughThreshold", MDBX_option::MDBX_opt_writethrough_threshold);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "prefaultWriteEnable", MDBX_option::MDBX_opt_prefault_write_enable);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "gcTimeLimit", MDBX_option::MDBX_opt_gc_time_limit);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "preferWafInsteadofBalance", MDBX_option::MDBX_opt_prefer_waf_insteadof_balance);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "subpageLimit", MDBX_option::MDBX_opt_subpage_limit);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "subpageRoomThreshold", MDBX_option::MDBX_opt_subpage_room_threshold);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "subpageReservePrereq", MDBX_option::MDBX_opt_subpage_reserve_prereq);
    MDBXMOU_DECLARE_FLAG_NAME(envOption, "subpageReserveLimit", MDBX_option::MDBX_opt_subpage_reserve_limit);
    mdbx_mou.Set("envOption", envOption);

    using mdbxmou::txn_mode;
    Napi::Object txnMode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(txnMode, "ro", txn_mode::ro);
    mdbx_mou.Set("txnMode", txnMode);

    using mdbxmou::key_mode;
    Napi::Object keyMode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(keyMode, "reverse", key_mode::reverse);
    MDBXMOU_DECLARE_FLAG_NAME(keyMode, "ordinal", key_mode::ordinal);
    mdbx_mou.Set("keyMode", keyMode);

    using mdbxmou::base_flag;
    Napi::Object key_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "string", base_flag::string);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "number", base_flag::number);
    MDBXMOU_DECLARE_FLAG_NAME(key_flag, "bigint", base_flag::bigint);
    mdbx_mou.Set("keyFlag", key_flag);

    using mdbxmou::value_mode;
    Napi::Object valueMode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(valueMode, "multi", value_mode::multi);
    MDBXMOU_DECLARE_FLAG_NAME(valueMode, "multiReverse", value_mode::multi_reverse);
    MDBXMOU_DECLARE_FLAG_NAME(valueMode, "multiSamelength", value_mode::multi_samelength);
    MDBXMOU_DECLARE_FLAG_NAME(valueMode, "multiOrdinal", value_mode::multi_ordinal);
    MDBXMOU_DECLARE_FLAG_NAME(valueMode, "multiReverseSamelength", 
        value_mode::multi_reverse_samelength);
    mdbx_mou.Set("valueMode", valueMode);

    Napi::Object value_flag = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(value_flag, "string", base_flag::string);
    mdbx_mou.Set("valueFlag", value_flag);

    using mdbxmou::db_mode;
    Napi::Object dbMode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(dbMode, "create", db_mode::create);
    MDBXMOU_DECLARE_FLAG_NAME(dbMode, "accede", db_mode::accede);
    mdbx_mou.Set("dbMode", dbMode);

    using mdbxmou::query_mode;
    Napi::Object queryMode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(queryMode, "upsert", query_mode::upsert);
    MDBXMOU_DECLARE_FLAG_NAME(queryMode, "update", query_mode::update);
    MDBXMOU_DECLARE_FLAG_NAME(queryMode, "insertUnique", query_mode::insert_unique);
    MDBXMOU_DECLARE_FLAG_NAME(queryMode, "get", query_mode::get);
    MDBXMOU_DECLARE_FLAG_NAME(queryMode, "del", query_mode::del);
    mdbx_mou.Set("queryMode", queryMode);

    using move_operation = mdbx::cursor::move_operation;
    Napi::Object cursor_mode = Napi::Object::New(env);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "first", move_operation::first);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "last", move_operation::last);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "next", move_operation::next);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "prev", move_operation::previous);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "keyLesserThan", 
        move_operation::key_lesser_than);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "keyLesserOrEqual", 
        move_operation::key_lesser_or_equal);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "keyEqual", move_operation::key_equal);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "keyGreaterOrEqual", 
        move_operation::key_greater_or_equal);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "keyGreaterThan", 
        move_operation::key_greater_than);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "multiExactKeyValueLesserThan", 
        move_operation::multi_exactkey_value_lesser_than);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "multiExactKeyValueLesserOrEqual", 
        move_operation::multi_exactkey_value_lesser_or_equal);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "multiExactKeyValueEqual", 
        move_operation::multi_exactkey_value_equal);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "multiExactKeyValueGreaterOrEqual", 
        move_operation::multi_exactkey_value_greater_or_equal);
    MDBXMOU_DECLARE_FLAG_NAME(cursor_mode, "multiExactKeyValueGreater", 
        move_operation::multi_exactkey_value_greater);
    mdbx_mou.Set("cursorMode", cursor_mode);

    exports.Set("MDBX_Param", mdbx_mou);

#undef MDBXMOU_DECLARE_FLAG_NAME

    mdbxmou::envmou::init("MDBX_Env", env, exports);
    mdbxmou::txnmou::init("MDBX_Txn", env);
    mdbxmou::dbimou::init("MDBX_Dbi", env);
    mdbxmou::cursormou::init("MDBX_Cursor", env);

    return exports;
}

NODE_API_MODULE(addon, Init)

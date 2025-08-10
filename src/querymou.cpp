#include "querymou.hpp"

namespace mdbxmou {

query_item query_item::parse(Napi::Env env, const Napi::Object& item, MDBX_db_flags_t db_flag, int id_type)
{
    query_item rc{};
    auto item_key = item.Get("key");
    
    if (item_key.IsString()) {
        auto str = item_key.As<Napi::String>().Utf8Value();
        rc.key.assign(str.begin(), str.end());
    } else if (item_key.IsBuffer()) {
        auto buf = item_key.As<Napi::Buffer<char>>();
        rc.key.assign(buf.Data(), buf.Data() + buf.Length());
    } else if (db_flag & MDBX_INTEGERKEY) {
        if (item_key.IsBigInt()) {
            // Проверяем консистентность типов
            if (id_type == query_db::key_number) { // key_unknown
                throw Napi::Error::New(env, 
                    "All keys must be the same type for MDBX_INTEGERKEY");
            }
            auto value = item_key.As<Napi::BigInt>();
            bool lossless{true};
            rc.id = value.Uint64Value(&lossless);
            if (!lossless) {
                throw Napi::Error::New(env, 
                    "BigInt key must be lossless for MDBX_INTEGERKEY");
            }
        } else if (item_key.IsNumber()) {
            // Проверяем консистентность типов
            if (id_type == query_db::key_bigint) { // key_unknown
                throw Napi::Error::New(env, 
                    "All keys must be the same type for MDBX_INTEGERKEY");
            }
            auto value = item_key.As<Napi::Number>();
            auto num = value.Int64Value();
            if (num < 0) {
                throw Napi::Error::New(env, 
                    "Number key must be non-negative for MDBX_INTEGERKEY");
            }
            rc.id = static_cast<std::uint64_t>(num);
        } else {
            throw Napi::Error::New(env, 
                "Expected string, buffer for key or BigInt/Number for MDBX_INTEGERKEY");
        }
    } else {
        throw Napi::Error::New(env, 
            "Expected string, buffer for key or BigInt/Number for MDBX_INTEGERKEY");
    }

    if (item.Has("flag")) {
        rc.flag = static_cast<std::size_t>(
            item.Get("flag").As<Napi::Number>().Int32Value());
    }
    
    if (item.Has("value") && rc.flag != query_item::MDBXMOU_GET) {
        auto item_val = item.Get("value");
        if (item_val.IsString()) {
            auto str = item_val.As<Napi::String>().Utf8Value();
            rc.val.assign(str.begin(), str.end());
        } else if (item_val.IsBuffer()) {
            auto buf = item_val.As<Napi::Buffer<char>>();
            rc.val.assign(buf.Data(), buf.Data() + buf.Length());
        } else {
            throw Napi::Error::New(env, 
                "Expected string or buffer for value");
        }
    }
    return rc;
}

query_db query_db::parse(Napi::Env env, const Napi::Object& obj)
{
    query_db result{};
    
    // Парсим имя базы данных
    if (obj.Has("db")) {
        result.db = obj.Get("db").As<Napi::String>().Utf8Value();
    }
    
    // Парсим флаги базы данных
    if (obj.Has("flag")) {
        auto arg_flag = obj.Get("flag");
        if (arg_flag.IsBigInt()) {
            bool lossless{true};
            result.flag = static_cast<MDBX_db_flags_t>(arg_flag.As<Napi::BigInt>().Int64Value(&lossless));
            if (result.flag & MDBX_INTEGERKEY) {
                result.id_type = query_db::key_bigint;
            }
        } if (arg_flag.IsNumber()) {
            result.flag = static_cast<MDBX_db_flags_t>(arg_flag.As<Napi::Number>().Int32Value());
            if (result.flag & MDBX_INTEGERKEY) {
                result.id_type = query_db::key_number;
            }
        }
    }
    
    // Парсим элементы
    if (obj.Has("item")) {
        auto items_array = obj.Get("item").As<Napi::Array>();
        auto length = items_array.Length();
        result.item.reserve(length);
        
        for (uint32_t i = 0; i < length; ++i) {
            const auto& item_obj = items_array.Get(i).As<Napi::Object>();
            result.item.push_back(query_item::parse(env, item_obj, result.flag, result.id_type));
        }
    } else {
        throw Napi::Error::New(env, "query: 'item' array");
    }
    
    return result;
}

} // namespace mdbxmou
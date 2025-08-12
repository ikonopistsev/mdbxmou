#include "querymou.hpp"

namespace mdbxmou {

void async_common::parse(txn_mode txn, const Napi::Object& obj)
{
    if (obj.Has("db")) {
        db_name = obj.Get("db").As<Napi::String>().Utf8Value();
        db = mdbx::slice{db_name};
    }

    if (obj.Has("dbMode")) {
        db_mod = db_mode::parse(txn, obj.Get("dbMode").As<Napi::Number>());
    }

    if (obj.Has("keyFlag")) {
        key_flag = base_flag::parse_key(obj.Get("keyFlag").As<Napi::Number>());
    }

    if (obj.Has("keyMode")) {
        key_mod = parse_key_mode(obj.Env(), obj.Get("keyMode").As<Napi::Number>(), key_flag);
    }

    // парсим value
    if (obj.Has("valueMode")) {
        val_mod = value_mode::parse(obj.Get("valueMode").As<Napi::Number>());
    }    
}

void async_key::parse(const async_common& common, const Napi::Object& item)
{
    // утснавлиаем общие параметры
    auto key_flag = common.key_flag;
    
    keymou key{};
    // ключ всегда есть
    auto item_key = item.Get("key");
    if (common.key_mod.val & key_mode::ordinal) {
        if (item_key.IsBigInt()) {
            key = keymou{item_key.As<Napi::BigInt>(), id_buf};
        } else if (item_key.IsNumber()) {
            key = keymou{item_key.As<Napi::Number>(), id_buf};
        }
    } else {
        key = (key_flag.val & base_flag::string) ?
           keymou{item_key.As<Napi::String>(), item_key.Env(), key_buf} :
           keymou{item_key.As<Napi::Buffer<char>>(), key_buf};
    }
}

void async_keyval::parse(const query_line& common, const Napi::Object& item)
{
    async_key::parse(common, item);    
    // проверяем надо ли что-то писать
    if (common.mode.val & query_mode::write_mask) {
        valuemou val{};
        auto item_val = item.Get("value");
        val = (common.value_flag.val & base_flag::string) ?
            valuemou{item_val.As<Napi::String>(), item_val.Env(), val_buf} :
            valuemou{item_val.As<Napi::Buffer<char>>(), val_buf};
    }
}

void query_line::parse(txn_mode txn, const Napi::Object& obj)
{
    //  парсим общие параметры
    async_common::parse(txn, obj);

    if (obj.Has("valueFlag")) {
        value_flag = base_flag::parse_value(val_mod, 
            obj.Get("valueFlag").As<Napi::Number>());
    }    

    if (obj.Has("mode")) {
        mode = query_mode::parse(txn, obj.Get("mode").As<Napi::Number>());
    } else if (obj.Has("queryMode")) {
        mode = query_mode::parse(txn, obj.Get("queryMode").As<Napi::Number>());
    }    
}

void query_line::parse(txn_mode txn, base_flag kf, 
        base_flag vf, const Napi::Object& obj)
{
    // утснавлиаем общие параметры
    this->key_flag = kf;
    this->value_flag = vf;

    // парсим общие параметры
    parse(txn, obj);

    // Парсим элементы
    if (obj.Has("item")) {
        auto items_array = obj.Get("item").As<Napi::Array>();
        auto length = items_array.Length();
        item.reserve(length);
        for (std::size_t i = 0; i < length; ++i) {
            auto item_obj = items_array.Get(i).As<Napi::Object>();
            async_keyval keyval{};
            keyval.parse(*this, item_obj);
            item.emplace_back(std::move(keyval));
        }
    } else {
        throw std::runtime_error("query: no item");
    }
}

query_request parse_query(txn_mode mode, base_flag key_flag, 
        base_flag value_flag, const Napi::Value& obj)
{
    query_request rc{};
    if (obj.IsArray()) {
        auto arr = obj.As<Napi::Array>();
        rc.reserve(arr.Length());
        for (std::size_t i = 0; i < arr.Length(); ++i) {
            query_line row{};
            row.parse(mode, key_flag, value_flag, arr.Get(i).As<Napi::Object>());
            rc.push_back(std::move(row));
        }
    } else if (obj.IsObject()) {
        query_line row{};
        row.parse(mode, key_flag, value_flag, obj.As<Napi::Object>());
        rc.push_back(std::move(row));
    } else {
        throw Napi::TypeError::New(obj.Env(), "Expected array or object for query");
    }
    return rc;
}

void keys_line::parse(txn_mode txn, 
    base_flag kf, const Napi::Object& obj)
{
    // утснавлиаем общие параметры
    this->key_flag = kf;

    // парсим общие параметры
    async_common::parse(txn, obj);
}

keys_request parse_keys(txn_mode txn, base_flag key_flag, 
    base_flag value_flag, const Napi::Value& obj)
{
    keys_request rc{};
    if (obj.IsArray()) {
        auto arr = obj.As<Napi::Array>();
        rc.reserve(arr.Length());
        for (std::size_t i = 0; i < arr.Length(); ++i) {
            keys_line row{};
            row.parse(txn, key_flag, arr.Get(i).As<Napi::Object>());
            rc.push_back(std::move(row));
        }
    } else if (obj.IsObject()) {
        keys_line row{};
        row.parse(txn, key_flag, obj.As<Napi::Object>());
        rc.push_back(std::move(row));
    } else {
        throw Napi::TypeError::New(obj.Env(), "Expected array or object for query");
    }
    return rc;
}

} // namespace mdbxmou
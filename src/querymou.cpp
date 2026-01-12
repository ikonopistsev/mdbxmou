#include "querymou.hpp"
#include "dbimou.hpp"

namespace mdbxmou {

dbimou* async_common::parse(const Napi::Object& arg0)
{
    dbimou* dbi{};
    // если просто передали dbi
    if (arg0.InstanceOf(dbimou::ctor.Value())) {
        dbi = Napi::ObjectWrap<dbimou>::Unwrap(arg0);
    } else {
        auto t = arg0.Get("dbi").As<Napi::Object>();
        dbi = Napi::ObjectWrap<dbimou>::Unwrap(t);
    }

    id = dbi->get_id();
    key_mod = dbi->get_key_mode();
    val_mod = dbi->get_value_mode();
    key_flag = dbi->get_key_flag();
    return dbi;
}

void async_key::parse(const async_common& common, const Napi::Value& item)
{
    // утснавлиаем общие параметры
    auto key_flag = common.key_flag;

    keymou key{};
    if (common.key_mod.val & key_mode::ordinal) {
        if (item.IsBigInt()) {
            key = keymou{item.As<Napi::BigInt>(), id_buf};
        } else if (item.IsNumber()) {
            key = keymou{item.As<Napi::Number>(), id_buf};
        }
    } else {
        key = (key_flag.val & base_flag::string) ?
           keymou{item.As<Napi::String>(), item.Env(), key_buf} :
           keymou{item.As<Napi::Buffer<char>>(), key_buf};
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

void query_line::parse(txn_mode txn, const Napi::Object& arg0)
{
    //  парсим общие параметры
    auto dbi = async_common::parse(arg0);
    value_flag = dbi->get_value_flag();
    if (arg0.Has("mode")) {
        mode = query_mode::parse(txn, arg0.Get("mode").As<Napi::Number>());
    } else if (arg0.Has("queryMode")) {
        mode = query_mode::parse(txn, arg0.Get("queryMode").As<Napi::Number>());
    }
    auto items_array = arg0.Get("item").As<Napi::Array>();
    auto item_len = items_array.Length();
    if (item_len > 0) {
        item.reserve(item_len);
        for (uint32_t i = 0; i < item_len; ++i) {
            auto item_obj = items_array.Get(i).As<Napi::Object>();
            async_keyval keyval{};
            keyval.parse(*this, item_obj);
            item.emplace_back(std::move(keyval));
        }
    }
}

query_request parse_query(txn_mode txn, const Napi::Value& arg0)
{
    query_request rc{};
    if (arg0.IsArray()) {
        auto arr = arg0.As<Napi::Array>();
        rc.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            query_line row{};
            row.parse(txn, arr.Get(i).As<Napi::Object>());
            rc.push_back(std::move(row));
        }
    } else if (arg0.IsObject()) {
        query_line row{};
        row.parse(txn, arg0.As<Napi::Object>());
        rc.push_back(std::move(row));
    } else {
        throw Napi::TypeError::New(arg0.Env(), "Expected array or object for query");
    }
    return rc;
}

void keys_line::parse(const Napi::Object& arg0)
{
    // парсим общие параметры
    async_common::parse(arg0);

    // парсим параметры scan_from
    if (arg0.Has("from")) {
        keymou key{};
        has_from_key = true;
        async_key::parse(*this, arg0.Get("from"));
    }
    
    if (arg0.Has("limit")) {
        auto limit_val = arg0.Get("limit");
        if (limit_val.IsNumber()) {
            limit = limit_val.As<Napi::Number>().Uint32Value();
        }
    }
    
    if (arg0.Has("cursorMode")) {
        cursor_mode = parse_cursor_mode(arg0.Get("cursorMode"));
    }    
}

keys_request parse_keys(const Napi::Value& obj)
{
    keys_request rc{};
    if (obj.IsArray()) {
        auto arr = obj.As<Napi::Array>();
        rc.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            keys_line row{};
            row.parse(arr.Get(i).As<Napi::Object>());
            rc.push_back(std::move(row));
        }
    } else if (obj.IsObject()) {
        keys_line row{};
        row.parse(obj.As<Napi::Object>());
        rc.push_back(std::move(row));
    } else {
        throw Napi::TypeError::New(obj.Env(), "Expected array or object for query");
    }
    return rc;
}

} // namespace mdbxmou
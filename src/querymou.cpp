#include "querymou.hpp"

namespace mdbxmou {

query_request parse_query(txn_mode mode, base_flag key_flag, 
        base_flag value_flag, const Napi::Value& obj)
{
    query_request rc;

    if (obj.IsArray()) {
        auto arr = obj.As<Napi::Array>();
        rc.reserve(arr.Length());
        for (std::size_t i = 0; i < arr.Length(); ++i) {
            auto line = arr.Get(i).As<Napi::Object>();
            rc.push_back(query_line::parse(mode, key_flag, value_flag, line));
        }
    } else if (obj.IsObject()) {
        rc.push_back(query_line::parse(mode, key_flag, value_flag, obj.As<Napi::Object>()));
    } else {
        throw Napi::TypeError::New(obj.Env(), "Expected array or object for query");
    }

    return rc;
}

query_line query_line::parse(txn_mode mode, base_flag key_flag, 
        base_flag value_flag, const Napi::Object& obj)
{
    query_line rc{};
    rc.key_flag = key_flag;
    rc.value_flag = value_flag;
    
    // Парсим имя базы данных
    if (obj.Has("db")) {
        rc.db_name = obj.Get("db").As<Napi::String>().Utf8Value();
        rc.db = mdbx::slice{rc.db_name};
    }

    // fprintf(stderr, "query_line::parse db_name: %s\n",
    //        rc.db_name.c_str());

    if (obj.Has("dbMode")) {
        rc.db_mod = db_mode::parse(mode, obj.Get("dbMode").As<Napi::Number>());
    }

    // fprintf(stderr, "query_line::parse db_mode: 0x%X\n",
    //        rc.db_mod.val);

    if (obj.Has("keyFlag")) {
        rc.key_flag = base_flag::parse_key(obj.Get("keyFlag").As<Napi::Number>());
    }

    // fprintf(stderr, "query_line::parse key_flag: 0x%X\n",
    //        rc.key_flag.val);

    if (obj.Has("keyMode")) {
        rc.key_mod = parse_key_mode(obj.Env(), obj.Get("keyMode").As<Napi::Number>(), rc.key_flag);
    }

    // fprintf(stderr, "query_line::parse key_mode: 0x%X\n",
    //        rc.key_mod.val);

    if (obj.Has("valueMode")) {
        rc.val_mod = value_mode::parse(obj.Get("valueMode").As<Napi::Number>());
    }

    // fprintf(stderr, "query_line::parse value_mode: 0x%X\n",
    //        rc.val_mod.val);

    if (obj.Has("valueFlag")) {
        rc.value_flag = base_flag::parse_value(rc.val_mod, obj.Get("valueFlag").As<Napi::Number>());
    }

    // fprintf(stderr, "query_line::parse value_flag: 0x%X\n",
    //        rc.value_flag.val);

    if (obj.Has("mode")) {
        rc.mode = query_mode::parse(mode, obj.Get("mode").As<Napi::Number>());
    } else if (obj.Has("queryMode")) {
        rc.mode = query_mode::parse(mode, obj.Get("queryMode").As<Napi::Number>());
    }

    // fprintf(stderr, "query_line::parse mode: 0x%X\n",
    //        rc.mode.val);

    // Парсим элементы
    if (obj.Has("item")) {
        auto items_array = obj.Get("item").As<Napi::Array>();
        auto length = items_array.Length();
        auto& item = rc.item;
        item.reserve(length);
        for (std::size_t i = 0; i < length; ++i) {
            const auto& item_obj = items_array.Get(i).As<Napi::Object>();
            item.emplace_back(query_element::parse(rc, item_obj));
        }
    } else {
        throw std::runtime_error("query: no item");
    }
    
    // fprintf(stderr, "query_line::parse db_name: %s, db_mode: 0x%X, key_flag: 0x%X, key_mode: 0x%X, value_flag: 0x%X, value_mode: 0x%X, mode: 0x%X\n",
    //        rc.db_name.c_str(), rc.db_mod.val, rc.key_flag.val, rc.key_mod.val, rc.value_flag.val, rc.val_mod.val, rc.mode.val);
    return rc;
}

query_element query_element::parse(const query_line& line, const Napi::Object& item)
{
    query_element rc{line};
    auto key_flag = line.key_flag;
    auto key_mode = line.key_mod;
    auto val_flag = line.value_flag;
    auto mode = line.mode;
    
    keymou key{};
    // ключ всегда есть
    auto item_key = item.Get("key");
    if (key_mode.val & key_mode::ordinal) {
        if (key_flag.val & base_flag::number) {
            key = keymou{item_key.As<Napi::Number>(), rc.id_buf};
        } else if (key_flag.val & base_flag::bigint) {
            key = keymou{item_key.As<Napi::BigInt>(), rc.id_buf};
        }
    } else {
        key = (key_flag.val & base_flag::string) ?
           keymou{item_key.As<Napi::String>(), item_key.Env(), rc.key_buf} :
           keymou{item_key.As<Napi::Buffer<char>>(), rc.key_buf};
    }

    // проверяем надо ли что-то писать
    if (mode.val & query_mode::write_mask) {
        valuemou val{};
        auto item_val = item.Get("value");
        val = (val_flag.val & base_flag::string) ?
            valuemou{item_val.As<Napi::String>(), item_val.Env(), rc.val_buf} :
            valuemou{item_val.As<Napi::Buffer<char>>(), rc.val_buf};
    }

    return rc;
}

} // namespace mdbxmou
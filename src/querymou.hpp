#pragma once

#include "valuemou.hpp"
#include <mdbx.h++>

namespace mdbxmou {

struct keys_line;
struct query_line;

struct async_common 
{
    // чтобы уметь открыть базу по умолчанию
    mdbx::slice db{};
    std::string db_name{};
    db_mode db_mod{};
    // тут важен для нас ordinal он влияет на option_mask
    key_mode key_mod{};
    base_flag key_flag{};
    // общий используется для открытия db
    value_mode val_mod{};

    void parse(txn_mode mode, const Napi::Object& obj);
};

struct async_key 
{
    buffer_type key_buf{};
    std::uint64_t id_buf{};
    void parse(const async_common& common, const Napi::Value& item);
    
    void parse(const async_common& common, const Napi::Object& item)
    {  
        parse(common, item.Get("key"));
    }
};

struct async_keyval
    : async_key
{
    buffer_type val_buf{};
    bool found{false};

    void parse(const query_line& line, const Napi::Object& obj);

    void set(const mdbx::slice& val) {
        if (val.empty()) {
            val_buf.clear();
        } else {
            val_buf.assign(val.char_ptr(), val.end_char_ptr());
        }
    }
};

struct query_line 
    : async_common
{
    base_flag value_flag{};
    query_mode mode{};

    void parse(txn_mode mode, const Napi::Object& obj);

    // буффер для запроса / ответа
    std::vector<async_keyval> item{};
    void parse(txn_mode txn, base_flag key_flag, 
        base_flag value_flag, const Napi::Object& obj);
};

using query_request = std::vector<query_line>;
query_request parse_query(txn_mode txn, base_flag key_flag, 
        base_flag value_flag, const Napi::Value& obj);


struct keys_line 
    : async_common
    , async_key
{
    using move_operation = mdbx::cursor::move_operation;
    bool has_from_key{false};
    std::size_t limit{SIZE_MAX};
    move_operation cursor_mode{move_operation::key_greater_or_equal};  // режим курсора
    // буффер для ответов
    std::vector<async_key> item{};

    void parse(txn_mode txn, base_flag key_flag,
        const Napi::Object& obj);
};

using keys_request = std::vector<keys_line>;
keys_request parse_keys(txn_mode txn, base_flag key_flag, 
        base_flag value_flag, const Napi::Value& obj);

} // namespace mdbxmou
#pragma once

#include "valuemou.hpp"

namespace mdbxmou {

struct query_line;
struct query_element 
{
    const query_line& line;
    // память для преобразования 
    buffer_type key_buf{};
    buffer_type val_buf{};
    std::uint64_t id_buf{};
    bool rc{false};

    static query_element parse(const query_line& line, const Napi::Object& obj);

    void set(const mdbx::slice& val) {
        if (val.empty()) {
            val_buf.clear();
        } else {
            val_buf.assign(val.char_ptr(), val.end_char_ptr());
        }
    }
};

struct query_line
{
    // чтобы уметь открыть базу по умолчанию
    mdbx::slice db{};
    std::string db_name{};
    db_mode db_mod{};
    // тут важен для нас ordinal он влияет на option_mask
    key_mode key_mod{};
    base_flag key_flag{};
    value_mode val_mod{};
    base_flag value_flag{};
    query_mode mode{};
    // буффер для запроса / ответа
    std::vector<query_element> item{};
    
    static query_line parse(txn_mode mode, base_flag key_flag, 
        base_flag value_flag, const Napi::Object& obj);
};

using query_request = std::vector<query_line>;

query_request parse_query(txn_mode mode, base_flag key_flag, 
        base_flag value_flag, const Napi::Value& obj);

} // namespace mdbxmou
#pragma once

#include <napi.h>
#include <mdbx.h++>
#include <cstdint>
#include <vector>

namespace mdbxmou {

// Forward declaration
struct query_db;

struct query_item 
{
    using value_type = std::vector<char>;
    // быстрый key если MDBX_db_flags_t == MDBX_INTEGERKEY
    std::uint64_t id{}; 
    value_type key{};
    value_type val{};
    // флаг чтения данных
    constexpr static std::size_t MDBXMOU_GET{static_cast<std::size_t>(-1)};
    std::size_t flag{MDBXMOU_GET};
    int rc{};

    static query_item parse(Napi::Env env, const Napi::Object& obj, MDBX_db_flags_t db_flag, int db_key_type);

    MDBX_val mdbx_key(MDBX_db_flags_t db_flag) const 
    {
        MDBX_val rc{};
        if (db_flag & MDBX_INTEGERKEY) {
            rc.iov_base = const_cast<std::uint64_t*>(&id);
            rc.iov_len = sizeof(id);
        } else {
            rc.iov_base = const_cast<char*>(key.data());
            rc.iov_len = key.size();
        }
        return rc;
    }

    MDBX_val mdbx_value() const 
    {
        MDBX_val rc{};
        if (flag != MDBXMOU_GET) {
            rc.iov_base = const_cast<char*>(val.data());
            rc.iov_len = val.size();
        }
        return rc;
    }

    void set_result(int code, const MDBX_val& v) 
    {
        // fprintf(stderr, "set_result: code=%d, v.iov_len=%zu\n", code, v.iov_len);
        rc = code;
        auto ptr = static_cast<const char*>(v.iov_base);
        val.assign(ptr, ptr + v.iov_len);
    }
};

struct query_db
{
    enum key_type : int {
        key_unknown = -1,
        key_number = 0,
        key_bigint = 1
    };    
    std::string db{};
    MDBX_db_flags_t flag{MDBX_DB_DEFAULTS};
    key_type id_type{key_unknown};
    std::vector<query_item> item{};
    
    static query_db parse(Napi::Env env, const Napi::Object& obj);
};

} // namespace mdbxmou
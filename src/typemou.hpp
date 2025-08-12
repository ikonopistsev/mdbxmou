#pragma once

#include <napi.h>
#include <mdbx.h++>
#include <cstdint>
#include <vector>

namespace mdbxmou {

using buffer_type = std::vector<char>;

class txnmou_managed final
    : public mdbx::txn_managed
{
public:
    txnmou_managed() = delete;
    txnmou_managed(const txnmou_managed &) = delete;
    txnmou_managed &operator=(const txnmou_managed &) = delete;
    txnmou_managed(txnmou_managed &&) = default;
    txnmou_managed &operator=(txnmou_managed &&other) noexcept = default;
    txnmou_managed(MDBX_txn* txn)
    {  
        txn::handle_ = txn; 
    }
};


struct env_flag {
    enum type : int {
        validation = MDBX_VALIDATION,
        rdonly = MDBX_RDONLY,
        exclusive = MDBX_EXCLUSIVE,
        accede = MDBX_ACCEDE,
        writemap = MDBX_WRITEMAP,
        nostickythreads = MDBX_NOSTICKYTHREADS,
        nordahead = MDBX_NORDAHEAD,
        nomeminit = MDBX_NOMEMINIT,
        liforeclaim = MDBX_LIFORECLAIM,
        nometasync = MDBX_NOMETASYNC,
        safe_nosync = MDBX_SAFE_NOSYNC,
        utterly_nosync = MDBX_UTTERLY_NOSYNC,
        mask = MDBX_VALIDATION | MDBX_RDONLY | MDBX_EXCLUSIVE | MDBX_ACCEDE |
               MDBX_WRITEMAP | MDBX_NOSTICKYTHREADS | MDBX_NORDAHEAD |
               MDBX_NOMEMINIT | MDBX_LIFORECLAIM | MDBX_NOMETASYNC |
               MDBX_SAFE_NOSYNC | MDBX_UTTERLY_NOSYNC
    };
    int val{};

    static inline env_flag parse(const Napi::Value& arg0) {
        return {arg0.As<Napi::Number>().Int32Value() & mask};
    }

    operator MDBX_env_flags() const noexcept {
        return static_cast<MDBX_env_flags>(val & mask);
    }
};

struct txn_mode {
    enum type : int {
        ro = MDBX_TXN_RDONLY
    };
    int val{};

    static inline txn_mode parse(const Napi::Value& arg0) {
        return {arg0.As<Napi::Number>().Int32Value() & ro};
    }
    
    operator MDBX_txn_flags() const noexcept {
        return static_cast<MDBX_txn_flags>(val & ro);
    }
};

struct query_mode
{
    enum type : int {
        get = 0x10000000,
        del = 0x20000000,
        upsert = MDBX_UPSERT,
        update = MDBX_CURRENT,
        insert_unique = MDBX_NOOVERWRITE,
        write_mask = upsert | update | insert_unique,
        mask = get | del | upsert | update | insert_unique
    };
    int val{get};

    static inline query_mode parse(const txn_mode& mode, const Napi::Value& arg0) {
        query_mode rc{arg0.As<Napi::Number>().Int32Value() & mask};
        if ((mode.val & txn_mode::ro) && (rc.val & (del|upsert|update|insert_unique))) {
            throw std::runtime_error("rw query in read-only transaction");
        }
        return rc;
    }

    operator mdbx::put_mode() const noexcept {
        return static_cast<mdbx::put_mode>(val & write_mask);
    }    
};

struct key_mode
{
    enum type : int {
        reverse = MDBX_REVERSEKEY,
        ordinal = MDBX_INTEGERKEY,
        mask = MDBX_REVERSEKEY | MDBX_INTEGERKEY
    };
    int val{};

    static inline key_mode parse(const Napi::Value& arg0) {
        return {arg0.As<Napi::Number>().Int32Value() & mask};
    }

    operator mdbx::key_mode() const noexcept {
        return static_cast<mdbx::key_mode>(val & mask);
    }
};

struct value_mode
{
    enum type : int {
        multi = MDBX_DUPSORT,
        multi_reverse = MDBX_DUPSORT | MDBX_REVERSEDUP,
        multi_samelength = MDBX_DUPSORT | MDBX_DUPFIXED,
        multi_ordinal = MDBX_DUPSORT | MDBX_DUPFIXED | MDBX_INTEGERDUP,
        multi_reverse_samelength = MDBX_DUPSORT | MDBX_REVERSEDUP | MDBX_DUPFIXED,
        mask = MDBX_DUPSORT | MDBX_REVERSEDUP | MDBX_DUPFIXED | MDBX_INTEGERDUP
    };
    int val{};

    static inline value_mode parse(const Napi::Value& arg0) {
        return {arg0.As<Napi::Number>().Int32Value() & mask};
    }

    operator mdbx::value_mode() const noexcept {
        return static_cast<mdbx::value_mode>(val & mask);
    }
};


struct base_flag
{
    enum type : int {
        string = 2,
        number = 4,
        bigint = 8,
        mask_key = string | number | bigint,
        mask_val = string
    };
    int val{};

    static inline base_flag parse_key(const Napi::Value& arg0) {
        return {arg0.As<Napi::Number>().Int32Value() & mask_key};
    }      

    static inline base_flag parse_value(const value_mode& mode, 
        const Napi::Value& arg0) {
        return {arg0.As<Napi::Number>().Int32Value() & mask_val};
    }

    static inline base_flag parse_value(const Napi::Value& arg0) {
        return {arg0.As<Napi::Number>().Int32Value() & mask_val};
    }    
};

static inline key_mode parse_key_mode(Napi::Env env, const Napi::Value& arg0, base_flag& key_flag) 
{
    key_mode mode{};
    if (arg0.IsBigInt()) {
        bool lossless;
        auto value = arg0.As<Napi::BigInt>().Int64Value(&lossless);
        if (!lossless) {
            throw Napi::Error::New(env, "BigInt value lossless conversion failed");
        }
        mode.val = static_cast<int>(value);
        if (mode.val & key_mode::ordinal) {
            // только если цифровой key_flag не был задан
            if (key_flag.val <= base_flag::string) {
                key_flag.val = base_flag::bigint;
            }
        }
    } else if (arg0.IsNumber()) {
        mode = key_mode::parse(arg0);
        if (mode.val & key_mode::ordinal) {
            // только если цифровой key_flag не был задан
            if (key_flag.val <= base_flag::string) {
                key_flag.val = base_flag::number;
            }
        }
    } else {
        throw Napi::Error::New(env, "Invalid argument type for key mode");
    }
    return mode;
}

struct db_mode
{
    enum type : int {
        create = MDBX_CREATE,
        accede = MDBX_ACCEDE,
        mask = MDBX_CREATE | MDBX_ACCEDE
    };
    int val{};

    static inline db_mode parse(const txn_mode& mode, const Napi::Value& arg0) {
        db_mode rc{arg0.As<Napi::Number>().Int32Value() & mask};
        if ((mode.val & txn_mode::ro) && (rc.val & db_mode::create)) {
            throw std::runtime_error("create DB in read-only transaction");
        }
        return rc;
    }
};

} // namespace mdbxmou
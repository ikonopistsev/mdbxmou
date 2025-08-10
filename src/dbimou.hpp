#pragma once

#include "querymou.hpp"
#include "env_arg0.hpp"
#include <memory>

namespace mdbxmou {

class envmou;
class txnmou;
struct env_arg0;

class dbimou final
    : public Napi::ObjectWrap<dbimou>
{
    // мы должны отслеживать время жизни evn
    envmou* env_{nullptr};
    txnmou* txn_{nullptr};
    MDBX_dbi dbi_{};
    MDBX_db_flags_t flags_{MDBX_DB_DEFAULTS};
    query_item::value_type key_buf_{};
    query_item::value_type val_buf_{};
    std::uint64_t id_{};
    query_db::key_type id_type_{query_db::key_type::key_unknown};

    struct close_cursor {
        void operator()(MDBX_cursor *cursor) const noexcept {
            mdbx_cursor_close(cursor);
        }
    };
    using cursor_ptr = std::unique_ptr<MDBX_cursor, close_cursor>;

    static inline MDBX_stat get_stat(MDBX_txn* txn, MDBX_dbi dbi) 
    {
        MDBX_stat stat;
        auto rc = mdbx_dbi_stat(txn, dbi, &stat, sizeof(stat));
        if (rc != MDBX_SUCCESS) {
            throw std::runtime_error(mdbx_strerror(rc));
        }
        return stat;
    }    
    
public:    
    static Napi::FunctionReference ctor;

    dbimou(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<dbimou>(info) 
    {  }

    static void init(const char *class_name, Napi::Env env);

    // Основные операции (только синхронные)
    Napi::Value put(const Napi::CallbackInfo&);
    Napi::Value get(const Napi::CallbackInfo&);
    Napi::Value del(const Napi::CallbackInfo&);
    Napi::Value has(const Napi::CallbackInfo&);
    Napi::Value for_each(const Napi::CallbackInfo&);
    Napi::Value stat(const Napi::CallbackInfo&);
    Napi::Value keys(const Napi::CallbackInfo&);

    void attach(envmou* env, txnmou* txn, MDBX_dbi dbi, 
        MDBX_db_flags_t flags, query_db::key_type id_type = query_db::key_type::key_unknown)
    {
        env_ = env;
        txn_ = txn;
        dbi_ = dbi;
        flags_ = flags;
        id_type_ = id_type;
    }

    static const env_arg0* get_env_userctx(MDBX_env* env_ptr);
};

} // namespace mdbxmou

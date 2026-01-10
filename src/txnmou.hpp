#pragma once

#include "dbimou.hpp"

namespace mdbxmou {

class envmou;

class txnmou final 
    : public Napi::ObjectWrap<txnmou>
{
private:
    envmou* env_{nullptr};
    
    // свободу txn
    struct free_txn
    {
        void operator()(MDBX_txn *txn) const noexcept {
            mdbx_txn_abort(txn);
        }
    };

    std::unique_ptr<MDBX_txn, free_txn> txn_{};
    txn_mode mode_{};
    std::size_t cursor_count_{};
    
    // Уменьшает счетчик транзакций
    void dec_counter() noexcept;

    Napi::Value get_dbi(const Napi::CallbackInfo&, db_mode);

public:    
    static Napi::FunctionReference ctor;

    txnmou(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<txnmou>(info) 
    {   }

    ~txnmou() {
        if (txn_) {
            dec_counter();
        }
    }

    static void init(const char *class_name, Napi::Env env);

    Napi::Value commit(const Napi::CallbackInfo&);
    Napi::Value abort(const Napi::CallbackInfo&);
    Napi::Value open_map(const Napi::CallbackInfo& info) {
        return get_dbi(info, db_mode{});
    }
    Napi::Value create_map(const Napi::CallbackInfo& info) {
        return get_dbi(info, {db_mode::create});
    }
    
    Napi::Value open_cursor(const Napi::CallbackInfo&);

    operator MDBX_txn*() noexcept {
        return txn_.get();
    }

    // Cursor counting
    txnmou& operator++() noexcept { ++cursor_count_; return *this; }
    txnmou& operator--() noexcept { --cursor_count_; return *this; }
    std::size_t cursor_count() const noexcept { return cursor_count_; }

    Napi::Value is_active(const Napi::CallbackInfo&);

    void attach(envmou& env, MDBX_txn* txn, txn_mode mode);
};

} // namespace mdbxmou

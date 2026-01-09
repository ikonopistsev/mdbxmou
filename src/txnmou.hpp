#pragma once

#include "dbimou.hpp"

namespace mdbxmou {

class envmou;

class txnmou final 
    : public Napi::ObjectWrap<txnmou>
{
private:
    envmou* env_{nullptr};    

    std::unique_ptr<MDBX_txn, 
        txnmou_managed::free_txn> txn_{};
    txn_mode mode_{};

    void check() const {
        if (!txn_) {
            throw std::runtime_error("txn: inactive");
        }
    }
    
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

    //void Finalize(Napi::Env env) { fprintf(stderr, "txnmou::Finalize %p\n", this); }

    static void init(const char *class_name, Napi::Env env);

    Napi::Value commit(const Napi::CallbackInfo&);
    Napi::Value abort(const Napi::CallbackInfo&);
    Napi::Value open_map(const Napi::CallbackInfo& info) {
        return get_dbi(info, db_mode{});
    }
    Napi::Value create_map(const Napi::CallbackInfo& info) {
        return get_dbi(info, {db_mode::create});
    }

    operator MDBX_txn*() const noexcept {
        return txn_.get();
    }

    Napi::Value is_active(const Napi::CallbackInfo&);

    void attach(envmou& env, MDBX_txn* txn, txn_mode mode);
};

} // namespace mdbxmou

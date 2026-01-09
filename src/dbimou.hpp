#pragma once

#include "dbi.hpp"
#include "querymou.hpp"
#include "env_arg0.hpp"
#include <memory>

namespace mdbxmou {

class envmou;
class txnmou;
struct env_arg0;

class dbimou final
    : public Napi::ObjectWrap<dbimou>
    , public dbi
{
    db_mode mode_{};
    key_mode key_mode_{};
    value_mode value_mode_{};

    base_flag key_flag_{};
    base_flag value_flag_{};

    buffer_type key_buf_{};
    buffer_type val_buf_{};
    
public:   
    static Napi::FunctionReference ctor;

    dbimou(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<dbimou>{info}
        , dbi{}
    {   }

    //~dbimou() { fprintf(stderr, "dbimou::~dbimou %p key_cap=%zu val_cap=%zu\n",this, key_buf_.capacity(), val_buf_.capacity()); }
    //void Finalize(Napi::Env env) { fprintf(stderr, "~dbimou %p key_cap=%zu val_cap=%zu\n",this, key_buf_.capacity(), val_buf_.capacity()); }

    Napi::Value get_id(const Napi::CallbackInfo& info) {
        return Napi::BigInt::New(info.Env(), static_cast<int64_t>(id_));
    }

    Napi::Value get_mode(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), static_cast<double>(mode_.val));
    }
    
    Napi::Value get_key_mode(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), static_cast<double>(key_mode_.val));
    }
    
    Napi::Value get_value_mode(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), static_cast<double>(value_mode_.val));
    }
    
    Napi::Value get_key_flag(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), static_cast<double>(key_flag_.val));
    }
    
    Napi::Value get_value_flag(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), static_cast<double>(value_flag_.val));
    }    

    static void init(const char *class_name, Napi::Env env);

    // valuemou read(const MDBX_txn* txn);
    // valuemou read(const MDBX_txn* txn, const keymou& key);

    // Основные операции (только синхронные)
    Napi::Value put(const Napi::CallbackInfo&);
    Napi::Value get(const Napi::CallbackInfo&);
    Napi::Value del(const Napi::CallbackInfo&);
    Napi::Value has(const Napi::CallbackInfo&);
    Napi::Value for_each(const Napi::CallbackInfo&);
    Napi::Value stat(const Napi::CallbackInfo&);
    Napi::Value keys(const Napi::CallbackInfo&);
    Napi::Value keys_from(const Napi::CallbackInfo&);
    Napi::Value drop(const Napi::CallbackInfo&);

private:
    // Внутренний метод для forEach с начальным ключом
    Napi::Value for_each_from(const Napi::CallbackInfo&);

public:

    void attach(MDBX_dbi id, db_mode mode, 
        key_mode key_mode, value_mode value_mode, 
        base_flag key_flag, base_flag value_flag)
    {
        dbi::attach(id);
        mode_ = mode;
        key_mode_ = key_mode;
        value_mode_ = value_mode;
        key_flag_ = key_flag;
        value_flag_ = value_flag;
    }

    operator MDBX_put_flags_t() const noexcept {
        return static_cast<MDBX_put_flags_t>(key_mode_.val & value_mode_.val);
    }

    MDBX_dbi get_id() const noexcept {
        return id_;
    }

    db_mode get_mode() const noexcept {
        return mode_;
    }

    key_mode get_key_mode() const noexcept {
        return key_mode_;
    }

    value_mode get_value_mode() const noexcept {
        return value_mode_;
    }

    base_flag get_key_flag() const noexcept {
        return key_flag_;
    }

    base_flag get_value_flag() const noexcept {
        return value_flag_;
    }
};

} // namespace mdbxmou

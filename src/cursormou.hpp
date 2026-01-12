#pragma once

#include "typemou.hpp"
#include "valuemou.hpp"

namespace mdbxmou {

class dbimou;
class txnmou;

class cursormou final 
    : public Napi::ObjectWrap<cursormou>
{
private:
    txnmou* txn_{nullptr};
    dbimou* dbi_{nullptr};
    MDBX_cursor* cursor_{nullptr};
    
    // Буферы для ключей/значений
    buffer_type key_buf_{};
    buffer_type val_buf_{};
    std::uint64_t key_num_{};

    // Внутренний хелпер для навигации
    Napi::Value move(const Napi::Env& env, MDBX_cursor_op op);
    
    // Хелпер для поиска
    Napi::Value seek_impl(const Napi::CallbackInfo& info, MDBX_cursor_op op);
    
    // Закрытие курсора
    void do_close() noexcept;

public:    
    static Napi::FunctionReference ctor;
    static void init(const char *class_name, Napi::Env env);

    cursormou(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<cursormou>(info) 
    {   }

    ~cursormou();

    // Навигация
    Napi::Value first(const Napi::CallbackInfo&);
    Napi::Value last(const Napi::CallbackInfo&);
    Napi::Value next(const Napi::CallbackInfo&);
    Napi::Value prev(const Napi::CallbackInfo&);
    
    // Поиск
    Napi::Value seek(const Napi::CallbackInfo&);      // exact match
    Napi::Value seek_ge(const Napi::CallbackInfo&);   // >= key (lower_bound)
    
    // Текущая позиция
    Napi::Value current(const Napi::CallbackInfo&);
    
    // Статус курсора
    Napi::Value eof(const Napi::CallbackInfo&);
    Napi::Value on_first(const Napi::CallbackInfo&);
    Napi::Value on_last(const Napi::CallbackInfo&);
    Napi::Value on_first_multival(const Napi::CallbackInfo&);
    Napi::Value on_last_multival(const Napi::CallbackInfo&);
    
    // Модификация
    Napi::Value put(const Napi::CallbackInfo&);
    Napi::Value del(const Napi::CallbackInfo&);
    
    // Итерация
    Napi::Value for_each(const Napi::CallbackInfo&);
    
    // Закрытие
    Napi::Value close(const Napi::CallbackInfo&);
    
    void attach(txnmou& txn, dbimou& dbi, MDBX_cursor* cursor);
};

} // namespace mdbxmou

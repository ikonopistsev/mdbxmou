#pragma once

#include "dbimou.hpp"

#ifdef MDBX_TXN_HAS_CHILD   
#include <vector>
#endif

namespace mdbxmou {

class envmou;

class txnmou final 
    : public Napi::ObjectWrap<txnmou>
{
private:
    envmou* env_{nullptr};
    // транзакция
    struct free_txn {
        txnmou& that;
        void operator()(MDBX_txn* txn) const noexcept;
    };

    free_txn erase_{*this};
    std::unique_ptr<MDBX_txn, free_txn> txn_{nullptr, erase_};

    // Иерархия транзакций
    txnmou* parent_{nullptr};
#ifdef MDBX_TXN_HAS_CHILD    
    std::vector<txnmou*> children_{};
#endif
    
    // Флаг для отслеживания состояния
    bool is_committed_{};
    bool is_aborted_{};
    
    // Сохраняем тип транзакции для создания дочерних того же типа
    MDBX_txn_flags_t flags_{};

    void check_valid() const 
    {
        if (is_committed_)
            throw std::runtime_error("txn: already committed");
        if (is_aborted_)
            throw std::runtime_error("txn: already aborted");
    }

    void check() const
    {
        check_valid();

        if (!txn_)
            throw std::runtime_error("txn: not initialized");
    }    

#ifdef MDBX_TXN_HAS_CHILD   
    // Проверка активных дочерних транзакций
    bool has_active_children() const {
        for (const auto& child : children_) {
            if (child && child->txn_ && !child->is_committed_ && !child->is_aborted_) {
                return true;
            }
        }
        return false;
    }
    
    // Очистка завершенных дочерних транзакций
    void cleanup_children() {
        children_.erase(
            std::remove_if(children_.begin(), children_.end(),
                [](const txnmou* child) {
                    return !child || child->is_committed_ || child->is_aborted_;
                }),
            children_.end()
        );
    }
    
    // Общий метод для создания дочерних транзакций
    Napi::Value start_transaction(const Napi::CallbackInfo& info, MDBX_txn_flags_t flags);

    void push_back(txnmou* child) {
        children_.push_back(child);
    }
#endif 
public:    
    static Napi::FunctionReference ctor;

    txnmou(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<txnmou>(info) 
    {   }

    static void init(const char *class_name, Napi::Env env);
    static void init(const char *class_name, Napi::Env env, Napi::Object exports);

    // Основные операции (только синхронные)
    Napi::Value commit(const Napi::CallbackInfo&);
    Napi::Value abort(const Napi::CallbackInfo&);

    Napi::Value get_dbi(const Napi::CallbackInfo&);

    operator MDBX_txn*() const noexcept {
        return txn_.get();
    }

#ifdef MDBX_TXN_HAS_CHILD    
    // Работа с вложенными транзакциями
    Napi::Value start_transaction(const Napi::CallbackInfo&);
    Napi::Value get_children_count(const Napi::CallbackInfo&);
#endif
    Napi::Value is_active(const Napi::CallbackInfo&);
    Napi::Value is_top_level(const Napi::CallbackInfo&);

    void attach(envmou& env, MDBX_txn* txn, 
        MDBX_txn_flags_t flags, txnmou* parent = nullptr);
};

} // namespace mdbxmou

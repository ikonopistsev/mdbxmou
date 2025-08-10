#pragma once

#include "txnmou.hpp"
#include <memory>
#include <atomic>
#include <mutex>

namespace mdbxmou {

// Forward declaration
class txnmou;

class envmou final
    : public Napi::ObjectWrap<envmou>
{  
    static Napi::FunctionReference ctor;
    static mdbx::env::geometry parse_geometry(Napi::Object obj);
    static MDBX_env_flags_t parse_env_flags(Napi::Object obj);
    static env_arg0 parse(Napi::Object obj);

    struct free_env {
        void operator()(MDBX_env* env) const {
            auto rc = mdbx_env_close(env);
            if (rc != MDBX_SUCCESS) {
                fprintf(stderr, "mdbx_env_close failed: %s\n", mdbx_strerror(rc));
            }
        }
    };
        
    std::unique_ptr<MDBX_env, free_env> env_{};
    std::atomic<std::size_t> trx_count_{};
    env_arg0 arg0_{};
    std::mutex lock_{};

    bool is_open() const {
        return env_ != nullptr;
    }

    // Inline метод для проверки что база данных открыта
    void check() const {
        if (!is_open()) {
            throw std::runtime_error("Env not open");
        }
    }

    // Inline метод для проверки что база данных закрыта (std версия)
    void check_closed() const {
        if (!env_) {
            throw std::runtime_error("Env closed");
        }
    }

    // Общий метод для создания транзакций
    Napi::Value start_transaction(const Napi::CallbackInfo& info, MDBX_txn_flags_t flags);

public:    
    envmou(const Napi::CallbackInfo& i)
        : ObjectWrap{i}
    {   }

    static MDBX_env* create_and_open(const env_arg0& arg0);
    void attach(MDBX_env* env, const env_arg0& arg0);

    operator MDBX_env*() const noexcept {
        return env_.get();
    }

    static void init(const char *class_name, Napi::Env env);
    static void init(const char *class_name, Napi::Env env, Napi::Object exports);

    envmou& operator++() noexcept {
        auto i = ++trx_count_;
        //fprintf(stderr, "TRACE: trx_count: %zu\n", i);
        return *this;
    }

    envmou& operator--() noexcept {
        auto i = --trx_count_;
        //fprintf(stderr, "TRACE: trx_count: %zu\n", i);
        return *this;
    }

    Napi::Value open(const Napi::CallbackInfo&);
    Napi::Value open_sync(const Napi::CallbackInfo&);
    Napi::Value close(const Napi::CallbackInfo&);
    Napi::Value close_sync(const Napi::CallbackInfo&);
    Napi::Value get_version(const Napi::CallbackInfo&);
    Napi::Value copy_to_sync(const Napi::CallbackInfo&);
    Napi::Value copy_to(const Napi::CallbackInfo&);
    // метод для групповых вставок или чтения
    // внутри транзакция, получение db и чтение/запись
    Napi::Value query(const Napi::CallbackInfo&); 
    
    // Методы для создания транзакций
    Napi::Value start_read(const Napi::CallbackInfo&);
    Napi::Value start_write(const Napi::CallbackInfo&);

    using lock_guard = std::lock_guard<envmou>;
    //  для защиты асинхронных операций
    void lock() {
        //fprintf(stderr, "TRACE: envmou lock: %zu\n", trx_count_.load());
        auto rc = lock_.try_lock();
        if (!rc) {
            throw std::runtime_error("operation in progress");
        }
    }
    void unlock()  {
        //fprintf(stderr, "TRACE: envmou unlock: %zu\n", trx_count_.load());
        lock_.unlock();
    }
    bool try_lock() {
        bool locked = lock_.try_lock();
        if (locked) {
            //fprintf(stderr, "TRACE: envmou try_lock: %s %zu\n", 
            //    locked ? "true" : "false", trx_count_.load());
        }
        return locked;
    }

    void do_close() {
        if (trx_count_.load() > 0) {
            throw std::runtime_error("Env: transaction in progress");
        }
        env_.reset();
    }
};

} // namespace mdbxmou

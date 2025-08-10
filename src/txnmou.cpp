#include "txnmou.hpp"
#include "envmou.hpp"

namespace mdbxmou {

Napi::FunctionReference txnmou::ctor{};

void txnmou::init(const char *class_name, Napi::Env env) {
    auto func = DefineClass(env, class_name, {
        InstanceMethod("commit", &txnmou::commit),
        InstanceMethod("abort", &txnmou::abort),
        InstanceMethod("getDbi", &txnmou::get_dbi),
        InstanceMethod("isActive", &txnmou::is_active),
        InstanceMethod("isTopLevel", &txnmou::is_top_level),
#ifdef MDBX_TXN_HAS_CHILD        
        InstanceMethod("startTransaction", &txnmou::start_transaction),
        InstanceMethod("getChildrenCount", &txnmou::get_children_count),
#endif
    });

    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
}

void txnmou::init(const char *class_name, Napi::Env env, Napi::Object exports)
{
    auto func = DefineClass(env, class_name, {
        InstanceMethod("commit", &txnmou::commit),
        InstanceMethod("abort", &txnmou::abort),
        InstanceMethod("isActive", &txnmou::is_active),
        InstanceMethod("isTopLevel", &txnmou::is_top_level),
#ifdef MDBX_TXN_HAS_CHILD        
        InstanceMethod("startTransaction", &txnmou::start_transaction),
        InstanceMethod("getChildrenCount", &txnmou::get_children_count),
#endif
    });

    ctor = Napi::Persistent(func);
    ctor.SuppressDestruct();
    exports.Set(class_name, ctor.Value());
}

Napi::Value txnmou::commit(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    try {
        check();
#ifdef MDBX_TXN_HAS_CHILD
        // Проверяем активные дочерние транзакции
        cleanup_children();

        if (has_active_children()) {
            throw std::runtime_error("txn: active child exist");
        }
#endif // MDBX_TXN_HAS_CHILD        
        auto rc = mdbx_txn_commit(*this);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, std::string("txn: ") + mdbx_strerror(rc));
        }

        is_committed_ = true;
        // Отключаем deleter, так как транзакция уже закоммичена
        txn_.reset();
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
    
    return env.Undefined();
}

Napi::Value txnmou::abort(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        check();
#ifdef MDBX_TXN_HAS_CHILD  
        // Сначала отменяем все дочерние транзакции
        cleanup_children();

        for (const auto& child : children_) {
            if (child && child->txn_ && !child->is_committed_ && !child->is_aborted_) {
                try {
                    child->abort(info);
                } catch (...) {
                    // Игнорируем ошибки при abort дочерних
                }
            }
        }
#endif // MDBX_TXN_HAS_CHILD
        auto rc = mdbx_txn_abort(*this);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, std::string("txn: ") + mdbx_strerror(rc));
        }

        is_aborted_ = true;
        txn_.reset();
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
    
    return env.Undefined();
}

Napi::Value txnmou::get_dbi(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    try
    {
        std::string tmp{};
        MDBX_db_flags_t flags{MDBX_DB_DEFAULTS};
        auto arg_count = info.Length();
        if (arg_count == 2) {
            tmp = info[0].As<Napi::String>().Utf8Value();
            flags = static_cast<MDBX_db_flags_t>(info[1].As<Napi::Number>().Int32Value());
        } else {
            if (arg_count == 1) {
                if (info[0].IsNumber()) {
                    flags = static_cast<MDBX_db_flags_t>(info[0].As<Napi::Number>().Int32Value());
                } else if (info[0].IsString()) {
                    tmp = info[0].As<Napi::String>().Utf8Value();
                }
            }
        }
        const char *name{nullptr};
        if (!tmp.empty()) {
            name = tmp.c_str();
        }

        check();    

        // создаем новый объект dbi
        auto obj = dbimou::ctor.New({});
        auto ptr = dbimou::Unwrap(obj);        

        MDBX_dbi dbi{};
        auto rc = mdbx_dbi_open(*this, name, flags, &dbi);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, std::string("flags=") + 
                std::to_string(flags) + ", " + mdbx_strerror(rc));
        }
        ptr->attach(env_, this, dbi, flags);
        return obj;
    }
    catch(const std::exception& e)
    {
        throw Napi::Error::New(env, std::string("txn: get_dbi ") + e.what());
    }
    
    return env.Undefined();
}

Napi::Value txnmou::is_active(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool active = txn_ && !is_committed_ && !is_aborted_;
    return Napi::Boolean::New(env, active);
}

Napi::Value txnmou::is_top_level(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, parent_ == nullptr);
}

#ifdef MDBX_TXN_HAS_CHILD   

Napi::Value txnmou::start_transaction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Создаем новый объект txnmou для дочерней транзакции
    auto child_obj = ctor.New({});
    auto child_wrapper = txnmou::Unwrap(child_obj);

    int rc{MDBX_SUCCESS};
    try {
        check();

        MDBX_txn* child_txn;
        auto rc = mdbx_txn_begin(*env_, txn_.get(), flags_, &child_txn);
        if (rc != MDBX_SUCCESS) {
            std::string flag_name = (flags_ == MDBX_TXN_RDONLY) ? "read" : "write";
            throw Napi::Error::New(env, std::string("txn ") + flag_name + ": " + mdbx_strerror(rc));
        }
        child_wrapper->attach(*env_, child_txn, flags_, this);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }  

    return child_obj;
}

Napi::Value txnmou::get_children_count(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    cleanup_children();
    
    size_t active_count = 0;
    for (const auto& child : children_) {
        if (child && child->txn_ && !child->is_committed_ && !child->is_aborted_) {
            active_count++;
        }
    }
    
    return Napi::Number::New(env, static_cast<double>(active_count));
}

#endif // MDBX_TXN_HAS_CHILD

void txnmou::attach(envmou& env, MDBX_txn* txn, 
    MDBX_txn_flags_t flags, txnmou* parent) 
{
    // увеличиваем счетчик транзакций в env
    env_ = &env;

    if (parent == nullptr) {
        // Если родительская транзакция не указана, увеличиваем счетчик
        ++(*env_);
    }

    parent_ = parent;
    flags_ = flags;
    is_committed_ = false;
    is_aborted_ = false;

#ifdef MDBX_TXN_HAS_CHILD        
    if (parent) {
        parent->push_back(this);
    }
#endif  
    txn_.reset(txn);
}

void txnmou::free_txn::operator()(MDBX_txn* txn) const noexcept {
    if (!that.is_committed_ && !that.is_aborted_) {
        // Автоматический abort при деструкции
        auto rc = mdbx_txn_abort(that);
        if (rc != MDBX_SUCCESS) {
            fprintf(stderr, "mdbx_txn_abort code: %d, msg: %s\n", rc, mdbx_strerror(rc));
        }
        that.is_aborted_ = true;
    }
    // уменьшаем счетчик транзакций (только родительских)
    if (that.parent_ == nullptr) {
        //fprintf(stderr, "free_txn: --env\n");
        --(*that.env_);
    }
}

} // namespace mdbxmou
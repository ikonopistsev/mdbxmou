#include "txnmou.hpp"
#include "envmou.hpp"

namespace mdbxmou {

Napi::FunctionReference txnmou::ctor{};

void txnmou::init(const char *class_name, Napi::Env env) {
    auto func = DefineClass(env, class_name, {
        InstanceMethod("commit", &txnmou::commit),
        InstanceMethod("abort", &txnmou::abort),
        InstanceMethod("openMap", &txnmou::open_map),
        InstanceMethod("createMap", &txnmou::create_map),
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

Napi::Value txnmou::get_dbi(const Napi::CallbackInfo& info, db_mode db_mode)
{
    Napi::Env env = info.Env();

    try
    {
        if ((mode_.val & txn_mode::ro) && (db_mode.val & db_mode::create)) {
            throw std::runtime_error("dbi: cannot open DB in read-only transaction");
        }

        key_mode key_mode{};
        value_mode value_mode{};
        std::string db_name{};
        auto conf = dbimou::get_env_userctx(*env_);
        auto key_flag = conf->key_flag;
        auto value_flag = conf->value_flag;
        auto arg_count = info.Length();
        if (arg_count == 3) {
            auto arg0 = info[0]; // db_name
            auto arg1 = info[1]; // key_mode
            auto arg2 = info[2]; // value_mode
            db_name = arg0.As<Napi::String>().Utf8Value();
            key_mode = parse_key_mode(env, arg1, key_flag);
            value_mode = value_mode::parse(arg2);
        } else if (arg_count == 2) {
            // db_name + key_mode || key_mode + value_mode
            auto arg0 = info[0]; 
            auto arg1 = info[1]; 
            if (arg0.IsString()) {
                db_name = arg0.As<Napi::String>().Utf8Value();
                key_mode = parse_key_mode(env, arg1, key_flag);
            } else if (arg0.IsNumber()) {
                key_mode = parse_key_mode(env, arg0, key_flag);
                value_mode = value_mode::parse(arg1);
            } else {
                throw Napi::Error::New(env, "Invalid argument type for db_name or value_mode");
            }
        } else if (arg_count == 1) {
            // db_name || key_mode
            auto arg0 = info[0];
            if (arg0.IsString()) {
                db_name = arg0.As<Napi::String>().Utf8Value();
            } else {
                key_mode = parse_key_mode(env, arg0, key_flag);
            }
        } else {
            throw Napi::Error::New(env, "Invalid number of arguments for get_dbi");
        }

        check();    

        // создаем новый объект dbi
        auto obj = dbimou::ctor.New({});
        auto ptr = dbimou::Unwrap(obj);        

        MDBX_dbi dbi{};
        auto flags = static_cast<MDBX_db_flags_t>(db_mode.val|key_mode.val|value_mode.val);
        auto rc = mdbx_dbi_open(*this, db_name.empty() ? nullptr : db_name.c_str(), flags, &dbi);
        if (rc != MDBX_SUCCESS) {
            throw std::runtime_error(std::string("mdbx_dbi_open ") + mdbx_strerror(rc));
        }
        ptr->attach(env_, this, dbi, db_mode, key_mode, 
            value_mode, key_flag, value_flag);
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
    txn_mode mode, txnmou* parent) 
{
    // увеличиваем счетчик транзакций в env
    env_ = &env;

    if (parent == nullptr) {
        // Если родительская транзакция не указана, увеличиваем счетчик
        ++(*env_);
    }

    parent_ = parent;
    mode_ = mode;
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
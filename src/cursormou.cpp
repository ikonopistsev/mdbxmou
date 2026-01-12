#include "cursormou.hpp"
#include "dbimou.hpp"
#include "txnmou.hpp"

namespace mdbxmou
{

    Napi::FunctionReference cursormou::ctor{};

    void cursormou::init(const char *class_name, Napi::Env env)
    {
        auto func = DefineClass(env, class_name, {
            InstanceMethod("first", &cursormou::first),
            InstanceMethod("last", &cursormou::last),
            InstanceMethod("next", &cursormou::next),
            InstanceMethod("prev", &cursormou::prev),
            InstanceMethod("seek", &cursormou::seek),
            InstanceMethod("seekGE", &cursormou::seek_ge),
            InstanceMethod("current", &cursormou::current),
            InstanceMethod("eof", &cursormou::eof),
            InstanceMethod("onFirst", &cursormou::on_first),
            InstanceMethod("onLast", &cursormou::on_last),
            InstanceMethod("onFirstMultival", &cursormou::on_first_multival),
            InstanceMethod("onLastMultival", &cursormou::on_last_multival),
            InstanceMethod("put", &cursormou::put),
            InstanceMethod("del", &cursormou::del),
            InstanceMethod("forEach", &cursormou::for_each),
            InstanceMethod("close", &cursormou::close),
        });

        ctor = Napi::Persistent(func);
        ctor.SuppressDestruct();
    }

    void cursormou::do_close() noexcept
    {
        if (cursor_) {
            ::mdbx_cursor_close(std::exchange(cursor_, nullptr));
            if (txn_) {
                --(*txn_);
            }
        }
    }

    cursormou::~cursormou()
    {
        do_close();
    }

    void cursormou::attach(txnmou &txn, dbimou &dbi, MDBX_cursor *cursor)
    {
        txn_ = &(++txn);
        dbi_ = &dbi;
        cursor_ = cursor;
    }

    // Внутренний хелпер для навигации
    Napi::Value cursormou::move(const Napi::Env &env, MDBX_cursor_op op)
    {
        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }

        keymou key{};
        valuemou val{};
        auto rc = mdbx_cursor_get(cursor_, key, val, op);
        if (rc == MDBX_NOTFOUND) {
            return env.Undefined();
        }

        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

        // Возвращаем {key, value}
        auto result = Napi::Object::New(env);

        auto key_mode = dbi_->get_key_mode();
        auto key_flag = dbi_->get_key_flag();
        auto value_flag = dbi_->get_value_flag();

        // Ключ
        if (mdbx::is_ordinal(key_mode)) {
            if (key_flag.val & base_flag::bigint) {
                result.Set("key", key.to_bigint(env));
            } else {
                result.Set("key", key.to_number(env));
            }
        } else {
            result.Set("key", key.to_string(env));
        }

        // Значение
        if (value_flag.val & base_flag::string) {
            result.Set("value", val.to_string(env));
        } else {
            result.Set("value", val.to_buffer(env));
        }

        return result;
    }

    Napi::Value cursormou::first(const Napi::CallbackInfo &info)
    {
        return move(info.Env(), MDBX_FIRST);
    }

    Napi::Value cursormou::last(const Napi::CallbackInfo &info)
    {
        return move(info.Env(), MDBX_LAST);
    }

    Napi::Value cursormou::next(const Napi::CallbackInfo &info)
    {
        return move(info.Env(), MDBX_NEXT);
    }

    Napi::Value cursormou::prev(const Napi::CallbackInfo &info)
    {
        return move(info.Env(), MDBX_PREV);
    }

    Napi::Value cursormou::current(const Napi::CallbackInfo &info)
    {
        return move(info.Env(), MDBX_GET_CURRENT);
    }

    Napi::Value cursormou::eof(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();
        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }
        auto rc = ::mdbx_cursor_eof(cursor_);
        if (rc == MDBX_RESULT_TRUE)
            return Napi::Boolean::New(env, true);
        if (rc == MDBX_RESULT_FALSE)
            return Napi::Boolean::New(env, false);
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }

    Napi::Value cursormou::on_first(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();
        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }
        auto rc = ::mdbx_cursor_on_first(cursor_);
        if (rc == MDBX_RESULT_TRUE)
            return Napi::Boolean::New(env, true);
        if (rc == MDBX_RESULT_FALSE)
            return Napi::Boolean::New(env, false);
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }

    Napi::Value cursormou::on_last(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();
        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }
        auto rc = ::mdbx_cursor_on_last(cursor_);
        if (rc == MDBX_RESULT_TRUE)
            return Napi::Boolean::New(env, true);
        if (rc == MDBX_RESULT_FALSE)
            return Napi::Boolean::New(env, false);
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }

    Napi::Value cursormou::on_first_multival(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();
        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }
        auto rc = ::mdbx_cursor_on_first_dup(cursor_);
        if (rc == MDBX_RESULT_TRUE)
            return Napi::Boolean::New(env, true);
        if (rc == MDBX_RESULT_FALSE)
            return Napi::Boolean::New(env, false);
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }

    Napi::Value cursormou::on_last_multival(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();
        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }
        auto rc = ::mdbx_cursor_on_last_dup(cursor_);
        if (rc == MDBX_RESULT_TRUE)
            return Napi::Boolean::New(env, true);
        if (rc == MDBX_RESULT_FALSE)
            return Napi::Boolean::New(env, false);
        throw Napi::Error::New(env, mdbx_strerror(rc));
    }

    // Хелпер для поиска
    Napi::Value cursormou::seek_impl(const Napi::CallbackInfo &info, MDBX_cursor_op op)
    {
        Napi::Env env = info.Env();

        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }

        if (info.Length() < 1) {
            throw Napi::Error::New(env, "key required");
        }

        auto key_mode = dbi_->get_key_mode();

        keymou key = (mdbx::is_ordinal(key_mode)) ? 
            keymou::from(info[0], env, key_num_) : 
            keymou::from(info[0], env, key_buf_);

        valuemou val{};
        auto rc = mdbx_cursor_get(cursor_, key, val, op);
        if (MDBX_NOTFOUND == rc) {
            return env.Undefined();
        }

        if (MDBX_SUCCESS != rc) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

        // Возвращаем {key, value}
        auto result = Napi::Object::New(env);

        auto key_flag = dbi_->get_key_flag();
        auto value_flag = dbi_->get_value_flag();

        // Ключ
        if (mdbx::is_ordinal(key_mode)) {
            if (key_flag.val & base_flag::bigint) {
                result.Set("key", key.to_bigint(env));
            } else {
                result.Set("key", key.to_number(env));
            }
        } else {
            result.Set("key", key.to_string(env));
        }

        // Значение
        if (value_flag.val & base_flag::string) {
            result.Set("value", val.to_string(env));
        } else {
            result.Set("value", val.to_buffer(env));
        }

        return result;
    }

    Napi::Value cursormou::seek(const Napi::CallbackInfo &info)
    {
        return seek_impl(info, MDBX_SET_KEY);
    }

    Napi::Value cursormou::seek_ge(const Napi::CallbackInfo &info)
    {
        return seek_impl(info, MDBX_SET_RANGE);
    }

    Napi::Value cursormou::put(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }

        if (info.Length() < 2) {
            throw Napi::Error::New(env, "key and value required");
        }

        auto key_mode = dbi_->get_key_mode();

        keymou key = (mdbx::is_ordinal(key_mode)) ? 
            keymou::from(info[0], env, key_num_) : 
            keymou::from(info[0], env, key_buf_);

        valuemou val = valuemou::from(info[1], env, val_buf_);

        // Опциональный флаг put_mode (по умолчанию MDBX_UPSERT)
        MDBX_put_flags_t flags = MDBX_UPSERT;
        if (info.Length() > 2 && info[2].IsNumber()) {
            flags = static_cast<MDBX_put_flags_t>(info[2].As<Napi::Number>().Int32Value());
        }

        auto rc = mdbx_cursor_put(cursor_, key, val, flags);
        if (MDBX_SUCCESS != rc) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

        return env.Undefined();
    }

    Napi::Value cursormou::del(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }

        // Опциональный флаг (MDBX_NODUPDATA для удаления только текущего значения в multi-value)
        MDBX_put_flags_t flags = MDBX_CURRENT;
        if (info.Length() > 0 && info[0].IsNumber()) {
            flags = static_cast<MDBX_put_flags_t>(info[0].As<Napi::Number>().Int32Value());
        }

        auto rc = mdbx_cursor_del(cursor_, flags);
        if (MDBX_NOTFOUND == rc) {
            return Napi::Boolean::New(env, false);
        }

        if (MDBX_SUCCESS != rc) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

        return Napi::Boolean::New(env, true);
    }

    // forEach(callback, backward = false)
    // callback({key, value}) => true продолжить, false/undefined остановить
    Napi::Value cursormou::for_each(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (!cursor_) {
            throw Napi::Error::New(env, "cursor closed");
        }

        if (info.Length() < 1 || !info[0].IsFunction()) {
            throw Napi::TypeError::New(env, "forEach: callback function required");
        }

        auto callback = info[0].As<Napi::Function>();
        bool backward = info.Length() > 1 && info[1].ToBoolean().Value();

        auto key_mode = dbi_->get_key_mode();
        auto key_flag = dbi_->get_key_flag();
        auto value_flag = dbi_->get_value_flag();

        MDBX_cursor_op start_op = backward ? MDBX_LAST : MDBX_FIRST;
        MDBX_cursor_op move_op = backward ? MDBX_PREV : MDBX_NEXT;

        keymou key{};
        valuemou val{};
        // Первое позиционирование
        auto rc = mdbx_cursor_get(cursor_, key, val, start_op);
        while (MDBX_SUCCESS == rc)
        {
            auto result = Napi::Object::New(env);

            // Ключ
            if (mdbx::is_ordinal(key_mode)) {
                if (key_flag.val & base_flag::bigint) {
                    result.Set("key", key.to_bigint(env));
                } else {
                    result.Set("key", key.to_number(env));
                }
            } else {
                result.Set("key", key.to_string(env));
            }

            // Значение
            if (value_flag.val & base_flag::string) {
                result.Set("value", val.to_string(env));
            } else {
                result.Set("value", val.to_buffer(env));
            }

            // Вызов callback
            auto ret = callback.Call({result});

            // true stops the scan, false/undefined continues (same as dbi.forEach)
            if (ret.IsBoolean() && ret.ToBoolean()) {
                break;
            }

            // Следующий элемент
            rc = mdbx_cursor_get(cursor_, key, val, move_op);
        }

        if (rc != MDBX_SUCCESS && rc != MDBX_NOTFOUND) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

        return env.Undefined();
    }

    Napi::Value cursormou::close(const Napi::CallbackInfo &info)
    {
        do_close();
        return info.Env().Undefined();
    }

} // namespace mdbxmou

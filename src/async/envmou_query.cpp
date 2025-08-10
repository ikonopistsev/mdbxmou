#include "envmou_query.hpp"
#include "envmou.hpp"

namespace mdbxmou {

void async_query::Execute() 
{
    // создаем транзакцию
    //fprintf(stderr, "TRACE: async_query::Execute mdbx_txn_begin id=%d\n", gettid());
    MDBX_txn* txn;
    auto rc = mdbx_txn_begin(env_, nullptr, txn_flags_, &txn);
    if (rc != MDBX_SUCCESS) {
        SetError("query->txn_begin " + std::string("flags=") + std::to_string(txn_flags_) + 
            std::string(", ") + mdbx_strerror(rc));
        return;
    }

    // лямбда для отката транзакции
    auto abort_txn = [](MDBX_txn* txn) noexcept {
        auto rc = mdbx_txn_abort(txn);
        if (rc != MDBX_SUCCESS) {
            // какое-то сообщение куда-то
            fprintf(stderr, "mdbx_txn_abort failed: %s\n", mdbx_strerror(rc));
        }
    };

    try {
        for (auto& req : query_arr_) 
        {
            const char * name = nullptr;
            if (!req.db.empty()) {
                name = req.db.c_str();
            }
            MDBX_dbi dbi;
            rc = mdbx_dbi_open(txn, name, req.flag, &dbi);
            //fprintf(stderr, "TRACE: async_query::Execute mdbx_dbi_open=%d id=%d\n", rc, gettid());
            if (rc != MDBX_SUCCESS) {
                mdbx_txn_abort(txn);
                // чтобы не получить сигфолт
                if (!name) {
                    name = "null";
                }
                SetError("query->dbi_open " + std::string("flags=") + std::to_string(req.flag) + 
                    std::string(", (db:") + name + "), " + mdbx_strerror(rc));
                return;
            }

            //fprintf(stderr, "TRACE: async_query::Execute loop id=%d\n", gettid());
            for (auto& q : req.item) 
            {
                // получаем ключ и значение
                auto k = q.mdbx_key(req.flag);
                auto v = q.mdbx_value();
                if (q.flag == query_item::MDBXMOU_GET) {
                    // выполняем get
                    rc = mdbx_get(txn, dbi, &k, &v);
                    q.set_result(rc, v);
                } else {
                    // иначе put
                    //fprintf(stderr, "TRACE: async_query::Execute mdbx_put id=%d\n", gettid());
                    rc = mdbx_put(txn, dbi, &k, &v, 
                        static_cast<MDBX_put_flags_t>(q.flag));
                    q.rc = rc;
                }
            }
        }

        //fprintf(stderr, "TRACE: async_query::Execute mdbx_txn_commit id=%d\n", gettid());
        rc = mdbx_txn_commit(txn);
        if (rc != MDBX_SUCCESS) {
            SetError("query->txn_commit " + std::string("flags=") + std::to_string(txn_flags_) + 
                std::string(", ") + mdbx_strerror(rc));
        }
    } catch (const std::exception& e) {
        abort_txn(txn);
        SetError(e.what());
    } catch (...) {
        abort_txn(txn);
        SetError("async_query::Execute");
    }
}

void async_query::OnOK() 
{
    // выдадим идентфикатор потока для лога (thread_id)
    //fprintf(stderr, "TRACE: async_query::OnOK id=%d\n", gettid());
    
    // уменьшаем счетчик trx_count
    --env_;

    Napi::Env env = Env();
    Napi::Array result = Napi::Array::New(env, query_arr_.size());
    for (std::size_t i = 0; i < query_arr_.size(); ++i) {
        const auto& row = query_arr_[i];
        Napi::Object js_row = Napi::Object::New(env);
        if (!row.db.empty()) {
            js_row.Set("db", Napi::String::New(env, row.db));
        }
        if (row.flag != MDBX_DB_DEFAULTS) {
            js_row.Set("flag", Napi::Number::New(env, row.flag));
        }
        auto& param = row.item;
        auto js_arr = Napi::Array::New(env, param.size());
        for (std::size_t j = 0; j < param.size(); ++j) {
            const auto& item = param[j];
            Napi::Object js_item = Napi::Object::New(env);
            if (row.flag & MDBX_INTEGERKEY) {
                auto& id_rc = item.id;
                if (row.id_type == query_db::key_bigint) {
                    js_item.Set("key", Napi::BigInt::New(env, id_rc));
                } else {
                    js_item.Set("key", Napi::Number::New(env, static_cast<int64_t>(id_rc)));
                }
            } else {
                auto& key_rc = item.key;
                if (key_string_) {
                    js_item.Set("key", Napi::String::New(env, key_rc.data(), key_rc.size()));
                } else {
                    js_item.Set("key", Napi::Buffer<char>::Copy(env, key_rc.data(), key_rc.size()));
                }
            }

            if (item.val.empty()) {
                js_item.Set("value", env.Null());
            } else {
                if (val_string_) {
                    js_item.Set("value", Napi::String::New(env, item.val.data(), item.val.size()));
                } else {
                    js_item.Set("value", Napi::Buffer<char>::Copy(env, item.val.data(), item.val.size()));
                }
            }

            // скрываем гет флаг
            if (item.flag != query_item::MDBXMOU_GET) {
                js_item.Set("flag", Napi::Number::New(env, item.flag));
            }
            js_item.Set("rc", Napi::Number::New(env, item.rc));
            js_arr.Set(j, js_item);
        }

        js_row.Set("item", js_arr);
        result.Set(i, js_row);
    }

    deferred_.Resolve(result);
}

void async_query::OnError(const Napi::Error& e) 
{
    //fprintf(stderr, "TRACE: async_query::OnError id=%d\n", gettid());
    // уменьшаем счетчик trx_count
    --env_;

    deferred_.Reject(e.Value());
}    

} // namespace mdbxmou
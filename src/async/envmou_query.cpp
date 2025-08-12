#include "envmou_query.hpp"
#include "envmou.hpp"

namespace mdbxmou {

void async_query::Execute() 
{
    try {
        // стартуем транзакцию
        auto txn = start_transaction();
        for (auto& req : query_) 
        {
            mdbx::map_handle dbi{};
            auto db_mode = req.db_mod;
            if (db_mode.val & db_mode::accede) {
                dbi = txn.open_map_accede(req.db);
            } else if (db_mode.val & db_mode::create) {
                dbi = txn.create_map(req.db, req.key_mod, req.val_mod);
            } else {
                dbi = txn.open_map(req.db, req.key_mod, req.val_mod);
            }

            auto mode = req.mode;
            if (mode.val & query_mode::get) {
                do_get(txn, dbi, req);
            } else if (mode.val & query_mode::del) {
                do_del(txn, dbi, req);
            } else {
                do_put(txn, dbi, req);
            }
        }

        txn.commit();
    } catch (const std::exception& e) {
        SetError(e.what());
    } catch (...) {
        SetError("async_query::Execute");
    }
}

static Napi::Value write_row(Napi::Env env, const query_line& row) 
{
    auto& param = row.item;
    auto key_mode = row.key_mod;
    auto key_flag = row.key_flag;
    auto mode = row.mode;
    auto js_arr = Napi::Array::New(env, param.size());
    for (std::size_t j = 0; j < param.size(); ++j) {
        const auto& item = param[j];
        Napi::Object js_item = Napi::Object::New(env);
        if (key_mode.val & key_mode::ordinal) {
            js_item.Set("key", (key_flag.val & base_flag::number) ?
                Napi::Number::New(env, item.id_buf) : Napi::BigInt::New(env, item.id_buf));
        } else {
            js_item.Set("key", (key_flag.val & base_flag::string) ?
                Napi::String::New(env, item.key_buf.data(), item.key_buf.size()) :
                Napi::Buffer<char>::Copy(env, item.key_buf.data(), item.key_buf.size()));
        }

        // все методы которые должны показать value в результате
        const auto mask{query_mode::get|query_mode::upsert|
            query_mode::update|query_mode::insert_unique};
        if (mode.val & mask) 
        {
            auto& val_buf = item.val_buf;
            if (val_buf.empty()) {
                js_item.Set("value", env.Null());
            } else {
                auto value_flag = row.value_flag;
                js_item.Set("value", (value_flag.val & base_flag::string) ?
                    Napi::String::New(env, val_buf.data(), val_buf.size()) :
                    Napi::Buffer<char>::Copy(env, val_buf.data(), val_buf.size()));
            }
        }

        // выдадим флаги удаления и успешности
        if (mode.val & query_mode::del) {
            js_item.Set("found", Napi::Boolean::New(env, item.found));
        }
        js_arr.Set(j, js_item);
    }
    return js_arr;
}

void async_query::OnOK() 
{
    --env_;

    Napi::Env env = Env();

    if (single_) {
        if (query_.size() == 1) {
            const auto& row = query_[0];
            deferred_.Resolve(write_row(env, row));
            return;
        }
    }

    Napi::Array result = Napi::Array::New(env, query_.size());
    for (std::size_t i = 0; i < query_.size(); ++i) {
        Napi::Object js_row = Napi::Object::New(env);
        const auto& row = query_[i];
        if (!row.db.empty()) {
            js_row.Set("db", Napi::String::New(env, row.db_name));
        }
        result.Set(i, write_row(env, row));
    }

    deferred_.Resolve(result);
}

void async_query::OnError(const Napi::Error& e) 
{
    --env_;
    
    deferred_.Reject(e.Value());
}

txnmou_managed async_query::start_transaction()
{
    MDBX_txn *ptr;
    mdbx::error::success_or_throw(::mdbx_txn_begin(env_, nullptr, txn_mode_, &ptr));
    return { ptr };
}

void async_query::do_del(txnmou_managed& txn, 
    mdbx::map_handle dbi, query_line& arg0)
{
    auto key_mode = arg0.key_mod;
    for (auto& q : arg0.item) 
    {
        auto key = mdbx::is_ordinal(key_mode) ?
            keymou{q.id_buf} : keymou{q.key_buf};
        q.found = txn.erase(dbi, key);
    }
}

void async_query::do_get(const txnmou_managed& txn, 
    mdbx::map_handle dbi, query_line& arg0)
{
    auto key_mode = arg0.key_mod;
    for (auto& q : arg0.item) 
    {
        auto key = mdbx::is_ordinal(key_mode) ?
            keymou{q.id_buf} : keymou{q.key_buf};
        mdbx::slice abs{};
        valuemou val{txn.get(dbi, key, abs)};
        q.set(val);
    }
}

void async_query::do_put(txnmou_managed& txn, 
    mdbx::map_handle dbi, query_line& arg0)
{
    auto mode = arg0.mode;
    // очищаем put флаги
    auto key_mode = arg0.key_mod;
    for (auto& q : arg0.item) 
    {
        auto key = mdbx::is_ordinal(key_mode) ?
            keymou{q.id_buf} : keymou{q.key_buf};
        mdbx::slice val{q.val_buf.data(), q.val_buf.size()};
        txn.put(dbi, key, val, mode);
    }
}

} // namespace mdbxmou
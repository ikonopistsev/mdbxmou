#include "envmou_query.hpp"
#include "convmou.hpp"
#include "envmou.hpp"

namespace mdbxmou {

void async_query::Execute() 
{
    try {
        // стартуем транзакцию
        auto txn = start_transaction();
        for (auto& req : query_) 
        {
            mdbx::map_handle dbi{req.id};
            auto mode = req.mode;
            if (mode.is_get()) {
                do_get(txn, dbi, req);
            } else if (mode.is_del()) {
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
    auto mode = row.mode;
    convmou conv{row.key_mod, row.val_mod, row.key_flag, row.value_flag};
    auto js_arr = Napi::Array::New(env, param.size());
    for (std::size_t j = 0; j < param.size(); ++j) {
        const auto& item = param[j];
        Napi::Object js_item = Napi::Object::New(env);
        auto key = mdbx::is_ordinal(row.key_mod) ?
            keymou{item.id_buf} :
            keymou{item.key_buf};
        js_item.Set("key", conv.convert_key(env, key));

        if (mode.is_get() || mode.is_write()) {
            auto& val_buf = item.val_buf;
            if (is_ordinal(row.val_mod) && mode.is_write() && val_buf.empty()) {
                js_item.Set("value", conv.convert_value(env, valuemou{item.val_num}));
            } else if (val_buf.empty()) {
                js_item.Set("value", env.Null());
            } else {
                js_item.Set("value",
                    conv.convert_value(env, valuemou{val_buf}));
            }
        }

        // выдадим флаги удаления и успешности
        if (mode.is_del()) {
            js_item.Set("found", Napi::Boolean::New(env, item.found));
        }
        js_arr.Set(static_cast<uint32_t>(j), js_item);
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
        result.Set(static_cast<uint32_t>(i), write_row(env, row));
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
        mdbx::slice abs;
        valuemou val{txn.get(dbi, key, abs)};
        q.set(val);
    }
}

void async_query::do_put(txnmou_managed& txn, 
    mdbx::map_handle dbi, query_line& arg0)
{
    auto flags = static_cast<MDBX_put_flags_t>(
        arg0.mode.write_flags() | arg0.put_flags.val);
    // очищаем put флаги
    auto key_mode = arg0.key_mod;
    for (auto& q : arg0.item) 
    {
        auto key = mdbx::is_ordinal(key_mode) ?
            keymou{q.id_buf} : keymou{q.key_buf};
        valuemou val = is_ordinal(arg0.val_mod) ?
            valuemou{q.val_num} :
            valuemou{q.val_buf};
        mdbx::error::success_or_throw(txn.put(dbi, key, &val, flags));
    }
}

} // namespace mdbxmou

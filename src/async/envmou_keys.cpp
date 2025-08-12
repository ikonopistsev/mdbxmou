#include "envmou_keys.hpp"
#include "envmou.hpp"
#include "dbimou.hpp"

namespace mdbxmou {

void async_keys::Execute() 
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
            } else {
                dbi = txn.open_map(req.db, req.key_mod, req.val_mod);
            }
            do_keys(txn, dbi, req);
        }

        txn.commit();
    } catch (const std::exception& e) {
        SetError(e.what());
    } catch (...) {
        SetError("async_keys::Execute");
    }
}

static Napi::Value write_row(Napi::Env env, const keys_line& row) 
{
    auto& param = row.item;
    auto key_mode = row.key_mod;
    auto key_flag = row.key_flag;
    auto js_arr = Napi::Array::New(env, param.size());
    for (std::size_t j = 0; j < param.size(); ++j) {
        const auto& item = param[j];
        if (key_mode.val & key_mode::ordinal) {
            js_arr.Set(j, (key_flag.val & base_flag::number) ?
                Napi::Number::New(env, item.id_buf) : Napi::BigInt::New(env, item.id_buf));
        } else {
            js_arr.Set(j, (key_flag.val & base_flag::string) ?
                Napi::String::New(env, item.key_buf.data(), item.key_buf.size()) :
                Napi::Buffer<char>::Copy(env, item.key_buf.data(), item.key_buf.size()));
        }
    }
    return js_arr;
}

void async_keys::OnOK() 
{
    auto env = Env();

    --env_;

    if (single_ && (query_.size() == 1)) {
        const auto& row = query_[0];
        deferred_.Resolve(write_row(env, row));
        return;
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

void async_keys::OnError(const Napi::Error& e) 
{
    --env_;

    deferred_.Reject(e.Value());
}

txnmou_managed async_keys::start_transaction()
{
    MDBX_txn *ptr;
    mdbx::error::success_or_throw(::mdbx_txn_begin(env_, nullptr, txn_mode_, &ptr));
    return { ptr };
}

void async_keys::do_keys(txnmou_managed& txn, 
    mdbx::map_handle dbi, keys_line& arg0)
{
    auto& item = arg0.item;
    auto stat = dbimou::get_stat(txn, dbi);
    // резервируем место в item
    item.reserve(stat.ms_entries);
    // открываем курсор
    auto cursor = txn.open_cursor(dbi);
    // получаем все ключи и схраняем из в arg0.item
    if (mdbx::is_ordinal(arg0.key_mod)) {
        cursor.scan([&](const mdbx::pair& f) {
            async_key rc{};
            rc.id_buf = f.key.as_uint64();
            item.push_back(std::move(rc));
            return false;
        });
    } else {
        cursor.scan([&](const mdbx::pair& f) {
            async_key rc{};
            rc.key_buf.assign(f.key.char_ptr(), f.key.end_char_ptr());
            item.push_back(std::move(rc));
            return false;
        });
    }
}

} // namespace mdbxmou

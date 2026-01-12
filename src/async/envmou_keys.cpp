#include "envmou_keys.hpp"
#include "envmou.hpp"
#include "dbimou.hpp"
#include "../valuemou.hpp"

namespace mdbxmou {

void async_keys::Execute() 
{
    try {
        // стартуем транзакцию
        auto txn = start_transaction();
        for (auto& req : query_) 
            do_keys(txn, {req.id}, req);

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
    for (std::uint32_t j = 0; j < param.size(); ++j) {
        const auto& item = param[j];
        Napi::Value key_value;
        if (key_mode.val & key_mode::ordinal) {
            if (key_flag.val & base_flag::number) {
                key_value = Napi::Number::New(env, static_cast<double>(item.id_buf));
            } else {
                key_value = Napi::BigInt::New(env, item.id_buf);
            }
        } else {
            if (key_flag.val & base_flag::string) {
                key_value = Napi::String::New(env, item.key_buf.data(), item.key_buf.size());
            } else {
                key_value = Napi::Buffer<char>::Copy(env, item.key_buf.data(), item.key_buf.size());
            }
        }
        js_arr.Set(j, key_value);
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
    for (std::uint32_t i = 0; i < query_.size(); ++i) {
        Napi::Object js_row = Napi::Object::New(env);
        const auto& row = query_[i];
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
    if (!arg0.has_from_key) {
        // Обычный режим - получаем все ключи
        auto stat = dbimou::get_stat(txn, dbi);
        item.reserve(stat.ms_entries);
        
        // Используем batch версию для лучшей производительности
        do_keys_batch(txn, dbi, arg0);
    } else {
        do_keys_from(txn, dbi, arg0);
    }
}

// Batch версия - читает ключи блоками через cursormou_managed::get_batch
void async_keys::do_keys_batch(txnmou_managed& txn, 
    mdbx::map_handle dbi, keys_line& arg0)
{
    auto& item = arg0.item;
    const bool is_ordinal = mdbx::is_ordinal(arg0.key_mod);
    
    auto cursor = dbi::get_cursor(txn, dbi);

    // Буфер для batch - MDBXMOU_BATCH_LIMIT/2 пар (key, value)
#ifndef MDBXMOU_BATCH_LIMIT
#define MDBXMOU_BATCH_LIMIT 512
#endif
    std::array<mdbx::slice, MDBXMOU_BATCH_LIMIT> pairs;

    // Первый вызов с MDBX_FIRST
    size_t count = cursor.get_batch(pairs, MDBX_FIRST);
    
    while (count > 0) {
        // pairs[0] = key1, pairs[1] = value1, pairs[2] = key2, ...
        for (size_t i = 0; i < count; i += 2) {
            keymou key{pairs[i]};
            async_key key_item{};
            if (is_ordinal) {
                key_item.id_buf = key.as_uint64();
            } else {
                // Ключ - строка/буфер
                key_item.key_buf.assign(key.char_ptr(), key.end_char_ptr());
            }
            item.push_back(std::move(key_item));
        }
        
        // Следующий batch
        count = cursor.get_batch(pairs, MDBX_NEXT);
    }
}

void async_keys::do_keys_from(txnmou_managed& txn, 
    mdbx::map_handle dbi, keys_line& arg0)
{
    // сыллка на массив результатов
    auto& item = arg0.item;
    std::size_t count = 0;
    using move_operation = mdbx::cursor::move_operation;

    auto cursor = txn.open_cursor(dbi);

    keymou from_key = mdbx::is_ordinal(arg0.key_mod) ?
        keymou{arg0.id_buf} : 
        keymou{mdbx::slice{arg0.key_buf.data(), arg0.key_buf.size()}};

    // Определяем направление сканирования
    auto turn_mode = move_operation::next;
    auto cursor_mode = arg0.cursor_mode;
    switch (cursor_mode) {
        case move_operation::key_lesser_than:
        case move_operation::key_lesser_or_equal:
        case move_operation::multi_exactkey_value_lesser_than:
        case move_operation::multi_exactkey_value_lesser_or_equal:
            turn_mode = move_operation::previous;
            break;
        case move_operation::key_equal:
        case move_operation::multi_exactkey_value_equal:
            turn_mode = move_operation::next;
            break;
        default:
            turn_mode = move_operation::next;
            break;
    }

    bool is_key_equal_mode = (cursor_mode == move_operation::key_equal || 
        cursor_mode == move_operation::multi_exactkey_value_equal);    

    std::size_t index{};
    if (mdbx::is_ordinal(arg0.key_mod)) {
        // Создаем ключ для позиционирования
        cursor.scan_from([&](const mdbx::pair& f) {
            if (index >= arg0.limit) {
                return true; // останавливаем сканирование
            }
            
            keymou key{f.key};
            if (is_key_equal_mode) {
                if (arg0.id_buf != key.as_int64()) {
                    return true; // останавливаем сканирование
                }
            }
            
            async_key rc{};
            rc.id_buf = key.as_uint64();
            item.push_back(std::move(rc));
            index++;                            
            return false; // продолжаем сканирование
        }, from_key, arg0.cursor_mode, turn_mode);
    } else {
        // Создаем ключ для позиционирования
        cursor.scan_from([&](const mdbx::pair& f) {
            if (index >= arg0.limit) {
                return true; // останавливаем сканирование
            }
            
            keymou key{f.key};
            if (is_key_equal_mode) {
                if (from_key != key) {
                    return true; // останавливаем сканирование
                }
            }
            
            async_key rc{};
            rc.id_buf = key.as_uint64();
            item.push_back(std::move(rc));
            index++;                            
            return false; // продолжаем сканирование
        }, from_key, arg0.cursor_mode, turn_mode);
    }
}

} // namespace mdbxmou

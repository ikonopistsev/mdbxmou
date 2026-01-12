#pragma once

#include "valuemou.hpp"
#include <memory>

namespace mdbxmou {

class dbi
{
protected:
    MDBX_dbi id_{};
    
public:
    dbi() = default;

    void attach(MDBX_dbi id) noexcept {
        id_ = id;
    }

    static MDBX_stat get_stat(const MDBX_txn* txn, MDBX_dbi dbi);

    MDBX_stat get_stat(const MDBX_txn* txn) const
    {
        return get_stat(txn, id_);
    }

    valuemou get(const MDBX_txn* txn, const keymou& key) const;

    bool has(const MDBX_txn* txn, const keymou& key) const
    {
        return !get(txn, key).is_null();
    }

    void put(MDBX_txn* txn, const keymou& key, valuemou& value, 
        MDBX_put_flags_t flags = MDBX_UPSERT);

    bool del(MDBX_txn* txn, const keymou& key);

    cursormou_managed open_cursor(MDBX_txn* txn) const;
    
    // Static version for map_handle
    static cursormou_managed get_cursor(MDBX_txn* txn, mdbx::map_handle dbi);

    // Drop database or delete it
    void drop(MDBX_txn* txn, bool delete_db = false);
};

} // namespace mdbxmou

#include "dbi.hpp"

namespace mdbxmou {

MDBX_stat dbi::get_stat(const MDBX_txn* txn, MDBX_dbi dbi)
{
    MDBX_stat stat;
    auto rc = mdbx_dbi_stat(txn, dbi, &stat, sizeof(stat));
    if (rc != MDBX_SUCCESS) {
        throw std::runtime_error(mdbx_strerror(rc));
    }
    return stat;
}

valuemou dbi::get(const MDBX_txn* txn, const keymou& key) const
{
    valuemou val{};
    auto rc = mdbx_get(txn, id_, key, val);
    if (rc == MDBX_NOTFOUND)
        return {};
    if (rc != MDBX_SUCCESS) {
        throw std::runtime_error(mdbx_strerror(rc));
    }
    return val;
}

void dbi::put(MDBX_txn* txn, const keymou& key, valuemou& value, MDBX_put_flags_t flags)
{
    auto rc = mdbx_put(txn, id_, key, value, flags);
    if (rc != MDBX_SUCCESS) {
        throw std::runtime_error(mdbx_strerror(rc));
    }
}

bool dbi::del(MDBX_txn* txn, const keymou& key)
{
    auto rc = mdbx_del(txn, id_, key, nullptr);
    if (rc == MDBX_NOTFOUND) {
        return false;
    }
    if (rc != MDBX_SUCCESS) {
        throw std::runtime_error(mdbx_strerror(rc));
    }
    return true;
}


cursormou_managed dbi::open_cursor(MDBX_txn* txn) const
{
    return open_cursor(txn, mdbx::map_handle{id_});
}

cursormou_managed dbi::open_cursor(MDBX_txn *txn, mdbx::map_handle dbi)
{
    MDBX_cursor* cursor_ptr;
    auto rc = mdbx_cursor_open(txn, dbi.dbi, &cursor_ptr);
    if (rc != MDBX_SUCCESS) {
        mdbx::error::throw_exception(rc);
    }
    return cursormou_managed{ cursor_ptr };
}

void dbi::drop(MDBX_txn* txn, bool delete_db)
{
    auto rc = mdbx_drop(txn, id_, delete_db);
    if (rc != MDBX_SUCCESS) {
        throw std::runtime_error(mdbx_strerror(rc));
    }
}

} // namespace mdbxmou
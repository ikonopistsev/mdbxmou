#include "envmou_query.hpp"
#include "convmou.hpp"
#include "envmou.hpp"
#include <cstring>
#include <utility>
#if defined(MDBXMOU_COPY_TESTING)
#include "copy_test.hpp"
#endif

namespace mdbxmou {

static const buffer_type& source_bytes(
	const query_request& query, const query_reference& source)
{
	const auto& result = query[source.row].item[source.item];
	if (!result.found) {
		throw std::runtime_error("query operand missing");
	}
	return result.val_buf;
}

static std::uint64_t ordinal_bytes(const buffer_type& bytes)
{
	if (bytes.size() == sizeof(std::uint32_t)) {
		std::uint32_t value;
		std::memcpy(&value, bytes.data(), sizeof(value));
		return value;
	}
	if (bytes.size() == sizeof(std::uint64_t)) {
		std::uint64_t value;
		std::memcpy(&value, bytes.data(), sizeof(value));
		return value;
	}
	throw std::runtime_error("query operand width must be 4 or 8 bytes");
}

static keymou resolve_key(
	const query_request& query, const query_line& row, async_keyval& item)
{
	if (item.key_source.active()) {
		const auto& bytes = source_bytes(query, item.key_source);
		if (mdbx::is_ordinal(row.key_mod)) {
			item.id_buf = ordinal_bytes(bytes);
		}
		return keymou{bytes};
	}
	return mdbx::is_ordinal(row.key_mod) ? keymou{item.id_buf}
										 : keymou{item.key_buf};
}

static valuemou resolve_value(
	const query_request& query, const query_line& row, async_keyval& item)
{
	if (item.value_source.active()) {
		const auto& bytes = source_bytes(query, item.value_source);
		if (is_ordinal(row.val_mod)) {
			item.val_num = ordinal_bytes(bytes);
		}
		return valuemou{bytes};
	}
	return is_ordinal(row.val_mod) ? valuemou{item.val_num}
								   : valuemou{item.val_buf};
}

async_query::async_query(const Napi::Object& receiver,
	envmou& owner,
	txn_mode txn_mode,
	query_request query,
	bool single)
	: Napi::AsyncWorker(receiver.Env())
	, deferred_(Napi::Promise::Deferred::New(receiver.Env()))
	, txn_mode_(txn_mode)
	, query_(std::move(query))
	, single_(single)
{
	Receiver().Reset(receiver, 1);
	++owner;
	env_ = &owner;
}

async_query::~async_query()
{
	finish();
}

void async_query::finish() noexcept
{
	if (auto* owner = std::exchange(env_, nullptr)) {
		--(*owner);
	}
}

void async_query::OnWorkComplete(Napi::Env env, napi_status status)
{
	finish();
	try {
		Napi::AsyncWorker::OnWorkComplete(env, status);
	} catch (const Napi::Error&) {
		// Base Destroy is last in the pinned SDK; an escaped error precedes it.
		Destroy();
	}
}

void async_query::Execute()
{
#if defined(MDBXMOU_COPY_TESTING)
	if (copy_test_native_error()) {
		SetError("injected native error");
		return;
	}
#endif
	try {
		// стартуем транзакцию
		auto txn = start_transaction();
		for (auto& req : query_) {
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

static Napi::Value reference_ordinal(
	Napi::Env env, std::uint64_t value, base_flag flags)
{
	return (flags & base_flag::bigint)
		? Napi::Value{Napi::BigInt::New(env, value)}
		: Napi::Value{Napi::Number::New(env, static_cast<double>(value))};
}

static Napi::Value write_row(
	Napi::Env env, const query_request& query, const query_line& row)
{
	auto& param = row.item;
	auto mode = row.mode;
	convmou conv{row.key_mod, row.val_mod, row.key_flag, row.value_flag};
	auto js_arr = Napi::Array::New(env, param.size());
	for (std::size_t j = 0; j < param.size(); ++j) {
		const auto& item = param[j];
		Napi::Object js_item = Napi::Object::New(env);
		auto key = mdbx::is_ordinal(row.key_mod) ? keymou{item.id_buf}
			: item.key_source.active()
			? keymou{source_bytes(query, item.key_source)}
			: keymou{item.key_buf};
		js_item.Set("key",
			item.key_source.active() && mdbx::is_ordinal(row.key_mod)
				? reference_ordinal(env, item.id_buf, row.key_flag)
				: conv.convert_key(env, key));

		if (mode.is_get() || mode.is_write()) {
			const auto& val_buf = mode.is_write() && item.value_source.active()
				? source_bytes(query, item.value_source)
				: item.val_buf;
			if (is_ordinal(row.val_mod) &&
				(mode.is_write() || !val_buf.empty())) {
				js_item.Set("value",
					mode.is_write() && item.value_source.active()
						? reference_ordinal(env, item.val_num, row.value_flag)
						: conv.convert_value(env, valuemou{item.val_num}));
			} else if (val_buf.empty()) {
				js_item.Set("value", env.Null());
			} else {
				js_item.Set(
					"value", conv.convert_value(env, valuemou{val_buf}));
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
	finish();

	Napi::Env env = Env();

	if (single_) {
		if (query_.size() == 1) {
			const auto& row = query_[0];
			deferred_.Resolve(!row.return_result ? env.Undefined()
												 : write_row(env, query_, row));
			return;
		}
	}

	Napi::Array result = Napi::Array::New(env, query_.size());
	for (std::size_t i = 0; i < query_.size(); ++i) {
		const auto& row = query_[i];
		result.Set(static_cast<uint32_t>(i),
			!row.return_result ? env.Undefined() : write_row(env, query_, row));
	}

	deferred_.Resolve(result);
}

void async_query::OnError(const Napi::Error& e)
{
	finish();

	deferred_.Reject(e.Value());
}

txnmou_managed async_query::start_transaction()
{
	MDBX_txn* ptr;
	mdbx::error::success_or_throw(
		::mdbx_txn_begin(*env_, nullptr, txn_mode_, &ptr));
	return {ptr};
}

void async_query::do_del(
	txnmou_managed& txn, mdbx::map_handle dbi, query_line& arg0)
{
	for (auto& q : arg0.item) {
		auto key = resolve_key(query_, arg0, q);
		q.found = txn.erase(dbi, key);
	}
}

void async_query::do_get(
	const txnmou_managed& txn, mdbx::map_handle dbi, query_line& arg0)
{
	for (auto& q : arg0.item) {
		auto key = resolve_key(query_, arg0, q);
		valuemou value;
		const auto rc = ::mdbx_get(txn, dbi, &key, &value);
		q.found = rc != MDBX_NOTFOUND;
		if (!q.found) {
			q.val_buf.clear();
			continue;
		}
		mdbx::error::success_or_throw(rc);
		// No retained bytes for a suppressed read which no later operand uses.
		// A retained image must own its bytes before any subsequent MDBX update.
		if (!arg0.return_result && !q.referenced) {
			continue;
		}
		q.set(value);
		// Validate numerical output while abort is still possible, before commit.
		if (is_ordinal(arg0.val_mod) && !q.val_buf.empty()) {
			q.val_num = ordinal_bytes(q.val_buf);
		}
	}
}

void async_query::do_put(
	txnmou_managed& txn, mdbx::map_handle dbi, query_line& arg0)
{
	auto flags = static_cast<MDBX_put_flags_t>(
		arg0.mode.write_flags() | arg0.put_flags.val);
	// очищаем put флаги
	for (auto& q : arg0.item) {
		auto key = resolve_key(query_, arg0, q);
		auto val = resolve_value(query_, arg0, q);
		mdbx::error::success_or_throw(txn.put(dbi, key, &val, flags));
	}
}

}  // namespace mdbxmou

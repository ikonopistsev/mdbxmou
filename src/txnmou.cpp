#include "txnmou.hpp"
#include "addon_state.hpp"
#include "envmou.hpp"
#include "cursormou.hpp"
#include <exception>
#include <new>

#if NAPI_VERSION != 8
#error "mdbxmou requires N-API v8"
#endif

#if defined(NAPI_EXPERIMENTAL)
#error "mdbxmou Stage 1 does not support experimental N-API"
#endif

namespace mdbxmou {

static_assert(Napi::details::HasExtendedFinalizer<txnmou>::value,
	"txnmou must use the extended N-API finalizer");

const napi_type_tag txnmou::type_tag_{
	0xd4f5b982e8a7419aULL,
	0x9c63f1472e0db5c4ULL,
};

bool txnmou::is_instance(const Napi::Value& value) noexcept
{
	if (!value.IsObject()) {
		return false;
	}

	bool matches{};
	return napi_check_object_type_tag(
			   value.Env(), value, &type_tag_, &matches) == napi_ok &&
		matches;
}

txnmou* txnmou::unwrap_checked(
	const Napi::Env& env, const Napi::Value& value, const char* method_name)
{
	if (!is_instance(value)) {
		throw Napi::TypeError::New(env,
			std::string(method_name) + ": argument must be MDBX_Txn instance");
	}

	void* wrapper{};
	if (napi_unwrap(env, value, &wrapper) != napi_ok || !wrapper) {
		throw Napi::TypeError::New(env,
			std::string(method_name) + ": argument must be MDBX_Txn instance");
	}
	return static_cast<txnmou*>(wrapper);
}

txnmou::~txnmou() noexcept
{
	assert(!txn_);
	assert(env_ref_.IsEmpty());
	assert(issued_views_.empty());
}

Napi::Function txnmou::init(const char* class_name, Napi::Env env)
{
	auto func = DefineClass(env,
		class_name,
		{
			InstanceMethod("commit", &txnmou::commit),
			InstanceMethod(
				"commitAndStartRead", &txnmou::commit_and_start_read),
			InstanceMethod("abort", &txnmou::abort),
			InstanceMethod("openMap", &txnmou::open_map),
			InstanceMethod("createMap", &txnmou::create_map),
			InstanceMethod("openCursor", &txnmou::open_cursor),
			InstanceMethod("isActive", &txnmou::is_active_js),
#if defined(MDBXMOU_TESTING)
			InstanceMethod("_debugIssueView", &txnmou::debug_issue_view),
			InstanceMethod("_debugViewStats", &txnmou::debug_view_stats),
			InstanceMethod("_debugPruneViews", &txnmou::debug_prune_views),
			InstanceMethod(
				"_debugFailNextDetach", &txnmou::debug_fail_next_detach),
#endif
		});

	return func;
}

Napi::Value txnmou::commit(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (!is_active()) {
		throw Napi::Error::New(env, "txn already completed");
	}

	if (cursor_count_ > 0) {
		std::string message{"txn commit: "};
		message += std::to_string(cursor_count_);
		message += " cursor(s) still open";
		throw Napi::Error::New(env, message);
	}

	detach_issued_or_throw(env);
	auto* owner = get_environment(env);
	if (!owner) {
		throw Napi::Error::New(env, "txn environment owner unavailable");
	}
	const auto rc = complete_native(completion_kind::commit, *owner);
	if (rc != MDBX_SUCCESS) {
		throw Napi::Error::New(
			env, std::string("txn commit: ") + mdbx_strerror(rc));
	}

	return env.Undefined();
}

Napi::Value txnmou::commit_and_start_read(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (!is_active()) {
		throw Napi::Error::New(env, "txn already completed");
	}
	if (is_readonly()) {
		throw Napi::TypeError::New(env, "write transaction required");
	}
	if (cursor_count_ > 0) {
		std::string message{"txn commitAndStartRead: "};
		message += std::to_string(cursor_count_);
		message += " cursor(s) still open";
		throw Napi::Error::New(env, message);
	}

	detach_issued_or_throw(env);
	auto* owner = get_environment(env);
	if (!owner) {
		throw Napi::Error::New(env, "txn environment owner unavailable");
	}

	// MDBXMOU-0006-COMMIT-READ: libmdbx may replace or clear this handle.
	auto* native_txn = txn_.release();
	const auto rc = mdbx_txn_commit_embark_read(&native_txn, nullptr);
	if (native_txn) {
		txn_.reset(native_txn);
	}

	if (rc == MDBX_SUCCESS && native_txn) {
		mode_ = {txn_mode::ro};
		return env.Undefined();
	}

	if (!native_txn) {
		release_environment(owner);
	}
	if (rc == MDBX_SUCCESS) {
		throw Napi::Error::New(
			env, "txn commitAndStartRead: native returned no read transaction");
	}

	std::string message{"txn commitAndStartRead: "};
	message += mdbx_strerror(rc);
	throw Napi::Error::New(env, message);
}

Napi::Value txnmou::abort(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (!is_active()) {
		throw Napi::Error::New(env, "txn already completed");
	}

	if (cursor_count_ > 0) {
		std::string message{"txn abort: "};
		message += std::to_string(cursor_count_);
		message += " cursor(s) still open";
		throw Napi::Error::New(env, message);
	}

	detach_issued_or_throw(env);
	auto* owner = get_environment(env);
	if (!owner) {
		throw Napi::Error::New(env, "txn environment owner unavailable");
	}
	const auto rc = complete_native(completion_kind::abort, *owner);
	if (rc != MDBX_SUCCESS) {
		throw Napi::Error::New(
			env, std::string("txn abort: ") + mdbx_strerror(rc));
	}

	return env.Undefined();
}

envmou* txnmou::get_environment(napi_env env) const noexcept
{
	if (env_ref_.IsEmpty()) {
		return nullptr;
	}

	napi_value env_value{};
	if (napi_get_reference_value(env, env_ref_, &env_value) != napi_ok ||
		!env_value) {
		return nullptr;
	}

	void* owner{};
	if (napi_unwrap(env, env_value, &owner) != napi_ok) {
		return nullptr;
	}

	return static_cast<envmou*>(owner);
}

int txnmou::complete_native(completion_kind kind, envmou& env) noexcept
{
	assert(txn_);

	auto* txn = txn_.release();
	const auto rc = kind == completion_kind::commit ? mdbx_txn_commit(txn)
													: mdbx_txn_abort(txn);

	if (rc == MDBX_THREAD_MISMATCH) {
		txn_.reset(txn);
		return rc;
	}

	release_environment(&env);
	return rc;
}

void txnmou::release_environment(envmou* env) noexcept
{
	if (env) {
		--(*env);
	}

	Napi::ObjectReference env_ref{std::move(env_ref_)};
}

void txnmou::Finalize(Napi::Env env)
{
	auto* owner = get_environment(env);
	detach_issued_noexcept(env);

	if (txn_) {
		auto* txn = txn_.release();
		const auto rc = mdbx_txn_abort(txn);
		if (rc == MDBX_THREAD_MISMATCH) {
			txn_.reset(txn);
			// A finalizer cannot be retried. Continuing would release the environment
			// while MDBX still owns a live transaction on another thread.
			Napi::Error::Fatal("mdbxmou::txnmou::Finalize",
				"MDBX_THREAD_MISMATCH while aborting a finalized transaction");
		}
	}

	release_environment(owner);
}

Napi::Value txnmou::issue_view(napi_env env,
	const mdbx::slice& value,
	bool tracked,
	view_issue_fault fault)
{
	auto result = make_external_value_view(env, value, fault);
	if (tracked && result.borrowed) {
		track_view(env, result.array_buffer, fault);
	}
	return Napi::Value(env, result.data_view);
}

Napi::Value txnmou::issue_borrowed_view(napi_env env, const mdbx::slice& value)
{
	return issue_view(env, value, track_borrowed_views_);
}

void txnmou::track_view(
	napi_env env, napi_value array_buffer, view_issue_fault fault)
{
	maybe_prune_dead_views(env);

	napi_ref ref{};
	if (napi_create_reference(env, array_buffer, 0, &ref) != napi_ok) {
		detach_pending_external_view(
			env, array_buffer, "mdbxmou::txnmou::track_view");
		throw Napi::Error::New(
			env, "failed to create MDBX borrowed ArrayBuffer reference");
	}

	const auto rollback = [&]() noexcept {
		detach_pending_external_view(
			env, array_buffer, "mdbxmou::txnmou::track_view");
		// Once detached, a reference cleanup failure can leak bookkeeping but
		// cannot expose MDBX memory through the unpublished ArrayBuffer.
		(void)napi_delete_reference(env, ref);
	};

	try {
		if (fault == view_issue_fault::after_reference) {
			throw Napi::Error::New(
				env, "debug fault after weak reference creation");
		}
		if (fault == view_issue_fault::registry_push) {
			throw std::bad_alloc{};
		}
		issued_views_.push_back({ref});
	} catch (const std::bad_alloc&) {
		rollback();
		throw Napi::Error::New(
			env, "failed to store MDBX borrowed ArrayBuffer reference");
	} catch (...) {
		rollback();
		throw;
	}
}

txnmou::detach_result txnmou::detach_issued(napi_env env) noexcept
{
	std::size_t write_index{};
	detach_result result{};

	for (const auto item : issued_views_) {
		bool keep{};
		napi_value array_buffer{};

#if defined(MDBXMOU_TESTING)
		const auto fail_get = consume_detach_fault(detach_fault::get_reference);
#else
		constexpr bool fail_get{false};
#endif
		if (fail_get ||
			napi_get_reference_value(
				env, item.array_buffer_ref, &array_buffer) != napi_ok) {
			keep = true;
			result.buffers_safe = false;
		}

		if (!keep && array_buffer) {
			bool detached{};
#if defined(MDBXMOU_TESTING)
			const auto fail_is =
				consume_detach_fault(detach_fault::is_detached);
#else
			constexpr bool fail_is{false};
#endif
			if (fail_is ||
				napi_is_detached_arraybuffer(env, array_buffer, &detached) !=
					napi_ok) {
				keep = true;
				result.buffers_safe = false;
			}

			if (!keep && !detached) {
#if defined(MDBXMOU_TESTING)
				const auto fail_detach =
					consume_detach_fault(detach_fault::detach);
#else
				constexpr bool fail_detach{false};
#endif
				auto detach_status = napi_ok;
				if (!fail_detach) {
#if defined(MDBXMOU_TESTING)
					++detach_calls_;
#endif
					detach_status = napi_detach_arraybuffer(env, array_buffer);
				}
				if (fail_detach || detach_status != napi_ok) {
					keep = true;
					result.buffers_safe = false;
				}
			}
		}

		if (!keep) {
#if defined(MDBXMOU_TESTING)
			const auto fail_delete =
				consume_detach_fault(detach_fault::delete_reference);
#else
			constexpr bool fail_delete{false};
#endif
			if (fail_delete ||
				napi_delete_reference(env, item.array_buffer_ref) != napi_ok) {
				keep = true;
			}
		}

		if (keep) {
			result.references_released = false;
			issued_views_[write_index++] = item;
		}
	}

	issued_views_.resize(write_index);
	update_prune_threshold();
	return result;
}

void txnmou::detach_issued_or_throw(napi_env env)
{
	const auto result = detach_issued(env);
	if (!result.buffers_safe || !result.references_released) {
		throw Napi::Error::New(env, "failed to detach MDBX borrowed views");
	}
}

void txnmou::detach_issued_noexcept(napi_env env) noexcept
{
	const auto result = detach_issued(env);
	if (!result.buffers_safe) {
		// Snapshot teardown cannot continue until every registered external buffer
		// is detached; otherwise JavaScript retains pointers to unmapped memory.
		Napi::Error::Fatal("mdbxmou::txnmou::detach_issued_noexcept",
			"borrowed views remain attached during transaction finalization");
	}

	if (!result.references_released) {
		// Every remaining target is dead or detached. Finalization cannot be
		// retried, so release refs best-effort and let environment teardown reclaim
		// any Node-API bookkeeping that still cannot be deleted.
		for (const auto item : issued_views_) {
			(void)napi_delete_reference(env, item.array_buffer_ref);
		}
		issued_views_.clear();
		update_prune_threshold();
	}
}

void txnmou::maybe_prune_dead_views(napi_env env) noexcept
{
	if (issued_views_.size() >= next_prune_at_) {
		prune_dead_views(env);
	}
}

void txnmou::prune_dead_views(napi_env env) noexcept
{
	std::size_t write_index{};
	std::size_t removed{};

	for (const auto item : issued_views_) {
		napi_value array_buffer{};
		const auto get_status =
			napi_get_reference_value(env, item.array_buffer_ref, &array_buffer);
		const auto dead = get_status == napi_ok && !array_buffer;
		const auto deleted = dead &&
			napi_delete_reference(env, item.array_buffer_ref) == napi_ok;

		if (deleted) {
			++removed;
		} else {
			issued_views_[write_index++] = item;
		}
	}

	issued_views_.resize(write_index);
#if defined(MDBXMOU_TESTING)
	++prune_runs_;
	pruned_refs_ += removed;
#else
	(void)removed;
#endif
	update_prune_threshold();
}

void txnmou::update_prune_threshold() noexcept
{
	const auto size = issued_views_.size();
	if (size < initial_prune_threshold) {
		next_prune_at_ = initial_prune_threshold;
	} else if (size > std::numeric_limits<std::size_t>::max() / 2) {
		next_prune_at_ = std::numeric_limits<std::size_t>::max();
	} else {
		next_prune_at_ = size * 2;
	}
}

Napi::Value txnmou::get_dbi(const char* name,
	base_flag key_flag,
	base_flag value_flag,
	key_mode key_mode,
	value_mode value_mode,
	db_mode db_mode,
	int db_flags_override)
{
	Napi::Env env = Env();

	if (!is_active()) {
		throw Napi::Error::New(env, "txn already completed");
	}

	if (is_readonly() && (db_mode.val & db_mode::create)) {
		throw Napi::Error::New(
			env, "dbi: cannot open DB in read-only transaction");
	}

	MDBX_dbi dbi{};
	auto flags = db_flags_override >= 0
		? static_cast<MDBX_db_flags_t>(db_flags_override)
		: static_cast<MDBX_db_flags_t>(
			  db_mode.val | key_mode.val | value_mode.val);
	auto rc =
		mdbx_dbi_open(*this, (name && name[0]) ? name : nullptr, flags, &dbi);
	if (rc != MDBX_SUCCESS) {
		throw Napi::Error::New(
			env, std::string("mdbx_dbi_open: ") + mdbx_strerror(rc));
	}
	// создаем новый объект dbi
	auto obj = addon_state::get(env).new_dbi();
	auto ptr = dbimou::Unwrap(obj);
	ptr->attach(dbi, db_mode, key_mode, value_mode, key_flag, value_flag);
	return obj;
}

Napi::Value txnmou::get_dbi(const Napi::Object& arg0, db_mode db_mode)
{
	auto env = arg0.Env();
	if (!is_active()) {
		throw Napi::Error::New(env, "txn already completed");
	}

	auto* owner = get_environment(env);
	if (!owner) {
		throw Napi::Error::New(env, "txn environment owner unavailable");
	}

	auto conf = get_env_userctx(*owner);
	// параметры по умолчанию из окружения
	auto key_flag = conf->key_flag;
	auto value_flag = conf->value_flag;
	key_mode key_mode{};
	value_mode value_mode{};
	std::string db_name{};
	int db_flags_override = -1;

	if (arg0.Has("name")) {
		auto value = arg0.Get("name");
		if (!value.IsUndefined() && !value.IsNull()) {
			if (!value.IsString()) {
				throw Napi::Error::New(env, "dbi: name must be string");
			}
			db_name = value.As<Napi::String>().Utf8Value();
		}
	}

	if (arg0.Has("keyFlag")) {
		auto value = arg0.Get("keyFlag");
		if (!value.IsUndefined() && !value.IsNull()) {
			key_flag = base_flag::parse_key(value);
		}
	}

	if (arg0.Has("valueFlag")) {
		auto value = arg0.Get("valueFlag");
		if (!value.IsUndefined() && !value.IsNull()) {
			value_flag = base_flag::parse_value(value);
		}
	}

	if (arg0.Has("keyMode")) {
		auto value = arg0.Get("keyMode");
		if (!value.IsUndefined() && !value.IsNull()) {
			key_mode = parse_key_mode(env, value, key_flag);
		}
	}

	if (arg0.Has("valueMode")) {
		auto value = arg0.Get("valueMode");
		if (!value.IsUndefined() && !value.IsNull()) {
			value_mode = parse_value_mode(value, value_flag);
		}
	}

	if (arg0.Has("flags")) {
		auto value = arg0.Get("flags");
		if (!value.IsUndefined() && !value.IsNull()) {
			db_flags_override = value.As<Napi::Number>().Int32Value();
		}
	}

	if (arg0.Has("create")) {
		auto value = arg0.Get("create");
		if (!value.IsUndefined() && !value.IsNull() &&
			value.ToBoolean().Value()) {
			db_mode.val |= db_mode::create;
		}
	}

	return get_dbi(db_name.empty() ? nullptr : db_name.c_str(),
		key_flag,
		value_flag,
		key_mode,
		value_mode,
		db_mode,
		db_flags_override);
}

Napi::Value txnmou::get_dbi(const Napi::CallbackInfo& info, db_mode db_mode)
{
	Napi::Env env = info.Env();

	if (!is_active()) {
		throw Napi::Error::New(env, "txn already completed");
	}

	auto* owner = get_environment(env);
	if (!owner) {
		throw Napi::Error::New(env, "txn environment owner unavailable");
	}

	auto conf = get_env_userctx(*owner);
	auto key_flag = conf->key_flag;
	auto value_flag = conf->value_flag;
	key_mode key_mode{};
	value_mode value_mode{};
	std::string db_name{};
	auto arg_count = info.Length();

	if (arg_count == 1 && info[0].IsObject()) {
		return get_dbi(info[0].As<Napi::Object>(), db_mode);
	}

	if (arg_count == 3) {
		auto arg0 = info[0];  // db_name
		auto arg1 = info[1];  // key_mode
		auto arg2 = info[2];  // value_mode
		db_name = arg0.As<Napi::String>().Utf8Value();
		key_mode = parse_key_mode(env, arg1, key_flag);
		value_mode = parse_value_mode(arg2, value_flag);
	} else if (arg_count == 2) {
		// db_name + key_mode || key_mode + value_mode
		auto arg0 = info[0];
		auto arg1 = info[1];
		if (arg0.IsString()) {
			db_name = arg0.As<Napi::String>().Utf8Value();
			key_mode = parse_key_mode(env, arg1, key_flag);
		} else {
			key_mode = parse_key_mode(env, arg0, key_flag);
			value_mode = parse_value_mode(arg1, value_flag);
		}
	} else if (arg_count == 1) {
		// db_name || key_mode
		auto arg0 = info[0];
		if (arg0.IsString()) {
			db_name = arg0.As<Napi::String>().Utf8Value();
		} else {
			key_mode = parse_key_mode(env, arg0, key_flag);
		}
	}
	// arg_count == 0: значения по умолчанию (key/value = buffer, если env не задавал флаги)

	return get_dbi(db_name.empty() ? nullptr : db_name.c_str(),
		key_flag,
		value_flag,
		key_mode,
		value_mode,
		db_mode);
}

Napi::Value txnmou::open_cursor(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (!is_active()) {
		throw Napi::Error::New(env, "txn not active");
	}

	if (info.Length() < 1 || !info[0].IsObject()) {
		throw Napi::Error::New(env, "dbi required");
	}

	auto arg0 = info[0].As<Napi::Object>();
	auto* dbi = dbimou::unwrap_checked(env, arg0, "openCursor");

	MDBX_cursor* cursor{};
	auto rc = mdbx_cursor_open(txn_.get(), dbi->get_id(), &cursor);
	if (rc != MDBX_SUCCESS) {
		throw Napi::Error::New(
			env, std::string("mdbx_cursor_open: ") + mdbx_strerror(rc));
	}

	try {
		auto obj = addon_state::get(env).new_cursor();
		auto ptr = cursormou::Unwrap(obj);
		ptr->attach(info.This().As<Napi::Object>(), arg0, cursor);
		cursor = nullptr;
		return obj;
	} catch (...) {
		if (cursor) {
			mdbx_cursor_close(cursor);
		}
		throw;
	}
}

Napi::Value txnmou::is_active_js(const Napi::CallbackInfo& info)
{
	return Napi::Boolean::New(info.Env(), is_active());
}

#if defined(MDBXMOU_TESTING)
bool txnmou::consume_detach_fault(detach_fault fault) noexcept
{
	if (next_detach_fault_ != fault) {
		return false;
	}
	next_detach_fault_ = detach_fault::none;
	return true;
}

Napi::Value txnmou::debug_issue_view(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();
	try {
		if (!is_active()) {
			throw Napi::Error::New(
				env, "debugIssueView: txn already completed");
		}
		if (!is_readonly()) {
			throw Napi::Error::New(
				env, "debugIssueView: read-only transaction required");
		}
		if (info.Length() < 2 || !info[0].IsObject()) {
			throw Napi::TypeError::New(
				env, "debugIssueView: dbi and key required");
		}

		auto dbi_object = info[0].As<Napi::Object>();
		auto* dbi_wrapper =
			dbimou::unwrap_checked(env, dbi_object, "debugIssueView");

		bool tracked{true};
		view_issue_fault fault{view_issue_fault::none};
		if (info.Length() > 2 && !info[2].IsUndefined()) {
			if (!info[2].IsObject()) {
				throw Napi::TypeError::New(
					env, "debugIssueView: options must be an object");
			}
			auto options = info[2].As<Napi::Object>();
			if (options.Has("tracked")) {
				auto value = options.Get("tracked");
				if (!value.IsBoolean()) {
					throw Napi::TypeError::New(
						env, "debugIssueView: tracked must be a boolean");
				}
				tracked = value.As<Napi::Boolean>().Value();
			}
			if (options.Has("fault")) {
				auto value = options.Get("fault");
				if (!value.IsString()) {
					throw Napi::TypeError::New(
						env, "debugIssueView: fault must be a string");
				}
				const auto name = value.As<Napi::String>().Utf8Value();
				if (name == "afterArrayBuffer") {
					fault = view_issue_fault::after_array_buffer;
				} else if (name == "afterDataView") {
					fault = view_issue_fault::after_data_view;
				} else if (name == "afterReference") {
					fault = view_issue_fault::after_reference;
				} else if (name == "registryPush") {
					fault = view_issue_fault::registry_push;
				} else if (name != "none") {
					throw Napi::TypeError::New(
						env, "debugIssueView: unknown fault");
				}
			}
		}

		buffer_type key_buffer{};
		std::uint64_t key_number{};
		const auto key = mdbx::is_ordinal(dbi_wrapper->get_key_mode())
			? keymou::from(info[1], env, key_number)
			: keymou::from(info[1], env, key_buffer);
		const auto& raw_dbi = static_cast<const dbi&>(*dbi_wrapper);
		const auto value = raw_dbi.get(txn_.get(), key);
		if (value.is_null()) {
			return env.Undefined();
		}
		return issue_view(env, value, tracked, fault);
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& error) {
		throw Napi::Error::New(env, error.what());
	} catch (...) {
		throw Napi::Error::New(env, "debugIssueView: native operation failed");
	}
}

Napi::Value txnmou::debug_view_stats(const Napi::CallbackInfo& info)
{
	auto result = Napi::Object::New(info.Env());
	result.Set("issued",
		Napi::Number::New(
			info.Env(), static_cast<double>(issued_views_.size())));
	result.Set("nextPruneAt",
		Napi::Number::New(info.Env(), static_cast<double>(next_prune_at_)));
	result.Set("pruneRuns",
		Napi::Number::New(info.Env(), static_cast<double>(prune_runs_)));
	result.Set("prunedRefs",
		Napi::Number::New(info.Env(), static_cast<double>(pruned_refs_)));
	result.Set("detachCalls",
		Napi::Number::New(info.Env(), static_cast<double>(detach_calls_)));
	return result;
}

Napi::Value txnmou::debug_prune_views(const Napi::CallbackInfo& info)
{
	prune_dead_views(info.Env());
	return debug_view_stats(info);
}

Napi::Value txnmou::debug_fail_next_detach(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();
	if (info.Length() < 1 || !info[0].IsString()) {
		throw Napi::TypeError::New(
			env, "debugFailNextDetach: fault name required");
	}

	const auto name = info[0].As<Napi::String>().Utf8Value();
	if (name == "none") {
		next_detach_fault_ = detach_fault::none;
	} else if (name == "getReference") {
		next_detach_fault_ = detach_fault::get_reference;
	} else if (name == "isDetached") {
		next_detach_fault_ = detach_fault::is_detached;
	} else if (name == "detach") {
		next_detach_fault_ = detach_fault::detach;
	} else if (name == "deleteReference") {
		next_detach_fault_ = detach_fault::delete_reference;
	} else {
		throw Napi::TypeError::New(env, "debugFailNextDetach: unknown fault");
	}
	return env.Undefined();
}
#endif

void txnmou::attach(const Napi::Object& env_object,
	MDBX_txn* txn,
	txn_mode mode,
	bool track_borrowed_views,
	bool writemap)
{
	assert(!txn_);
	assert(env_ref_.IsEmpty());

	auto* env = envmou::Unwrap(env_object);
	assert(env);
	auto env_ref = Napi::Persistent(env_object);
	++(*env);
	env_ref_ = std::move(env_ref);
	mode_ = mode;
	track_borrowed_views_ = track_borrowed_views;
	writemap_ = writemap;
	txn_.reset(txn);
}

}  // namespace mdbxmou

#include "txnmou.hpp"
#include "envmou.hpp"
#include "cursormou.hpp"
#include <exception>

#if NAPI_VERSION != 8
#error "mdbxmou requires N-API v8"
#endif

#if defined(NAPI_EXPERIMENTAL)
#error "mdbxmou Stage 1 does not support experimental N-API"
#endif

namespace mdbxmou {

static_assert(Napi::details::HasExtendedFinalizer<txnmou>::value,
	"txnmou must use the extended N-API finalizer");

Napi::FunctionReference txnmou::ctor{};

bool txnmou::is_instance(const Napi::Value& value) noexcept
{
	return value.IsObject() &&
		value.As<Napi::Object>().InstanceOf(ctor.Value());
}

txnmou* txnmou::unwrap_checked(
	const Napi::Env& env, const Napi::Value& value, const char* method_name)
{
	if (!is_instance(value)) {
		throw Napi::TypeError::New(env,
			std::string(method_name) + ": argument must be MDBX_Txn instance");
	}
	return Napi::ObjectWrap<txnmou>::Unwrap(value.As<Napi::Object>());
}

txnmou::~txnmou() noexcept
{
	assert(!txn_);
	assert(env_ref_.IsEmpty());
	assert(issued_views_.empty());
}

void txnmou::init(const char* class_name, Napi::Env env)
{
	auto func = DefineClass(env,
		class_name,
		{
			InstanceMethod("commit", &txnmou::commit),
			InstanceMethod("abort", &txnmou::abort),
			InstanceMethod("openMap", &txnmou::open_map),
			InstanceMethod("createMap", &txnmou::create_map),
			InstanceMethod("openCursor", &txnmou::open_cursor),
			InstanceMethod("isActive", &txnmou::is_active_js),
		});

	ctor = Napi::Persistent(func);
	ctor.SuppressDestruct();
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

void txnmou::track_view(napi_env, napi_value)
{
	throw std::logic_error("borrowed view tracking is not implemented");
}

void txnmou::detach_issued_or_throw(napi_env)
{
	assert(issued_views_.empty());
}

void txnmou::detach_issued_noexcept(napi_env) noexcept
{
	if (!issued_views_.empty()) {
		// Snapshot teardown cannot continue until every registered external buffer
		// is detached; otherwise JavaScript retains pointers to unmapped memory.
		Napi::Error::Fatal("mdbxmou::txnmou::detach_issued_noexcept",
			"borrowed views remain attached during transaction finalization");
	}
}

void txnmou::prune_dead_views(napi_env) noexcept
{
	assert(issued_views_.empty());
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
	auto obj = dbimou::ctor.New({});
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
	if (!arg0.InstanceOf(dbimou::ctor.Value())) {
		throw Napi::TypeError::New(
			env, "openCursor: first argument must be MDBX_Dbi instance");
	}

	auto dbi = dbimou::Unwrap(arg0);

	MDBX_cursor* cursor{};
	auto rc = mdbx_cursor_open(txn_.get(), dbi->get_id(), &cursor);
	if (rc != MDBX_SUCCESS) {
		throw Napi::Error::New(
			env, std::string("mdbx_cursor_open: ") + mdbx_strerror(rc));
	}

	try {
		auto obj = cursormou::ctor.New({});
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

void txnmou::attach(
	const Napi::Object& env_object, MDBX_txn* txn, txn_mode mode)
{
	assert(!txn_);
	assert(env_ref_.IsEmpty());

	auto* env = envmou::Unwrap(env_object);
	assert(env);
	auto env_ref = Napi::Persistent(env_object);
	++(*env);
	env_ref_ = std::move(env_ref);
	mode_ = mode;
	txn_.reset(txn);
}

}  // namespace mdbxmou

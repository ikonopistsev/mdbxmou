#pragma once

#include "dbimou.hpp"
#include <cassert>
#include <stdexcept>
#include <utility>
#include <vector>

namespace mdbxmou {

class envmou;

class txnmou final : public Napi::ObjectWrap<txnmou>
{
private:
	struct issued_view_ref final {
		napi_ref array_buffer_ref{};
	};

	enum class completion_kind {
		commit,
		abort,
	};

	struct free_txn {
		void operator()(MDBX_txn* txn) const noexcept
		{
			mdbx_txn_abort(txn);
		}
	};

	Napi::ObjectReference env_ref_{};
	std::unique_ptr<MDBX_txn, free_txn> txn_{};
	txn_mode mode_{};
	std::size_t cursor_count_{};
	std::vector<issued_view_ref> issued_views_{};

	envmou* get_environment(napi_env env) const noexcept;
	int complete_native(completion_kind kind, envmou& env) noexcept;
	void release_environment(envmou* env) noexcept;

	void track_view(napi_env env, napi_value array_buffer);
	void detach_issued_or_throw(napi_env env);
	void detach_issued_noexcept(napi_env env) noexcept;
	void prune_dead_views(napi_env env) noexcept;

	Napi::Value get_dbi(const char* name,
		base_flag key_flag,
		base_flag value_flag,
		key_mode key_mode,
		value_mode value_mode,
		db_mode db_mode,
		int db_flags_override = -1);
	Napi::Value get_dbi(const Napi::Object& arg0, db_mode db_mode);
	Napi::Value get_dbi(const Napi::CallbackInfo& info, db_mode db_mode);
	Napi::Value is_active_js(const Napi::CallbackInfo& info);

public:
	static Napi::FunctionReference ctor;
	static bool is_instance(const Napi::Value& value) noexcept;
	static txnmou* unwrap_checked(const Napi::Env& env,
		const Napi::Value& value,
		const char* method_name);

	txnmou(const Napi::CallbackInfo& info)
		: Napi::ObjectWrap<txnmou>(info)
	{
	}

	~txnmou() noexcept override;

	void Finalize(Napi::Env env) override;

	static void init(const char* class_name, Napi::Env env);

	Napi::Value commit(const Napi::CallbackInfo&);
	Napi::Value abort(const Napi::CallbackInfo&);

	Napi::Value open_map(const Napi::CallbackInfo& info)
	{
		return get_dbi(info, db_mode{});
	}

	Napi::Value create_map(const Napi::CallbackInfo& info)
	{
		return get_dbi(info, {db_mode::create});
	}

	Napi::Value open_cursor(const Napi::CallbackInfo&);

	operator MDBX_txn*() noexcept
	{
		return txn_.get();
	}

	txnmou& operator++() noexcept
	{
		++cursor_count_;
		return *this;
	}

	txnmou& operator--() noexcept
	{
		assert(cursor_count_ > 0);
		--cursor_count_;
		return *this;
	}

	std::size_t cursor_count() const noexcept
	{
		return cursor_count_;
	}

	[[nodiscard]] bool is_active() const noexcept
	{
		return txn_ != nullptr;
	}

	[[nodiscard]] bool is_readonly() const noexcept
	{
		return (mode_.val & txn_mode::ro) != 0;
	}

	void attach(const Napi::Object& env_object, MDBX_txn* txn, txn_mode mode);
};

}  // namespace mdbxmou

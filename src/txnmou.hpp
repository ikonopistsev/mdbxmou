#pragma once

#include "dbimou.hpp"
#include "viewmou.hpp"
#include <cassert>
#include <limits>
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

	struct detach_result final {
		bool buffers_safe{true};
		bool references_released{true};
	};

	static constexpr std::size_t initial_prune_threshold{1024};
	static const napi_type_tag type_tag_;

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
	bool track_borrowed_views_{true};
	bool writemap_{};
	std::size_t cursor_count_{};
	std::vector<issued_view_ref> issued_views_{};
	std::size_t next_prune_at_{initial_prune_threshold};

#if defined(MDBXMOU_TESTING)
	enum class detach_fault {
		none,
		get_reference,
		is_detached,
		detach,
		delete_reference,
	};

	detach_fault next_detach_fault_{};
	std::size_t prune_runs_{};
	std::size_t pruned_refs_{};
	std::size_t detach_calls_{};
#endif

	envmou* get_environment(napi_env env) const noexcept;
	int complete_native(completion_kind kind, envmou& env) noexcept;
	void release_environment(envmou* env) noexcept;

	Napi::Value issue_view(napi_env env,
		const mdbx::slice& value,
		bool tracked,
		view_issue_fault fault = view_issue_fault::none);
	void track_view(napi_env env,
		napi_value array_buffer,
		view_issue_fault fault = view_issue_fault::none);
	detach_result detach_issued(napi_env env) noexcept;
	void detach_issued_or_throw(napi_env env);
	void detach_issued_noexcept(napi_env env) noexcept;
	void maybe_prune_dead_views(napi_env env) noexcept;
	void prune_dead_views(napi_env env) noexcept;
	void update_prune_threshold() noexcept;

#if defined(MDBXMOU_TESTING)
	bool consume_detach_fault(detach_fault fault) noexcept;
	Napi::Value debug_issue_view(const Napi::CallbackInfo& info);
	Napi::Value debug_view_stats(const Napi::CallbackInfo& info);
	Napi::Value debug_prune_views(const Napi::CallbackInfo& info);
	Napi::Value debug_fail_next_detach(const Napi::CallbackInfo& info);
#endif

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
	static bool is_instance(const Napi::Value& value) noexcept;
	static txnmou* unwrap_checked(const Napi::Env& env,
		const Napi::Value& value,
		const char* method_name);

	txnmou(const Napi::CallbackInfo& info)
		: Napi::ObjectWrap<txnmou>(info)
	{
		// MDBXMOU-0001-S3-M1: identify native wrappers without mutable JS prototypes.
		info.This().As<Napi::Object>().TypeTag(&type_tag_);
	}

	~txnmou() noexcept override;

	void Finalize(Napi::Env env) override;

	static Napi::Function init(const char* class_name, Napi::Env env);

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

	[[nodiscard]] bool is_writemap() const noexcept
	{
		return writemap_;
	}

	Napi::Value issue_borrowed_view(napi_env env, const mdbx::slice& value);

	void attach(const Napi::Object& env_object,
		MDBX_txn* txn,
		txn_mode mode,
		bool track_borrowed_views,
		bool writemap);
};

}  // namespace mdbxmou

#pragma once

#include "txnmou.hpp"
#include <cassert>
#include <memory>
#include <atomic>
#include <cstdint>
#include <mutex>

namespace mdbxmou {

// Forward declaration
class txnmou;

class envmou final : public Napi::ObjectWrap<envmou>
{
#if defined(MDBXMOU_TESTING)
	enum class debug_writer_phase : unsigned {
		idle,
		starting,
		ready,
		finishing,
		finished,
	};
#endif

	static mdbx::env::geometry parse_geometry(const Napi::Value& obj);
	static env_arg0 parse(const Napi::Value& obj);

	struct free_env {
		void operator()(MDBX_env* env) const
		{
			auto rc = mdbx_env_close(env);
			if (rc != MDBX_SUCCESS) {
				fprintf(stderr, "mdbx_env_close %s\n", mdbx_strerror(rc));
			}
		}
	};

	std::unique_ptr<MDBX_env, free_env> env_{};
	// JS-thread count of active transactions and reserved async work, including copy.
	std::size_t trx_count_{};
	env_arg0 arg0_{};
	static constexpr std::uint32_t f_busy = 1u << 0;
	static constexpr std::uint32_t f_copy = 1u << 1;
	std::atomic<std::uint32_t> state_flags_{0};

#if defined(MDBXMOU_TESTING)
	std::atomic<debug_writer_phase> debug_writer_phase_{
		debug_writer_phase::idle};
	std::atomic<debug_writer_phase> debug_writer_observed_phase_{
		debug_writer_phase::idle};
	std::atomic<int> debug_writer_begin_rc_{MDBX_RESULT_TRUE};
	std::atomic<int> debug_writer_finish_rc_{MDBX_RESULT_TRUE};
#endif

	bool is_open() const
	{
		return env_ != nullptr;
	}

	// Inline метод для проверки что база данных открыта
	void check() const
	{
		if (!is_open()) {
			throw std::runtime_error("closed");
		}
	}

	// Общий метод для создания транзакций
	Napi::Value start_transaction(
		const Napi::CallbackInfo& info, txn_mode mode);

public:
	envmou(const Napi::CallbackInfo& i)
		: ObjectWrap{i}
	{
	}

	static MDBX_env* create_and_open(const env_arg0& arg0);
	void attach(MDBX_env* env, const env_arg0& arg0);

	operator MDBX_env*() const noexcept
	{
		return env_.get();
	}

	static void init(
		const char* class_name, Napi::Env env, Napi::Object exports);

	envmou& operator++() noexcept
	{
		++trx_count_;
		return *this;
	}

	envmou& operator--() noexcept
	{
		assert(trx_count_ > 0);
		--trx_count_;
		return *this;
	}

	Napi::Value open(const Napi::CallbackInfo&);
	Napi::Value open_sync(const Napi::CallbackInfo&);
	Napi::Value close(const Napi::CallbackInfo&);
	Napi::Value close_sync(const Napi::CallbackInfo&);
	Napi::Value get_version(const Napi::CallbackInfo&);
	Napi::Value copy_to_sync(const Napi::CallbackInfo&);
	Napi::Value copy_to(const Napi::CallbackInfo&);
	// метод для групповых вставок или чтения
	// внутри транзакция, получение db и чтение/запись
	Napi::Value query(const Napi::CallbackInfo&);
	Napi::Value keys(const Napi::CallbackInfo&);

	Napi::Value set_option(const Napi::CallbackInfo&);
	Napi::Value sync_ex(const Napi::CallbackInfo&);

#if defined(MDBXMOU_TESTING)
	Napi::Value debug_start_writer(const Napi::CallbackInfo&);
	Napi::Value debug_writer_state(const Napi::CallbackInfo&);
	bool debug_writer_starting() noexcept;
	void debug_writer_ready(int rc) noexcept;
	void debug_writer_finishing() noexcept;
	void debug_writer_finished(int rc) noexcept;
	void debug_writer_observe_env_call() noexcept;
	void debug_writer_reset() noexcept;
#endif

	// Методы для создания транзакций
	Napi::Value start_read(const Napi::CallbackInfo& info)
	{
		return start_transaction(info, {txn_mode::ro});
	}
	Napi::Value start_write(const Napi::CallbackInfo& info)
	{
		return start_transaction(info, {});
	}

	using lock_guard = std::lock_guard<envmou>;
	// Exclusive setup and async open/close. Copy holds its own independent bit.
	void lock()
	{
		if (!try_lock()) {
			throw std::runtime_error("operation in progress");
		}
	}
	void unlock() noexcept
	{
		[[maybe_unused]] const auto previous =
			state_flags_.fetch_and(~f_busy, std::memory_order_release);
		assert(previous & f_busy);
	}
	bool try_lock() noexcept
	{
		const auto previous =
			state_flags_.fetch_or(f_busy, std::memory_order_acquire);
		return (previous & f_busy) == 0;
	}

	bool is_copying() const noexcept
	{
		return (state_flags_.load(std::memory_order_acquire) & f_copy) != 0;
	}

	void begin_copy()
	{
		assert(state_flags_.load(std::memory_order_relaxed) & f_busy);
		const auto previous =
			state_flags_.fetch_or(f_copy, std::memory_order_acq_rel);
		if (previous & f_copy) {
			throw std::runtime_error("operation in progress");
		}
		++(*this);
	}

	void end_copy() noexcept
	{
		assert(is_copying());
		--(*this);
		[[maybe_unused]] const auto previous =
			state_flags_.fetch_and(~f_copy, std::memory_order_release);
		assert(previous & f_copy);
	}

	void do_close()
	{
		// Async close owns f_busy and was queued only with a zero count. There
		// are no live transactions/completions to mutate this count off-thread.
		if (trx_count_ > 0) {
			throw std::runtime_error("transaction in progress");
		}
		env_.reset();
	}
};

}  // namespace mdbxmou

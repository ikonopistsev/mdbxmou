#include "debug_writer.hpp"
#include "envmou.hpp"

#include <chrono>
#include <thread>

namespace mdbxmou {

debug_writer::debug_writer(Napi::Env env,
	envmou& owner,
	const Napi::Object& owner_object,
	std::uint32_t hold_ms,
	std::uint32_t publish_delay_ms,
	bool commit)
	: Napi::AsyncWorker{env}
	, deferred_{Napi::Promise::Deferred::New(env)}
	, env_ref_{Napi::Persistent(owner_object)}
	, env_{owner}
	, native_env_{owner}
	, hold_ms_{hold_ms}
	, publish_delay_ms_{publish_delay_ms}
	, commit_{commit}
{
}

void debug_writer::Execute()
{
	MDBX_txn* txn{};
	const auto begin_rc =
		mdbx_txn_begin(native_env_, nullptr, MDBX_TXN_READWRITE, &txn);
	env_.debug_writer_ready(begin_rc);
	if (begin_rc != MDBX_SUCCESS) {
		env_.debug_writer_finished(begin_rc);
		SetError(mdbx_strerror(begin_rc));
		return;
	}

	std::this_thread::sleep_for(std::chrono::milliseconds{hold_ms_});
	env_.debug_writer_finishing();
	const auto finish_rc = commit_ ? mdbx_txn_commit(txn) : mdbx_txn_abort(txn);
	if (publish_delay_ms_ > 0) {
		std::this_thread::sleep_for(
			std::chrono::milliseconds{publish_delay_ms_});
	}
	env_.debug_writer_finished(finish_rc);
	if (finish_rc != MDBX_SUCCESS) {
		SetError(mdbx_strerror(finish_rc));
	}
}

void debug_writer::OnOK()
{
	--env_;
	deferred_.Resolve(Env().Undefined());
}

void debug_writer::OnError(const Napi::Error& error)
{
	--env_;
	deferred_.Reject(error.Value());
}

}  // namespace mdbxmou

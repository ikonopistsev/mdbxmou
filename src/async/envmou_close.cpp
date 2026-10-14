#include "envmou_close.hpp"
#include "envmou.hpp"
#include <utility>
#if defined(MDBXMOU_COPY_TESTING)
#include "copy_test.hpp"
#endif

namespace mdbxmou {

async_close::async_close(
	const Napi::Object& receiver, std::unique_lock<envmou>& lock)
	: Napi::AsyncWorker(receiver.Env())
	, deferred_(Napi::Promise::Deferred::New(receiver.Env()))
{
	Receiver().Reset(receiver, 1);
	that_ = lock.release();
}

async_close::~async_close()
{
	finish();
}

void async_close::finish() noexcept
{
	if (auto* owner = std::exchange(that_, nullptr)) {
		owner->unlock();
	}
}

void async_close::OnWorkComplete(Napi::Env env, napi_status status)
{
	finish();
	try {
		Napi::AsyncWorker::OnWorkComplete(env, status);
	} catch (const Napi::Error&) {
		// Base Destroy is last in the pinned SDK; an escaped error precedes it.
		Destroy();
	}
}

void async_close::Execute()
{
#if defined(MDBXMOU_COPY_TESTING)
	if (copy_test_native_error()) {
		SetError("injected native error");
		return;
	}
#endif
	try {
		that_->do_close();
	} catch (const std::exception& e) {
		SetError(e.what());
	}
}

void async_close::OnOK()
{
	finish();

	deferred_.Resolve(Env().Undefined());
}

void async_close::OnError(const Napi::Error& e)
{
	finish();

	deferred_.Reject(e.Value());
}

}  // namespace mdbxmou

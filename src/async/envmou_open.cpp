#include "envmou_open.hpp"
#include "envmou.hpp"
#include <utility>
#if defined(MDBXMOU_COPY_TESTING)
#include "copy_test.hpp"
#endif

namespace mdbxmou {

async_open::async_open(const Napi::Object& receiver,
	std::unique_lock<envmou>& lock,
	const env_arg0& arg0)
	: Napi::AsyncWorker(receiver.Env())
	, deferred_(Napi::Promise::Deferred::New(receiver.Env()))
	, arg0_(arg0)
{
	Receiver().Reset(receiver, 1);
	that_ = lock.release();
}

async_open::~async_open()
{
	finish();
}

void async_open::finish() noexcept
{
	if (auto* owner = std::exchange(that_, nullptr)) {
		owner->unlock();
	}
}

void async_open::OnWorkComplete(Napi::Env env, napi_status status)
{
	finish();
	try {
		Napi::AsyncWorker::OnWorkComplete(env, status);
	} catch (const Napi::Error&) {
		// Base Destroy is last in the pinned SDK; an escaped error precedes it.
		Destroy();
	}
}

void async_open::Execute()
{
#if defined(MDBXMOU_COPY_TESTING)
	if (copy_test_native_error()) {
		SetError("injected native error");
		return;
	}
#endif
	try {
		auto e = envmou::create_and_open(arg0_);
		that_->attach(e, arg0_);
	} catch (const std::exception& e) {
		SetError(e.what());
	}
}

void async_open::OnOK()
{
	finish();

	deferred_.Resolve(Env().Undefined());
}

void async_open::OnError(const Napi::Error& e)
{
	finish();

	deferred_.Reject(e.Value());
}

}  // namespace mdbxmou

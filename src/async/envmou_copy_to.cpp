#include "envmou_copy_to.hpp"
#include "envmou.hpp"
#include <utility>
#if defined(MDBXMOU_COPY_TESTING)
#include "copy_test.hpp"
#endif

namespace mdbxmou {

async_copy::async_copy(const Napi::Object& receiver,
	envmou& owner,
	std::string dest,
	MDBX_copy_flags_t flags)
	: Napi::AsyncWorker(receiver.Env())
	, deferred_(Napi::Promise::Deferred::New(receiver.Env()))
	, dest_(std::move(dest))
	, flags_(flags)
{
	Receiver().Reset(receiver, 1);
	owner.begin_copy();
	that_ = &owner;
}

async_copy::~async_copy()
{
	finish();
}

void async_copy::finish() noexcept
{
	if (auto* owner = std::exchange(that_, nullptr)) {
		owner->end_copy();
	}
}

void async_copy::OnWorkComplete(Napi::Env env, napi_status status)
{
	finish();
	try {
		Napi::AsyncWorker::OnWorkComplete(env, status);
	} catch (const Napi::Error&) {
		// node-addon-api 8.5.0 throws again if JS publication is forbidden
		// during teardown. Its normal Destroy is last, so we still own this.
		Destroy();
	}
}

void async_copy::Execute()
{
#if defined(MDBXMOU_COPY_TESTING)
	if (copy_test_native_error()) {
		SetError("injected native error");
		return;
	}
#endif
	auto rc = mdbx_env_copy(*that_, dest_.c_str(), flags_);
	if (rc != MDBX_SUCCESS) {
		SetError(mdbx_strerror(rc));
	}
}

void async_copy::OnOK()
{
	finish();
	deferred_.Resolve(Env().Undefined());
}

void async_copy::OnError(const Napi::Error& e)
{
	finish();
	deferred_.Reject(e.Value());
}

}  // namespace mdbxmou

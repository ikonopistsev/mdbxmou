#pragma once

#include <napi.h>
#include <mdbx.h++>
#include <mutex>

namespace mdbxmou {

class envmou;

class async_close final : public Napi::AsyncWorker
{
	Napi::Promise::Deferred deferred_;
	envmou* that_{};

	void finish() noexcept;

public:
	async_close(const Napi::Object& receiver, std::unique_lock<envmou>& lock);
	~async_close() override;

	void OnWorkComplete(Napi::Env env, napi_status status) override;

	void Execute() override;
	void OnOK() override;
	void OnError(const Napi::Error& e) override;

	Napi::Promise GetPromise() const
	{
		return deferred_.Promise();
	}
};

}  // namespace mdbxmou

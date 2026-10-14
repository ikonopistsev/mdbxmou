#pragma once

#include "env_arg0.hpp"
#include <mutex>

namespace mdbxmou {

class envmou;

class async_open final : public Napi::AsyncWorker
{
	Napi::Promise::Deferred deferred_;
	envmou* that_{};
	env_arg0 arg0_{};

	void finish() noexcept;

public:
	async_open(const Napi::Object& receiver,
		std::unique_lock<envmou>& lock,
		const env_arg0& arg0);
	~async_open() override;

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

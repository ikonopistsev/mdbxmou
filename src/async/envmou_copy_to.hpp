#pragma once
#include <napi.h>
#include <mdbx.h++>

namespace mdbxmou {

class envmou;

class async_copy final : public Napi::AsyncWorker
{
	Napi::Promise::Deferred deferred_;
	envmou* that_{};
	std::string dest_{};
	MDBX_copy_flags_t flags_{MDBX_CP_DEFAULTS};

	void finish() noexcept;

public:
	async_copy(const Napi::Object& receiver,
		envmou& owner,
		std::string dest,
		MDBX_copy_flags_t flags);
	~async_copy() override;

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

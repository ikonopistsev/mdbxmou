#pragma once

#include <mdbx.h++>
#include <napi.h>
#include <cstdint>

namespace mdbxmou {

class envmou;

class debug_writer final : public Napi::AsyncWorker
{
	Napi::Promise::Deferred deferred_;
	Napi::ObjectReference env_ref_;
	envmou& env_;
	MDBX_env* native_env_{};
	std::uint32_t hold_ms_{};
	std::uint32_t publish_delay_ms_{};
	bool commit_{};

public:
	debug_writer(Napi::Env env,
		envmou& owner,
		const Napi::Object& owner_object,
		std::uint32_t hold_ms,
		std::uint32_t publish_delay_ms,
		bool commit);

	void Execute() override;
	void OnOK() override;
	void OnError(const Napi::Error& error) override;

	Napi::Promise get_promise() const
	{
		return deferred_.Promise();
	}
};

}  // namespace mdbxmou

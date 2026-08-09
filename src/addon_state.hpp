#pragma once

#include <napi.h>
#include <cstdint>

namespace mdbxmou {

#if defined(MDBXMOU_TESTING)
struct addon_state_lifecycle final {
	std::uint64_t created{};
	std::uint64_t finalized{};
	std::uint64_t live{};
};
#endif

// MDBXMOU-0004: constructor references belong to one N-API environment.
class addon_state final
{
	Napi::FunctionReference txn_ctor_;
	Napi::FunctionReference dbi_ctor_;
	Napi::FunctionReference cursor_ctor_;

public:
	addon_state(const Napi::Function& txn_ctor,
		const Napi::Function& dbi_ctor,
		const Napi::Function& cursor_ctor);

	addon_state(const addon_state&) = delete;
	addon_state& operator=(const addon_state&) = delete;

	static addon_state& get(const Napi::Env& env);
	static void finalize(Napi::Env env, addon_state* state) noexcept;

	Napi::Object new_transaction() const;
	Napi::Object new_dbi() const;
	Napi::Object new_cursor() const;

#if defined(MDBXMOU_TESTING)
	static addon_state_lifecycle lifecycle() noexcept;
#endif
};

}  // namespace mdbxmou

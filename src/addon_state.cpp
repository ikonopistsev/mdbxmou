#include "addon_state.hpp"

#if defined(MDBXMOU_TESTING)
#include <atomic>
#include <mutex>
#endif

namespace mdbxmou {

#if defined(MDBXMOU_TESTING)
namespace {

std::atomic<std::uint64_t> states_created{};
std::atomic<std::uint64_t> states_finalized{};
std::atomic<std::uint64_t> states_live{};
std::mutex lifecycle_mutex{};

}  // namespace
#endif

addon_state::addon_state(const Napi::Function& txn_ctor,
	const Napi::Function& dbi_ctor,
	const Napi::Function& cursor_ctor)
	: txn_ctor_{Napi::Persistent(txn_ctor)}
	, dbi_ctor_{Napi::Persistent(dbi_ctor)}
	, cursor_ctor_{Napi::Persistent(cursor_ctor)}
{
#if defined(MDBXMOU_TESTING)
	const std::lock_guard lock{lifecycle_mutex};
	states_created.fetch_add(1, std::memory_order_relaxed);
	states_live.fetch_add(1, std::memory_order_relaxed);
#endif
}

addon_state& addon_state::get(const Napi::Env& env)
{
	auto* state = env.GetInstanceData<addon_state>();
	if (!state) {
		throw Napi::Error::New(env, "mdbxmou addon state is unavailable");
	}
	return *state;
}

void addon_state::finalize(Napi::Env, addon_state* state) noexcept
{
	delete state;
#if defined(MDBXMOU_TESTING)
	const std::lock_guard lock{lifecycle_mutex};
	states_finalized.fetch_add(1, std::memory_order_relaxed);
	states_live.fetch_sub(1, std::memory_order_relaxed);
#endif
}

Napi::Object addon_state::new_transaction() const
{
	return txn_ctor_.New({});
}

Napi::Object addon_state::new_dbi() const
{
	return dbi_ctor_.New({});
}

Napi::Object addon_state::new_cursor() const
{
	return cursor_ctor_.New({});
}

#if defined(MDBXMOU_TESTING)
addon_state_lifecycle addon_state::lifecycle() noexcept
{
	const std::lock_guard lock{lifecycle_mutex};
	return {
		states_created.load(std::memory_order_relaxed),
		states_finalized.load(std::memory_order_relaxed),
		states_live.load(std::memory_order_relaxed),
	};
}
#endif

}  // namespace mdbxmou

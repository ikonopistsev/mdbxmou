#include "copy_test.hpp"
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <unistd.h>

// Link wrappers leave the real addon/libmdbx unchanged. Per-work records live
// until native completion (or deletion after a failed Queue), never in envmou.
namespace {

struct plan {
	std::string name;
	std::string fault;
	std::string cancel;
	std::string io_path;
	bool gate_execute{};
	bool portable{};
	bool native_error{};
	bool publish_error{};
};

struct metrics {
	unsigned create_attempts{}, created{}, queued{}, executed{};
	unsigned completions{}, completed{}, deleted{}, cancelled{};
	unsigned publication_failures{}, throw_failures{};
	int cancel_status{-1};
	bool entered{}, io_entered{}, timed_out{};
};

struct work_record {
	plan options;
	napi_async_work work{};
	napi_async_execute_callback execute{};
	napi_async_complete_callback complete{};
	void* data{};
	bool pool_blocker{}, fault_used{}, publish_used{};
	std::atomic<bool> gate_used{false};
	std::mutex mutex;
	std::condition_variable condition;
	bool entered{}, released{};
};

std::mutex records_mutex;
std::unordered_map<napi_async_work, std::unique_ptr<work_record>> records;
std::unordered_map<std::string, metrics> observations;
thread_local plan next_plan;
thread_local work_record* constructing{};
thread_local work_record* executing{};
thread_local work_record* completing{};

template <class Function>
void observe(const work_record& record, Function update)
{
	std::lock_guard<std::mutex> lock{records_mutex};
	update(observations.at(record.options.name));
}

void enter_gate(work_record& record, bool io)
{
	if (record.gate_used.exchange(true)) return;
	{
		std::lock_guard<std::mutex> lock{record.mutex};
		record.entered = true;
	}
	record.condition.notify_all();
	observe(record, [io](metrics& value) {
		value.entered = true;
		value.io_entered = io;
	});
	std::unique_lock<std::mutex> lock{record.mutex};
	const auto ready =
		record.condition.wait_for(lock, std::chrono::seconds(15), [&record] {
			return record.released;
		});
	lock.unlock();
	if (!ready) {
		observe(record, [](metrics& value) {
			value.timed_out = true;
		});
	}
}

void execute_proxy(napi_env env, void* data)
{
	auto& record = *static_cast<work_record*>(data);
	observe(record, [](metrics& value) {
		++value.executed;
	});
	auto* previous = std::exchange(executing, &record);
	if (record.pool_blocker || record.options.gate_execute)
		enter_gate(record, false);
	if (!record.pool_blocker) record.execute(env, record.data);
	executing = previous;
}

work_record* io_record(int fd)
{
	char resolved[4096];
	const auto link = "/proc/self/fd/" + std::to_string(fd);
	const auto length = readlink(link.c_str(), resolved, sizeof(resolved));
	if (length < 0) return nullptr;
	const std::string path{resolved, static_cast<std::size_t>(length)};
	std::lock_guard<std::mutex> lock{records_mutex};
	for (const auto& item : records) {
		if (!item.second->options.io_path.empty() &&
			item.second->options.io_path == path)
			return item.second.get();
	}
	return nullptr;
}

bool constructor_fault(const char* name)
{
	if (!constructing || constructing->fault_used ||
		constructing->options.fault != name)
		return false;
	constructing->fault_used = true;
	return true;
}

bool publication_fault()
{
	if (!completing || !completing->options.publish_error ||
		completing->publish_used)
		return false;
	completing->publish_used = true;
	return true;
}

Napi::Value arm(const Napi::CallbackInfo& info)
{
	plan options;
	options.name = info[0].As<Napi::String>().Utf8Value();
	const auto input = info[1].As<Napi::Object>();
	if (input.Has("fault"))
		options.fault = input.Get("fault").As<Napi::String>();
	if (input.Has("cancel"))
		options.cancel = input.Get("cancel").As<Napi::String>();
	if (input.Has("ioPath"))
		options.io_path = input.Get("ioPath").As<Napi::String>();
	if (input.Has("gate"))
		options.gate_execute = input.Get("gate").As<Napi::Boolean>();
	if (input.Has("portable"))
		options.portable = input.Get("portable").As<Napi::Boolean>();
	if (input.Has("nativeError"))
		options.native_error = input.Get("nativeError").As<Napi::Boolean>();
	if (input.Has("publishError"))
		options.publish_error = input.Get("publishError").As<Napi::Boolean>();
	if (options.cancel == "running") options.gate_execute = true;
	{
		std::lock_guard<std::mutex> lock{records_mutex};
		if (observations.count(options.name))
			throw Napi::Error::New(info.Env(), "test name already used");
		observations.emplace(options.name, metrics{});
	}
	next_plan = std::move(options);
	return info.Env().Undefined();
}

Napi::Value state(const Napi::CallbackInfo& info)
{
	const auto name = info[0].As<Napi::String>().Utf8Value();
	metrics value;
	{
		std::lock_guard<std::mutex> lock{records_mutex};
		const auto found = observations.find(name);
		if (found == observations.end()) return info.Env().Null();
		value = found->second;
	}
	auto output = Napi::Object::New(info.Env());
#define COPY_TEST_METRIC(field, key) output.Set(key, value.field)
	COPY_TEST_METRIC(create_attempts, "createAttempts");
	COPY_TEST_METRIC(created, "created");
	COPY_TEST_METRIC(queued, "queued");
	COPY_TEST_METRIC(executed, "executed");
	COPY_TEST_METRIC(completions, "completions");
	COPY_TEST_METRIC(completed, "completed");
	COPY_TEST_METRIC(deleted, "deleted");
	COPY_TEST_METRIC(cancelled, "cancelled");
	COPY_TEST_METRIC(cancel_status, "cancelStatus");
	COPY_TEST_METRIC(publication_failures, "publicationFailures");
	COPY_TEST_METRIC(throw_failures, "throwFailures");
	COPY_TEST_METRIC(entered, "entered");
	COPY_TEST_METRIC(io_entered, "ioEntered");
	COPY_TEST_METRIC(timed_out, "timedOut");
#undef COPY_TEST_METRIC
	return output;
}

Napi::Value release(const Napi::CallbackInfo& info)
{
	const auto name = info[0].As<Napi::String>().Utf8Value();
	std::lock_guard<std::mutex> lock{records_mutex};
	for (auto& item : records) {
		if (item.second->options.name != name) continue;
		{
			std::lock_guard<std::mutex> gate_lock{item.second->mutex};
			item.second->released = true;
		}
		item.second->condition.notify_all();
		return Napi::Boolean::New(info.Env(), true);
	}
	return Napi::Boolean::New(info.Env(), false);
}

}  // namespace

extern "C" {
napi_status __real_napi_create_async_work(napi_env,
	napi_value,
	napi_value,
	napi_async_execute_callback,
	napi_async_complete_callback,
	void*,
	napi_async_work*);
napi_status __real_napi_delete_async_work(napi_env, napi_async_work);
napi_status __real_napi_queue_async_work(napi_env, napi_async_work);
napi_status __real_napi_create_promise(napi_env, napi_deferred*, napi_value*);
napi_status __real_napi_create_reference(
	napi_env, napi_value, std::uint32_t, napi_ref*);
napi_status __real_napi_resolve_deferred(napi_env, napi_deferred, napi_value);
napi_status __real_napi_reject_deferred(napi_env, napi_deferred, napi_value);
napi_status __real_napi_throw(napi_env, napi_value);
ssize_t __real_write(int, const void*, size_t);
ssize_t __real_copy_file_range(int, off_t*, int, off_t*, size_t, unsigned);
}

namespace {

void complete_proxy(napi_env env, napi_status status, void* data)
{
	auto* record = static_cast<work_record*>(data);
	std::unique_ptr<work_record> owner;
	{
		std::lock_guard<std::mutex> lock{records_mutex};
		auto found = records.find(record->work);
		owner = std::move(found->second);
		records.erase(found);
	}
	observe(*record, [status](metrics& value) {
		++value.completions;
		if (status == napi_cancelled) ++value.cancelled;
	});
	auto* previous = std::exchange(completing, record);
	if (record->pool_blocker) {
		__real_napi_delete_async_work(env, record->work);
		observe(*record, [](metrics& value) {
			++value.deleted;
		});
	} else {
		record->complete(env, status, record->data);
	}
	completing = previous;
	observe(*record, [](metrics& value) {
		++value.completed;
	});
	// SDK may delete its worker inside complete; this independent record remains
	// owned by the proxy until all instrumentation is done.
}

Napi::Value block_pool(const Napi::CallbackInfo& info)
{
	auto record = std::make_unique<work_record>();
	record->options.name = info[0].As<Napi::String>().Utf8Value();
	record->pool_blocker = true;
	{
		std::lock_guard<std::mutex> lock{records_mutex};
		if (observations.count(record->options.name))
			throw Napi::Error::New(info.Env(), "test name already used");
		observations.emplace(record->options.name, metrics{});
	}
	const auto name = Napi::String::New(info.Env(), "copy-test-pool-barrier");
	const auto status = __real_napi_create_async_work(info.Env(),
		nullptr,
		name,
		execute_proxy,
		complete_proxy,
		record.get(),
		&record->work);
	if (status != napi_ok)
		throw Napi::Error::New(info.Env(), "pool barrier creation failed");
	const auto work = record->work;
	{
		std::lock_guard<std::mutex> lock{records_mutex};
		records.emplace(work, std::move(record));
	}
	const auto queue_status = __real_napi_queue_async_work(info.Env(), work);
	if (queue_status != napi_ok) {
		__real_napi_delete_async_work(info.Env(), work);
		std::lock_guard<std::mutex> lock{records_mutex};
		records.erase(work);
		throw Napi::Error::New(info.Env(), "pool barrier queue failed");
	}
	return info.Env().Undefined();
}

}  // namespace

extern "C" napi_status __wrap_napi_create_async_work(napi_env env,
	napi_value resource,
	napi_value name,
	napi_async_execute_callback execute,
	napi_async_complete_callback complete,
	void* data,
	napi_async_work* result)
{
	if (next_plan.name.empty())
		return __real_napi_create_async_work(
			env, resource, name, execute, complete, data, result);
	auto record = std::make_unique<work_record>();
	record->options = std::exchange(next_plan, plan{});
	record->execute = execute;
	record->complete = complete;
	record->data = data;
	observe(*record, [](metrics& value) {
		++value.create_attempts;
	});
	if (record->options.fault == "create") return napi_generic_failure;
	const auto status = __real_napi_create_async_work(env,
		resource,
		name,
		execute_proxy,
		complete_proxy,
		record.get(),
		result);
	if (status != napi_ok) return status;
	record->work = *result;
	observe(*record, [](metrics& value) {
		++value.created;
	});
	constructing = record.get();
	std::lock_guard<std::mutex> lock{records_mutex};
	records.emplace(*result, std::move(record));
	return status;
}

extern "C" napi_status __wrap_napi_delete_async_work(
	napi_env env, napi_async_work work)
{
	if (completing && completing->work == work) {
		observe(*completing, [](metrics& value) {
			++value.deleted;
		});
	} else {
		std::unique_ptr<work_record> owner;
		{
			std::lock_guard<std::mutex> lock{records_mutex};
			auto found = records.find(work);
			if (found != records.end()) {
				owner = std::move(found->second);
				records.erase(found);
			}
		}
		if (owner) {
			if (constructing == owner.get()) constructing = nullptr;
			observe(*owner, [](metrics& value) {
				++value.deleted;
			});
		}
	}
	return __real_napi_delete_async_work(env, work);
}

extern "C" napi_status __wrap_napi_queue_async_work(
	napi_env env, napi_async_work work)
{
	auto* record = constructing;
	if (record && record->work == work && constructor_fault("queue"))
		return napi_generic_failure;
	const auto status = __real_napi_queue_async_work(env, work);
	if (record && record->work == work) {
		if (status == napi_ok)
			observe(*record, [](metrics& value) {
				++value.queued;
			});
		constructing = nullptr;
	}
	return status;
}

extern "C" napi_status __wrap_napi_create_promise(
	napi_env env, napi_deferred* deferred, napi_value* promise)
{
	if (constructor_fault("promise")) return napi_generic_failure;
	return __real_napi_create_promise(env, deferred, promise);
}

extern "C" napi_status __wrap_napi_create_reference(
	napi_env env, napi_value value, std::uint32_t count, napi_ref* result)
{
	if (constructor_fault("receiver")) return napi_generic_failure;
	return __real_napi_create_reference(env, value, count, result);
}

extern "C" napi_status __wrap_napi_resolve_deferred(
	napi_env env, napi_deferred deferred, napi_value value)
{
	const auto status = publication_fault()
		? napi_generic_failure
		: __real_napi_resolve_deferred(env, deferred, value);
	if (completing && status != napi_ok)
		observe(*completing, [](metrics& metrics) {
			++metrics.publication_failures;
		});
	return status;
}

extern "C" napi_status __wrap_napi_reject_deferred(
	napi_env env, napi_deferred deferred, napi_value value)
{
	const auto status = publication_fault()
		? napi_generic_failure
		: __real_napi_reject_deferred(env, deferred, value);
	if (completing && status != napi_ok)
		observe(*completing, [](metrics& metrics) {
			++metrics.publication_failures;
		});
	return status;
}

extern "C" napi_status __wrap_napi_throw(napi_env env, napi_value error)
{
	const auto status = __real_napi_throw(env, error);
	if (completing && status != napi_ok)
		observe(*completing, [](metrics& value) {
			++value.throw_failures;
		});
	return status;
}

extern "C" ssize_t __wrap_write(int fd, const void* data, size_t length)
{
	if (length >= 65536) {
		if (auto* record = io_record(fd)) enter_gate(*record, true);
	}
	return __real_write(fd, data, length);
}

extern "C" ssize_t __wrap_copy_file_range(int input,
	off_t* input_offset,
	int output,
	off_t* output_offset,
	size_t length,
	unsigned flags)
{
	if (auto* record = io_record(output)) {
		if (record->options.portable) {
			errno = ENOSYS;
			return -1;
		}
		enter_gate(*record, true);
	}
	return __real_copy_file_range(
		input, input_offset, output, output_offset, length, flags);
}

namespace mdbxmou {

bool copy_test_native_error() noexcept
{
	return executing && executing->options.native_error;
}

void copy_test_after_queue(napi_env env, napi_async_work work)
{
	work_record* record{};
	{
		std::lock_guard<std::mutex> lock{records_mutex};
		const auto found = records.find(work);
		if (found != records.end()) record = found->second.get();
	}
	if (!record || record->options.cancel.empty()) return;
	if (record->options.cancel == "running") {
		std::unique_lock<std::mutex> lock{record->mutex};
		if (!record->condition.wait_for(
				lock, std::chrono::seconds(5), [record] {
					return record->entered;
				})) {
			record->released = true;
			lock.unlock();
			record->condition.notify_all();
			throw Napi::Error::New(
				env, "running cancellation barrier timed out");
		}
	}
	const auto status = napi_cancel_async_work(env, work);
	observe(*record, [status](metrics& value) {
		value.cancel_status = status;
	});
	if (record->options.cancel == "running") {
		{
			std::lock_guard<std::mutex> lock{record->mutex};
			record->released = true;
		}
		record->condition.notify_all();
	}
}

void init_copy_test(Napi::Env env, Napi::Object exports)
{
	auto hooks = Napi::Object::New(env);
	hooks.Set("arm", Napi::Function::New(env, arm));
	hooks.Set("state", Napi::Function::New(env, state));
	hooks.Set("release", Napi::Function::New(env, release));
	hooks.Set("blockPool", Napi::Function::New(env, block_pool));
	hooks.Set("ok", static_cast<int>(napi_ok));
	hooks.Set("genericFailure", static_cast<int>(napi_generic_failure));
	exports.Set("_copyTest", hooks);
}

}  // namespace mdbxmou

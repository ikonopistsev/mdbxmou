#include "viewmou.hpp"
#include <mdbx.h++>
#include <napi.h>

namespace mdbxmou {

namespace {

void borrowed_buffer_finalize(napi_env, void*, void*) noexcept
{
}

[[noreturn]] void throw_view_error(napi_env env, const char* message)
{
	throw Napi::Error::New(env, message);
}

}  // namespace

void detach_pending_external_view(
	napi_env env, napi_value array_buffer, const char* location) noexcept
{
	bool detached{};
	const auto is_status =
		napi_is_detached_arraybuffer(env, array_buffer, &detached);
	if (is_status != napi_ok ||
		(!detached && napi_detach_arraybuffer(env, array_buffer) != napi_ok)) {
		Napi::Error::Fatal(location,
			"failed to detach an unreturned MDBX borrowed ArrayBuffer");
	}
}

external_view_result make_external_value_view(
	napi_env env, const mdbx::slice& value, view_issue_fault fault)
{
	external_view_result result{};

	if (value.length() == 0) {
		void* data{};
		if (napi_create_arraybuffer(env, 0, &data, &result.array_buffer) !=
			napi_ok) {
			throw_view_error(env, "failed to create zero-length ArrayBuffer");
		}
		if (napi_create_dataview(
				env, 0, result.array_buffer, 0, &result.data_view) != napi_ok) {
			throw_view_error(env, "failed to create zero-length DataView");
		}
		return result;
	}

	auto* data = const_cast<void*>(value.data());
	if (napi_create_external_arraybuffer(env,
			data,
			value.length(),
			borrowed_buffer_finalize,
			nullptr,
			&result.array_buffer) != napi_ok) {
		throw_view_error(env, "failed to create MDBX borrowed ArrayBuffer");
	}
	result.borrowed = true;

	try {
		if (fault == view_issue_fault::after_array_buffer) {
			throw Napi::Error::New(
				env, "debug fault after external ArrayBuffer creation");
		}

		if (napi_create_dataview(env,
				value.length(),
				result.array_buffer,
				0,
				&result.data_view) != napi_ok) {
			throw Napi::Error::New(
				env, "failed to create MDBX borrowed DataView");
		}

		if (fault == view_issue_fault::after_data_view) {
			throw Napi::Error::New(env, "debug fault after DataView creation");
		}
	} catch (...) {
		detach_pending_external_view(
			env, result.array_buffer, "mdbxmou::make_external_value_view");
		throw;
	}

	return result;
}

}  // namespace mdbxmou

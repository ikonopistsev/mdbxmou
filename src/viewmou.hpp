#pragma once

#include <node_api.h>

namespace mdbx {
struct slice;
}

namespace mdbxmou {

enum class view_issue_fault {
	none,
	after_array_buffer,
	after_data_view,
	after_reference,
	registry_push,
};

struct external_view_result final {
	napi_value array_buffer{};
	napi_value data_view{};
	bool borrowed{};
};

external_view_result make_external_value_view(napi_env env,
	const mdbx::slice& value,
	view_issue_fault fault = view_issue_fault::none);

void detach_pending_external_view(
	napi_env env, napi_value array_buffer, const char* location) noexcept;

}  // namespace mdbxmou

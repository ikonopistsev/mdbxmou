#pragma once

#include <napi.h>

namespace mdbxmou {

// Only linked by the Linux MDBXMOU_COPY_TESTING build.
void init_copy_test(Napi::Env env, Napi::Object exports);
bool copy_test_native_error() noexcept;
void copy_test_after_queue(napi_env env, napi_async_work work);

}  // namespace mdbxmou

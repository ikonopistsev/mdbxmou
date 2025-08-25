#pragma once

#include "valuemou.hpp"
#ifdef _WIN32
typedef unsigned short mode_t;
#endif

namespace mdbxmou {

struct env_arg0 {
    std::string path;
    MDBX_dbi max_dbi{32};
    mdbx::env::geometry geom{};
    env_flag flag{};
    mode_t file_mode{0664};
    std::uint32_t max_readers{128};
    base_flag key_flag{};
    base_flag value_flag{};
};

static inline const env_arg0* get_env_userctx(MDBX_env* env_ptr)
{
    assert(env_ptr);
    auto rc = static_cast<env_arg0*>(mdbx_env_get_userctx(env_ptr));
    if (!rc)
        throw std::runtime_error("env: userctx not set");
    return rc;
}

} // namespace mdbxmou

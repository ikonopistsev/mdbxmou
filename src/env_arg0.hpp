#pragma once

#include "valuemou.hpp"
// #include <sys/syscall.h>
// #include <unistd.h>

namespace mdbxmou {

struct env_arg0 {
    std::string path;
    MDBX_dbi max_dbi{32};
    mdbx::env::geometry geom{};
    env_flag flag{};
    mode_t mode{0664};
    std::uint32_t max_readers{128};
    base_flag key_flag{};
    base_flag value_flag{};
};

// static inline pid_t gettid() {
//     return static_cast<pid_t>(syscall(SYS_gettid));
// }

} // namespace mdbxmou

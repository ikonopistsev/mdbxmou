#pragma once

#include <napi.h>
#include <mdbx.h++>
//#include <sys/syscall.h>
//#include <unistd.h>

namespace mdbxmou {

struct env_arg0 {
    std::string path;
    MDBX_dbi max_dbi{32};
    mdbx::env::geometry geom{};
    MDBX_env_flags_t flags{};
    mode_t mode{0664};
    unsigned int max_readers{128};
    bool key_string{false};
    bool val_string{false};
};

// static inline pid_t gettid() {
//     return static_cast<pid_t>(syscall(SYS_gettid));
// }

} // namespace mdbxmou

#pragma once

#include "valuemou.hpp"

namespace mdbxmou {

struct convmou
{
    key_mode key_mode_{};
    base_flag key_flag_{};
    base_flag value_flag_{};

    convmou() = default;

    convmou(key_mode key_mode, base_flag key_flag,
        base_flag value_flag = {}) noexcept
        : key_mode_{key_mode}
        , key_flag_{key_flag}
        , value_flag_{value_flag}
    {   }

    Napi::Value convert_key(const Napi::Env& env, const keymou& key) const;

    Napi::Value convert_value(const Napi::Env& env, const valuemou& val) const;

    Napi::Object make_result(const Napi::Env& env,
        const keymou& key, const valuemou& val) const;
};

} // namespace mdbxmou

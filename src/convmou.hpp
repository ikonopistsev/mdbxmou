#pragma once

#include "valuemou.hpp"

namespace mdbxmou {

class dbimou;

struct convmou
{
    key_mode key_mode_{};
    value_mode value_mode_{};
    base_flag key_flag_{};
    base_flag value_flag_{};

    static convmou for_dbi(const dbimou& dbi) noexcept;

    Napi::Value convert_key(const Napi::Env& env, const keymou& key) const;

    Napi::Value convert_value(const Napi::Env& env, const valuemou& val) const;

    Napi::Object make_result(const Napi::Env& env,
        const keymou& key, const valuemou& val) const;
};

} // namespace mdbxmou

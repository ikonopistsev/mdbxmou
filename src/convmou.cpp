#include "convmou.hpp"

namespace mdbxmou {

Napi::Value convmou::convert_key(const Napi::Env& env, const keymou& key) const
{
    if (mdbx::is_ordinal(key_mode_)) {
        return (key_flag_ & base_flag::bigint) ?
            key.to_bigint(env) :
            key.to_number(env);
    }

    return (key_flag_ & base_flag::string) ?
        key.to_string(env) :
        key.to_buffer(env);
}

Napi::Value convmou::convert_value(const Napi::Env& env, const valuemou& val) const
{
    return (value_flag_ & base_flag::string) ?
        val.to_string(env) :
        val.to_buffer(env);
}

Napi::Object convmou::make_result(const Napi::Env& env,
    const keymou& key, const valuemou& val) const
{
    auto result = Napi::Object::New(env);
    result.Set("key", convert_key(env, key));
    result.Set("value", convert_value(env, val));
    return result;
}

} // namespace mdbxmou

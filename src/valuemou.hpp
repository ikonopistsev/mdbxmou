#pragma once

#include <napi.h>
#include <mdbx.h++>
#include <cstdint>
#include <vector>

namespace mdbxmou {

using buffer_type = std::vector<char>;

class valuemou
    : public mdbx::slice
{
public:
    valuemou() = default;

    valuemou(const mdbx::slice& arg0) noexcept
        : mdbx::slice{arg0}
    {   }

    valuemou(const Napi::Buffer<char>& arg0) noexcept
        : mdbx::slice{arg0.Data(), arg0.Length()}
    {   }

    valuemou(const Napi::Buffer<char>& arg0, buffer_type& mem)
    {   
        auto ptr = arg0.Data();
        mem.assign(ptr, ptr + arg0.Length());
        assign(mem.data(), mem.size());
    }

    valuemou(const Napi::String& arg0, 
        const Napi::Env& env, buffer_type& mem)
    {   
        size_t length;
        auto status =
            napi_get_value_string_utf8(env, arg0, nullptr, 0, &length);
        if (status != napi_ok) {
            throw Napi::Error::New(env, "napi_get_value_string_utf8 length");
        }

        mem.reserve(length + 1);
        mem.resize(length);

        status = napi_get_value_string_utf8(
            env, arg0, mem.data(), mem.capacity(), nullptr);
        if (status != napi_ok) {
            throw Napi::Error::New(env, "napi_get_value_string_utf8 copyout");
        }

        assign(mem.data(), mem.size());
    }

    static inline valuemou from(const Napi::Value& arg0, 
        const Napi::Env& env, buffer_type& mem)
    {
        if (arg0.IsBuffer()) {
            return {arg0.As<Napi::Buffer<char>>()};
        } else if (!arg0.IsString()) {
            throw Napi::Error::New(env, "unsupported value");
        }
        return {arg0.As<Napi::String>(), env, mem};
    }

    Napi::Value to_string(const Napi::Env& env) const
    {
        return Napi::String::New(env, 
            char_ptr(), length());
    }

    Napi::Value to_buffer(const Napi::Env& env) const
    {
        return Napi::Buffer<char>::Copy(env, 
            char_ptr(), length());
    }
};

class keymou final
    : public valuemou
{
public:
    enum variant_type : int {
        mdbxmou_buffer,
        mdbxmou_string,
        mdbxmou_number,
        mdbxmou_bigint
    };

public:    
    keymou() = default;

    keymou(const valuemou& arg0) noexcept
        : valuemou{arg0}
    {   }

    keymou(const mdbx::slice& arg0) noexcept
        : valuemou{arg0}
    {   }

    keymou(const Napi::Buffer<char>& arg0)
        : valuemou{arg0}
    {   }

    keymou(const Napi::Buffer<char>& arg0, buffer_type& mem)
        : valuemou{arg0, mem}
    {   }

    keymou(const Napi::String& arg0, 
        const Napi::Env& env, buffer_type& mem)
        : valuemou{arg0, env, mem}
    {   }

    keymou(const Napi::Number& arg0, 
        const Napi::Env& env, std::uint64_t& mem)
    {   
        auto value = arg0.Int64Value();
        if (value < 0) {
            throw Napi::Error::New(env, "Number negative");
        }
        mem = static_cast<std::uint64_t>(value);
        assign(&mem, sizeof(mem));
    }

    keymou(const Napi::BigInt& arg0, 
        const Napi::Env& env, std::uint64_t& mem)
    {   
        bool looseless;
        mem = arg0.Uint64Value(&looseless);
        if (!looseless) {
            throw Napi::Error::New(env, "BigInt !looseless");
        }
        assign(&mem, sizeof(mem));
    }

    static inline keymou from(const Napi::Value& arg0, 
        const Napi::Env& env, buffer_type& mem)
    {
        return {valuemou::from(arg0, env, mem)};
    }    

    static inline keymou from(const Napi::Value& arg0, 
        const Napi::Env& env, std::uint64_t& mem)
    {
        if (arg0.IsBigInt()) {
            return {arg0.As<Napi::BigInt>(), env, mem};
        } else if (!arg0.IsNumber()) {
            throw Napi::Error::New(env, "unsupported key");
        }
        return {arg0.As<Napi::Number>(), env, mem};
    }

    static inline keymou from(const Napi::Value& arg0, 
        const Napi::Env& env, buffer_type& buf, std::uint64_t& num)
    {
        if (arg0.IsBuffer() || arg0.IsString()) {
            return from(arg0, env, buf);
        } else if (!(arg0.IsNumber() || arg0.IsBigInt())) {
            throw Napi::Error::New(env, "unsupported key");
        }
        return from(arg0, env, num);
    }

    Napi::Value to_number(const Napi::Env& env) const
    {
        return Napi::Number::New(env, as_int64());
    }

    Napi::Value to_bigint(const Napi::Env& env) const
    {
        return Napi::BigInt::New(env, as_uint64());
    }
};

} // mdbxmou
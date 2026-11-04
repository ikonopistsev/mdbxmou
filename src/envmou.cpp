#include "envmou.hpp"
#include "addon_state.hpp"
#include "txnmou.hpp"
#include "async/envmou_copy_to.hpp"
#include "async/envmou_query.hpp"
#include "async/envmou_open.hpp"
#include "async/envmou_keys.hpp"
#include "async/envmou_close.hpp"
#if defined(MDBXMOU_TESTING)
#include "debug_writer.hpp"
#endif
#if defined(MDBXMOU_COPY_TESTING)
#include "copy_test.hpp"
#endif
#include <cmath>
#include <cstdint>
#include <exception>
#include <limits>

#ifdef _WIN32
#include <windows.h>
#else
#include <pthread.h>
#endif

namespace mdbxmou {

namespace {

struct abort_transaction final {
	void operator()(MDBX_txn* txn) const noexcept
	{
		const auto rc = mdbx_txn_abort(txn);
		if (rc == MDBX_THREAD_MISMATCH) {
			// Begin and rollback run on this thread under the environment lock. A
			// mismatch breaks that invariant, and no owner remains to retry abort;
			// continuing would leave the environment with an unreachable live txn.
			Napi::Error::Fatal("mdbxmou::abort_transaction",
				"MDBX_THREAD_MISMATCH while rolling back an unattached "
				"transaction");
		}
	}
};

Napi::BigInt uint64_value(Napi::Env env, std::uint64_t value)
{
	return Napi::BigInt::New(env, value);
}

Napi::Number uint32_value(Napi::Env env, std::uint32_t value)
{
	return Napi::Number::New(env, static_cast<double>(value));
}

// 128-bit MDBX ID: hex16(x) + hex16(y), zero pair means "unknown".
Napi::Value id_value(Napi::Env env, std::uint64_t x, std::uint64_t y)
{
	if (x == 0 && y == 0) {
		return env.Null();
	}
	static constexpr char digits[] = "0123456789abcdef";
	char text[32];
	for (int i = 0; i < 16; ++i) {
		text[i] = digits[(x >> (60 - 4 * i)) & 0xf];
		text[16 + i] = digits[(y >> (60 - 4 * i)) & 0xf];
	}
	return Napi::String::New(env, text, sizeof(text));
}

Napi::Array uint64_array(
	Napi::Env env, const std::uint64_t* values, std::size_t count)
{
	auto array = Napi::Array::New(env, count);
	for (std::size_t i = 0; i < count; ++i) {
		array.Set(static_cast<std::uint32_t>(i), uint64_value(env, values[i]));
	}
	return array;
}

Napi::Object env_info_object(Napi::Env env, const MDBX_envinfo& mi)
{
	auto geometry = Napi::Object::New(env);
	geometry.Set("lower", uint64_value(env, mi.mi_geo.lower));
	geometry.Set("upper", uint64_value(env, mi.mi_geo.upper));
	geometry.Set("current", uint64_value(env, mi.mi_geo.current));
	geometry.Set("shrink", uint64_value(env, mi.mi_geo.shrink));
	geometry.Set("grow", uint64_value(env, mi.mi_geo.grow));

	auto boot_meta = Napi::Array::New(env, 3);
	for (std::uint32_t i = 0; i < 3; ++i) {
		boot_meta.Set(
			i, id_value(env, mi.mi_bootid.meta[i].x, mi.mi_bootid.meta[i].y));
	}
	auto boot_id = Napi::Object::New(env);
	boot_id.Set("current",
		id_value(env, mi.mi_bootid.current.x, mi.mi_bootid.current.y));
	boot_id.Set("meta", boot_meta);

	const auto& op = mi.mi_pgop_stat;
	auto page_operations = Napi::Object::New(env);
	page_operations.Set("newly", uint64_value(env, op.newly));
	page_operations.Set("cow", uint64_value(env, op.cow));
	page_operations.Set("clone", uint64_value(env, op.clone));
	page_operations.Set("split", uint64_value(env, op.split));
	page_operations.Set("merge", uint64_value(env, op.merge));
	page_operations.Set("spill", uint64_value(env, op.spill));
	page_operations.Set("unspill", uint64_value(env, op.unspill));
	page_operations.Set("wops", uint64_value(env, op.wops));
	page_operations.Set("prefault", uint64_value(env, op.prefault));
	page_operations.Set("mincore", uint64_value(env, op.mincore));
	page_operations.Set("msync", uint64_value(env, op.msync));
	page_operations.Set("fsync", uint64_value(env, op.fsync));

	auto result = Napi::Object::New(env);
	result.Set("geometry", geometry);
	result.Set("mapSize", uint64_value(env, mi.mi_mapsize));
	result.Set("dxbFileSize", uint64_value(env, mi.mi_dxb_fsize));
	result.Set("dxbFileAllocated", uint64_value(env, mi.mi_dxb_fallocated));
	result.Set("lastPageNumber", uint64_value(env, mi.mi_last_pgno));
	result.Set("recentTxnId", uint64_value(env, mi.mi_recent_txnid));
	result.Set(
		"latterReaderTxnId", uint64_value(env, mi.mi_latter_reader_txnid));
	result.Set("selfLatterReaderTxnId",
		uint64_value(env, mi.mi_self_latter_reader_txnid));
	result.Set("metaTxnId", uint64_array(env, mi.mi_meta_txnid, 3));
	result.Set("metaSign", uint64_array(env, mi.mi_meta_sign, 3));
	result.Set("maxReaders", uint32_value(env, mi.mi_maxreaders));
	result.Set("numReaders", uint32_value(env, mi.mi_numreaders));
	result.Set("dxbPageSize", uint32_value(env, mi.mi_dxb_pagesize));
	result.Set("sysPageSize", uint32_value(env, mi.mi_sys_pagesize));
	result.Set("sysUpcblk", uint32_value(env, mi.mi_sys_upcblk));
	result.Set("sysIoblk", uint32_value(env, mi.mi_sys_ioblk));
	result.Set("bootId", boot_id);
	result.Set("unsyncVolume", uint64_value(env, mi.mi_unsync_volume));
	result.Set(
		"autosyncThreshold", uint64_value(env, mi.mi_autosync_threshold));
	result.Set("sinceSyncSeconds16dot16",
		uint32_value(env, mi.mi_since_sync_seconds16dot16));
	result.Set("autosyncPeriodSeconds16dot16",
		uint32_value(env, mi.mi_autosync_period_seconds16dot16));
	result.Set("sinceReaderCheckSeconds16dot16",
		uint32_value(env, mi.mi_since_reader_check_seconds16dot16));
	result.Set("mode", uint32_value(env, mi.mi_mode));
	result.Set("pageOperations", page_operations);
	result.Set("dxbId", id_value(env, mi.mi_dxbid.x, mi.mi_dxbid.y));
	return result;
}

std::uint64_t parse_option_value(const Napi::Env &env, const Napi::Value &arg0)
{
    if (arg0.IsBigInt())
    {
        bool lossless = false;
        const auto value = arg0.As<Napi::BigInt>().Uint64Value(&lossless);
        if (!lossless)
            throw Napi::TypeError::New(env, "option value BigInt must fit uint64");

        return value;
    }

    return static_cast<std::uint64_t>(arg0.As<Napi::Number>().DoubleValue());
}

std::uint64_t parse_sync_period(const Napi::Env &env, const Napi::Value &value)
{
    if (!value.IsNumber())
        throw Napi::TypeError::New(env, "syncPeriod must be a number");

    constexpr double fixed_point_scale = 65536.0;
    constexpr double max_sync_period_seconds =
        static_cast<double>(std::numeric_limits<std::uint32_t>::max()) /
        fixed_point_scale;
    const auto seconds = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(seconds) || seconds < 0 ||
        seconds > max_sync_period_seconds)
        throw Napi::RangeError::New(env, "syncPeriod is out of range");

    return static_cast<std::uint64_t>(seconds * fixed_point_scale);
}

} // namespace

void envmou::init(const char *class_name, Napi::Env env, Napi::Object exports)
{
    auto func = DefineClass(env, class_name, {
        InstanceMethod("open", &envmou::open),
        InstanceMethod("openSync", &envmou::open_sync),
        InstanceMethod("close", &envmou::close),
        InstanceMethod("closeSync", &envmou::close_sync),
        InstanceMethod("copyTo", &envmou::copy_to),
        InstanceMethod("copyToSync", &envmou::copy_to_sync),
        InstanceMethod("version", &envmou::get_version),
        InstanceMethod("startRead", &envmou::start_read),
        InstanceMethod("startWrite", &envmou::start_write),
        InstanceMethod("query", &envmou::query),
        InstanceMethod("keys", &envmou::keys),
        InstanceMethod("setOption", &envmou::set_option),
        InstanceMethod("syncEx", &envmou::sync_ex),
        InstanceMethod("info", &envmou::info),
#if defined(MDBXMOU_TESTING)
        InstanceMethod("_debugStartWriter", &envmou::debug_start_writer),
        InstanceMethod("_debugWriterState", &envmou::debug_writer_state),
#endif
    });
    exports.Set(class_name, func);
}

mdbx::env::geometry envmou::parse_geometry(const Napi::Value& arg0) 
{
    mdbx::env::geometry geom{};

    auto obj = arg0.As<Napi::Object>();

    if (obj.Has("fixedSize")) {
        auto value = obj.Get("fixedSize").As<Napi::Number>();
        auto fixed_size = static_cast<intptr_t>(value.Int64Value());
        return geom.make_fixed(fixed_size);
    } else if (obj.Has("dynamicSize")) {
        auto arr = obj.Get("dynamicSize").As<Napi::Array>();
        if (arr.Length() != 2) {
            throw Napi::TypeError::New(obj.Env(), "dynamicSize must be an array of two numbers");
        }
        auto v1 = arr.Get(0u).As<Napi::Number>();
        auto v2 = arr.Get(1u).As<Napi::Number>();
        auto size_lower = static_cast<intptr_t>(v1.Int64Value());
        auto size_upper = static_cast<intptr_t>(v2.Int64Value());
        return geom.make_dynamic(size_lower, size_upper);
    } else {
        if (obj.Has("sizeNow")) {
            auto value = obj.Get("sizeNow").As<Napi::Number>();
            geom.size_now = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("sizeUpper")) {
            auto value = obj.Get("sizeUpper").As<Napi::Number>();
            geom.size_upper = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("growthStep")) {
            auto value = obj.Get("growthStep").As<Napi::Number>();
            geom.growth_step = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("shrinkThreshold")) {
            auto value = obj.Get("shrinkThreshold").As<Napi::Number>();
            geom.shrink_threshold = static_cast<intptr_t>(value.Int64Value());
        }
        if (obj.Has("pageSize")) {
            auto value = obj.Get("pageSize").As<Napi::Number>();
            geom.pagesize = static_cast<intptr_t>(value.Int64Value());
        }
    }
    return geom;
}

env_arg0 envmou::parse(const Napi::Value& arg0)
{
	env_arg0 rc;

	auto obj = arg0.As<Napi::Object>();

	rc.path = obj.Get("path").As<Napi::String>().Utf8Value();
	if (obj.Has("maxDbi")) {
		auto value = obj.Get("maxDbi").As<Napi::Number>();
		rc.max_dbi = static_cast<MDBX_dbi>(value.Uint32Value());
	}

	if (obj.Has("maxReaders")) {
		auto value = obj.Get("maxReaders").As<Napi::Number>();
		rc.max_readers = value.Uint32Value();
	}

	if (obj.Has("geometry")) {
		rc.geom = parse_geometry(obj.Get("geometry"));
	}

	if (obj.Has("flags")) {
		rc.flag = env_flag::parse(obj.Get("flags"));
	}

	if (obj.Has("mode")) {
		auto value = obj.Get("mode").As<Napi::Number>();
		rc.file_mode = static_cast<mdbx_mode_t>(value.Int32Value());
	}

	if (obj.Has("keyFlag")) {
		rc.key_flag = base_flag::parse_key(obj.Get("keyFlag"));
	}

	if (obj.Has("valueFlag")) {
		rc.value_flag = base_flag::parse_value(obj.Get("valueFlag"));
	}

	if (obj.Has("trackBorrowedViews")) {
		auto value = obj.Get("trackBorrowedViews");
		// MDBXMOU-0001-S3-M3: explicit undefined keeps the optional default.
		if (!value.IsUndefined() && !value.IsBoolean()) {
			throw Napi::TypeError::New(
				obj.Env(), "trackBorrowedViews must be a boolean");
		}
		if (value.IsBoolean()) {
			rc.track_borrowed_views = value.As<Napi::Boolean>().Value();
		}
	}

	return rc;
}

Napi::Value envmou::open(const Napi::CallbackInfo& info)
{
    auto env = info.Env();

    try {
		auto arg0 = parse(info[0].As<Napi::Object>());
		std::unique_lock<envmou> lock{*this};

		if (is_open()) {
            throw std::runtime_error("already opened");
        }

		auto worker = std::make_unique<async_open>(
			info.This().As<Napi::Object>(), lock, arg0);
		auto promise = worker->GetPromise();
		worker->Queue();
#if defined(MDBXMOU_COPY_TESTING)
		auto* queued = worker.release();
		copy_test_after_queue(env, *queued);
#else
		worker.release();
#endif
		return promise;
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& e) {
		throw Napi::Error::New(env, e.what());
	}
}

Napi::Value envmou::open_sync(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto arg0 = parse(info[0].As<Napi::Object>());

    try {
        lock_guard l(*this);
        if (is_open()) {
            throw std::runtime_error("already opened");
        }
        attach(create_and_open(arg0), arg0);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }

    return env.Undefined();
}

MDBX_env* envmou::create_and_open(const env_arg0& arg0)
{
    MDBX_env *env;
    auto rc = mdbx_env_create(&env);
    if (rc != MDBX_SUCCESS) {
        throw std::runtime_error(mdbx_strerror(rc));
    }

    rc = mdbx_env_set_maxdbs(env, arg0.max_dbi);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    rc = mdbx_env_set_maxreaders(env, arg0.max_readers);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    auto& geom = arg0.geom;
    rc = mdbx_env_set_geometry(env, geom.size_lower, geom.size_now, 
        geom.size_upper, geom.growth_step, geom.shrink_threshold, geom.pagesize);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    // выдадим параметры mode, flag и id потока в котором открывается env
    rc = mdbx_env_open(env, arg0.path.c_str(), arg0.flag, arg0.file_mode);
    if (rc != MDBX_SUCCESS) {
        mdbx_env_close(env);
        throw std::runtime_error(mdbx_strerror(rc));
    }

    return env;
}

void envmou::attach(MDBX_env* env, const env_arg0& arg0)
{
	arg0_ = arg0;

	unsigned flags{};
	auto rc = mdbx_env_get_flags(env, &flags);
	if (rc != MDBX_SUCCESS) {
		mdbx_env_close(env);
		throw std::runtime_error(mdbx_strerror(rc));
	}
	arg0_.flag.val = static_cast<int>(flags);

	rc = mdbx_env_set_userctx(env, &arg0_);
	if (rc != MDBX_SUCCESS) {
		mdbx_env_close(env);
		throw std::runtime_error(mdbx_strerror(rc));
	}

	env_.reset(env);
}

Napi::Value envmou::close(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    try {
		std::unique_lock<envmou> lock{*this};

		if (!is_open()) {
            return env.Undefined();
        }

        if (trx_count_ > 0) {
            throw std::runtime_error("active transactions");
        }

		auto worker =
			std::make_unique<async_close>(info.This().As<Napi::Object>(), lock);
		auto promise = worker->GetPromise();
		worker->Queue();
#if defined(MDBXMOU_COPY_TESTING)
		auto* queued = worker.release();
		copy_test_after_queue(env, *queued);
#else
		worker.release();
#endif
		return promise;
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& e) {
		throw Napi::Error::New(env, e.what());
	}
}

Napi::Value envmou::close_sync(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    try {
        lock_guard l(*this);

        do_close();

    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
    return env.Undefined();
}

Napi::Value envmou::copy_to_sync(const Napi::CallbackInfo& info) 
{
    auto env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "expected a string argument for the destination path");
    }

    MDBX_copy_flags_t flags{MDBX_CP_COMPACT};
    if ((info.Length() > 1) && info[1].IsNumber()) {
        flags = static_cast<MDBX_copy_flags_t>(info[1].As<Napi::Number>().Uint32Value());
    }

    try {
        auto dest_path = info[0].As<Napi::String>().Utf8Value();

        lock_guard l(*this);

        check();

		if (is_copying()) {
			throw std::runtime_error("operation in progress");
		}

		auto rc = mdbx_env_copy(*this, dest_path.c_str(), flags);
        if (rc != MDBX_SUCCESS) {
            throw Napi::Error::New(env, mdbx_strerror(rc));
        }

	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& e) {
		throw Napi::Error::New(env, e.what());
	}

	return env.Undefined();
}

Napi::Value envmou::copy_to(const Napi::CallbackInfo& info) 
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "copyTo(path: string[, flags?: number]) -> Promise<void>");
    }

    MDBX_copy_flags_t flags{MDBX_CP_COMPACT};
    if (info.Length() > 1 && info[1].IsNumber()) {
        flags = static_cast<MDBX_copy_flags_t>(info[1].As<Napi::Number>().Uint32Value());
    }

    try {
        auto dest = info[0].As<Napi::String>().Utf8Value();

		lock_guard setup{*this};
		check();
		if (is_copying()) {
			throw std::runtime_error("operation in progress");
		}

		auto worker = std::make_unique<async_copy>(
			info.This().As<Napi::Object>(), *this, std::move(dest), flags);
		auto promise = worker->GetPromise();
		worker->Queue();
#if defined(MDBXMOU_COPY_TESTING)
		auto* queued = worker.release();
		copy_test_after_queue(env, *queued);
#else
		worker.release();
#endif
		return promise;
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& e) {
		throw Napi::Error::New(env, e.what());
	}
}

Napi::Value envmou::get_version(const Napi::CallbackInfo& info) 
{
    std::string version = "mdbx v" + std::to_string(MDBX_VERSION_MAJOR);
    version += "." + std::to_string(MDBX_VERSION_MINOR);
    return Napi::Value::From(info.Env(), version);
}

Napi::Value envmou::start_transaction(
	const Napi::CallbackInfo& info, txn_mode mode)
{
	auto env = info.Env();

	try {
		lock_guard l(*this);

		check();

		MDBX_txn* txn{};
		auto rc = mdbx_txn_begin(*this, nullptr, mode, &txn);
		if (rc != MDBX_SUCCESS) {
			throw Napi::Error::New(
				env, std::string("Env: ") + mdbx_strerror(rc));
		}
		std::unique_ptr<MDBX_txn, abort_transaction> txn_owner{txn};

		// Создаем новый объект txnmou
		auto txn_obj = addon_state::get(env).new_transaction();
		auto txn_wrapper = txnmou::Unwrap(txn_obj);
		txn_wrapper->attach(info.This().As<Napi::Object>(),
			txn_owner.get(),
			mode,
			arg0_.track_borrowed_views,
			(arg0_.flag.val & env_flag::writemap) != 0);
		txn_owner.release();

		return txn_obj;
	} catch (const std::exception& e) {
		throw Napi::Error::New(env, e.what());
	}
}

Napi::Value envmou::query(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    txn_mode mode{};

    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, "expected array of requests");
    }

    if (info.Length() > 1 || info[1].IsNumber()) {
        mode = txn_mode::parse(info[1].As<Napi::Number>());
    }

    try
    {
        lock_guard lock(*this);

        check();

        auto conf = get_env_userctx(*this);

        auto arg0 = info[0];
        query_request query = parse_query(mode, arg0);
		auto worker =
			std::make_unique<async_query>(info.This().As<Napi::Object>(),
				*this,
				mode,
				std::move(query),
				arg0.IsObject());
		auto promise = worker->GetPromise();
        worker->Queue();
#if defined(MDBXMOU_COPY_TESTING)
		auto* queued = worker.release();
		copy_test_after_queue(env, *queued);
#else
		worker.release();
#endif

		return promise;
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& e) {
		throw Napi::Error::New(env, e.what());
	} catch (...) {
		throw Napi::Error::New(env, "envmou::query");
	}
	return env.Undefined();
}

Napi::Value envmou::keys(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    txn_mode mode{};

    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, 
            "expected array of requests: [{ db: String, db_mode: Number, key_mode: Number, key_flag: Number, value_mode: Number, value_flag: Number }, ...]");
    }

    if (info.Length() > 1 || info[1].IsNumber()) {
        mode = txn_mode::parse(info[1].As<Napi::Number>());
    }

    try
    {
        lock_guard lock(*this);

        check();

        auto arg0 = info[0];
        keys_request query = parse_keys(arg0);

		auto worker =
			std::make_unique<async_keys>(info.This().As<Napi::Object>(),
				*this,
				mode,
				std::move(query),
				arg0.IsObject());
		auto promise = worker->GetPromise();
        worker->Queue();
#if defined(MDBXMOU_COPY_TESTING)
		auto* queued = worker.release();
		copy_test_after_queue(env, *queued);
#else
		worker.release();
#endif

		return promise;
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& e) {
		throw Napi::Error::New(env, e.what());
	} catch (...) {
		throw Napi::Error::New(env, "envmou::keys");
	}
	return env.Undefined();
}

Napi::Value envmou::set_option(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

	try {
		if (info.Length() < 2) {
			throw Napi::TypeError::New(env, "expected: option and value");
		}

		auto opt = evn_option::parse(info[0]);

		lock_guard lock(*this);

		check();
		if (is_copying()) {
			throw std::runtime_error("operation in progress");
		}

		uint64_t val = 0;
		if (static_cast<MDBX_option>(opt) == MDBX_opt_sync_period)
			val = parse_sync_period(env, info[1]);
		else
			val = parse_option_value(env, info[1]);

		auto rc = mdbx_env_set_option(*this, opt, val);
#if defined(MDBXMOU_TESTING)
		debug_writer_observe_env_call();
#endif
		if (rc != MDBX_SUCCESS) {
			throw Napi::Error::New(env, mdbx_strerror(rc));
		}

		return env.Undefined();
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& error) {
		throw Napi::Error::New(env, error.what());
	}
}

Napi::Value envmou::sync_ex(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

	try {
		if (info.Length() < 2) {
			throw Napi::TypeError::New(env, "expected: force and nonblock");
		}

		auto force = info[0].As<Napi::Boolean>().Value();
		auto nonblock = info[1].As<Napi::Boolean>().Value();

		lock_guard lock(*this);

		check();

		auto rc = mdbx_env_sync_ex(*this, force, nonblock);
#if defined(MDBXMOU_TESTING)
		debug_writer_observe_env_call();
#endif
		if (rc != MDBX_SUCCESS && rc != MDBX_RESULT_TRUE) {
			throw Napi::Error::New(env, mdbx_strerror(rc));
		}

		return Napi::Number::New(env, rc);
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& error) {
		throw Napi::Error::New(env, error.what());
	}
}

Napi::Value envmou::info(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	try {
		MDBX_txn* txn{};
		if (info.Length() > 0 && !info[0].IsUndefined()) {
			auto* wrapper = txnmou::unwrap_checked(env, info[0], "info");
			if (!wrapper->is_active()) {
				throw Napi::Error::New(env, "info: transaction is not active");
			}
			txn = *wrapper;
		}

		lock_guard lock(*this);

		check();
		if (txn && mdbx_txn_env(txn) != static_cast<MDBX_env*>(*this)) {
			throw Napi::Error::New(
				env, "info: transaction belongs to another environment");
		}

		MDBX_envinfo mi{};
		auto rc = mdbx_env_info_ex(*this, txn, &mi, sizeof(mi));
		if (rc != MDBX_SUCCESS) {
			throw Napi::Error::New(env, mdbx_strerror(rc));
		}
		return env_info_object(env, mi);
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& error) {
		throw Napi::Error::New(env, error.what());
	}
}

#if defined(MDBXMOU_TESTING)
Napi::Value envmou::debug_start_writer(const Napi::CallbackInfo& info)
{
	auto env = info.Env();
	try {
		std::uint32_t hold_ms{500};
		std::uint32_t publish_delay_ms{};
		bool commit{true};

		if (info.Length() > 0 && !info[0].IsUndefined()) {
			if (!info[0].IsObject()) {
				throw Napi::TypeError::New(
					env, "expected writer options object");
			}
			auto options = info[0].As<Napi::Object>();
			if (options.Has("holdMs")) {
				auto value = options.Get("holdMs");
				if (!value.IsNumber()) {
					throw Napi::TypeError::New(env, "holdMs must be a number");
				}
				hold_ms = value.As<Napi::Number>().Uint32Value();
				if (hold_ms == 0 || hold_ms > 10'000) {
					throw Napi::RangeError::New(
						env, "holdMs must be in range 1..10000");
				}
			}
			if (options.Has("publishDelayMs")) {
				auto value = options.Get("publishDelayMs");
				if (!value.IsNumber()) {
					throw Napi::TypeError::New(
						env, "publishDelayMs must be a number");
				}
				publish_delay_ms = value.As<Napi::Number>().Uint32Value();
				if (publish_delay_ms > 10'000) {
					throw Napi::RangeError::New(
						env, "publishDelayMs must be in range 0..10000");
				}
			}
			if (options.Has("commit")) {
				auto value = options.Get("commit");
				if (!value.IsBoolean()) {
					throw Napi::TypeError::New(env, "commit must be a boolean");
				}
				commit = value.As<Napi::Boolean>().Value();
			}
		}

		// MDBXMOU-0005-WRITER-ORACLE: lock only setup; the native writer must run
		// independently or the test hook would create the deadlock it detects.
		lock_guard lock{*this};
		check();
		if (!debug_writer_starting()) {
			throw Napi::Error::New(env, "debug writer is already active");
		}

		std::unique_ptr<debug_writer> worker;
		try {
			worker = std::make_unique<debug_writer>(env,
				*this,
				info.This().As<Napi::Object>(),
				hold_ms,
				publish_delay_ms,
				commit);
		} catch (...) {
			debug_writer_reset();
			throw;
		}
		++(*this);
		try {
			worker->Queue();
		} catch (...) {
			--(*this);
			debug_writer_reset();
			throw;
		}
		auto promise = worker->get_promise();
		worker.release();
		return promise;
	} catch (const Napi::Error&) {
		throw;
	} catch (const std::exception& error) {
		throw Napi::Error::New(env, error.what());
	}
}

Napi::Value envmou::debug_writer_state(const Napi::CallbackInfo& info)
{
	auto env = info.Env();
	const auto phase = debug_writer_phase_.load(std::memory_order_acquire);
	const auto observed_phase =
		debug_writer_observed_phase_.load(std::memory_order_acquire);
	const auto begin_rc =
		debug_writer_begin_rc_.load(std::memory_order_relaxed);
	const auto finish_rc =
		debug_writer_finish_rc_.load(std::memory_order_relaxed);
	auto result = Napi::Object::New(env);

	const auto phase_name = [](debug_writer_phase value) noexcept {
		switch (value) {
		case debug_writer_phase::starting: return "starting";
		case debug_writer_phase::ready: return "ready";
		case debug_writer_phase::finishing: return "finishing";
		case debug_writer_phase::finished: return "finished";
		case debug_writer_phase::idle: return "idle";
		}
		return "unknown";
	};
	result.Set("phase", phase_name(phase));
	result.Set("observedPhase", phase_name(observed_phase));
	result.Set("ready",
		phase == debug_writer_phase::ready ||
			phase == debug_writer_phase::finishing ||
			phase == debug_writer_phase::finished);
	result.Set("finished", phase == debug_writer_phase::finished);
	result.Set("beginCode", begin_rc);
	result.Set("finishCode", finish_rc);
	return result;
}

bool envmou::debug_writer_starting() noexcept
{
	auto phase = debug_writer_phase_.load(std::memory_order_acquire);
	while (phase == debug_writer_phase::idle ||
		phase == debug_writer_phase::finished) {
		if (debug_writer_phase_.compare_exchange_weak(phase,
				debug_writer_phase::starting,
				std::memory_order_acq_rel,
				std::memory_order_acquire)) {
			debug_writer_begin_rc_.store(
				MDBX_RESULT_TRUE, std::memory_order_relaxed);
			debug_writer_finish_rc_.store(
				MDBX_RESULT_TRUE, std::memory_order_relaxed);
			debug_writer_observed_phase_.store(
				debug_writer_phase::idle, std::memory_order_relaxed);
			return true;
		}
	}
	return false;
}

void envmou::debug_writer_ready(int rc) noexcept
{
	debug_writer_begin_rc_.store(rc, std::memory_order_relaxed);
	debug_writer_phase_.store(
		debug_writer_phase::ready, std::memory_order_release);
}

void envmou::debug_writer_finished(int rc) noexcept
{
	debug_writer_finish_rc_.store(rc, std::memory_order_relaxed);
	debug_writer_phase_.store(
		debug_writer_phase::finished, std::memory_order_release);
}

void envmou::debug_writer_finishing() noexcept
{
	debug_writer_phase_.store(
		debug_writer_phase::finishing, std::memory_order_release);
}

void envmou::debug_writer_observe_env_call() noexcept
{
	const auto phase = debug_writer_phase_.load(std::memory_order_acquire);
	debug_writer_observed_phase_.store(phase, std::memory_order_release);
}

void envmou::debug_writer_reset() noexcept
{
	debug_writer_phase_.store(
		debug_writer_phase::idle, std::memory_order_release);
}
#endif

} // namespace mdbxmou

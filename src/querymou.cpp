#include "querymou.hpp"
#include "dbimou.hpp"
#include <cmath>

namespace mdbxmou {

bool query_reference::parse(const Napi::Value& value)
{
	if (!value.IsObject() || value.IsBuffer() || value.IsArray()) {
		return false;
	}
	auto object = value.As<Napi::Object>();
	const bool has_pop = object.Has("pop");
	const bool has_peek = object.Has("peek");
	if (!has_pop && !has_peek) {
		return false;
	}
	if (has_pop && has_peek) {
		throw Napi::TypeError::New(
			value.Env(), "query operand requires exactly one of pop or peek");
	}
	auto names = object.GetPropertyNames();
	for (uint32_t i = 0; i < names.Length(); ++i) {
		auto name = names.Get(i).ToString().Utf8Value();
		if (name != (has_pop ? "pop" : "peek")) {
			throw Napi::TypeError::New(
				value.Env(), "query operand has an unknown property");
		}
	}
	if (has_pop) {
		auto flag = object.Get("pop");
		if (!flag.IsBoolean() || !flag.As<Napi::Boolean>().Value()) {
			throw Napi::TypeError::New(value.Env(), "query pop must be true");
		}
		op = operation::pop;
	} else {
		auto index = object.Get("peek");
		if (!index.IsNumber()) {
			throw Napi::TypeError::New(
				value.Env(), "query peek must be a non-negative safe integer");
		}
		const auto number = index.As<Napi::Number>().DoubleValue();
		if (!std::isfinite(number) || number < 0 ||
			std::floor(number) != number || number > 9007199254740991.0) {
			throw Napi::TypeError::New(
				value.Env(), "query peek must be a non-negative safe integer");
		}
		op = operation::peek;
		// Keep an out-of-range safe integer out of a narrow size_t cast.
		depth = number >= static_cast<double>(SIZE_MAX)
			? SIZE_MAX
			: static_cast<std::size_t>(number);
	}
	return true;
}

dbimou* async_common::parse(const Napi::Object& arg0, const char* method_name)
{
	auto dbi_value =
		dbimou::is_instance(arg0) ? Napi::Value{arg0} : arg0.Get("dbi");
	auto* dbi = dbimou::unwrap_checked(arg0.Env(), dbi_value, method_name);

	id = dbi->get_id();
	key_mod = dbi->get_key_mode();
	val_mod = dbi->get_value_mode();
	key_flag = dbi->get_key_flag();
	return dbi;
}

void async_key::parse(const async_common& common, const Napi::Value& item)
{
	keymou key{};
	if (mdbx::is_ordinal(common.key_mod)) {
		key = keymou::from(item, item.Env(), id_buf);
	} else if (item.IsBuffer()) {
		// Async query/keys must own the bytes before the worker is queued.
		key = keymou{item.As<Napi::Buffer<char>>(), key_buf};
	} else {
		key = keymou::from(item, item.Env(), key_buf);
	}
}

void async_keyval::parse(const query_line& common, const Napi::Object& item)
{
	auto key_value = item.Get("key");
	if (!key_source.parse(key_value)) {
		async_key::parse(common, key_value);
	}
	// проверяем надо ли что-то писать
	if (common.mode.is_write()) {
		valuemou val{};
		auto item_val = item.Get("value");
		if (value_source.parse(item_val)) {
			return;
		}
		val = is_ordinal(common.val_mod)
			? valuemou::from(item_val, item_val.Env(), val_num)
			: (common.value_flag & base_flag::string)
			? valuemou{item_val.As<Napi::String>(), item_val.Env(), val_buf}
			: valuemou{item_val.As<Napi::Buffer<char>>(), val_buf};
	}
}

void query_line::parse_bulk(txn_mode txn, const Napi::Object& obj)
{
	if (txn.val & txn_mode::ro)
		throw std::runtime_error("rw query in read-only transaction");
	async_common::parse(obj, "query bulk");
	bulk = std::make_unique<query_bulk>();
	auto& b = *bulk;
	const auto action = obj.Get("action");
	if (action.IsString() && action.As<Napi::String>().Utf8Value() == "range") {
		b.range = true;
	} else if (action.IsNumber()) {
		const auto n = action.As<Napi::Number>().DoubleValue();
		if (!std::isfinite(n) || std::trunc(n) != n ||
			n < MDBX_DELETE_CURRENT_VALUE || n > MDBX_DELETE_WHOLE)
			throw std::runtime_error("query bulk invalid action");
		b.action = static_cast<MDBX_bunch_action_t>(n);
	} else {
		throw std::runtime_error("query bulk invalid action");
	}
	const auto names = obj.GetPropertyNames();
	for (std::uint32_t i = 0; i < names.Length(); ++i) {
		const auto name = names.Get(i).ToString().Utf8Value();
		const bool common = name == "op" || name == "dbi" || name == "action" ||
			name == "result" || name == "push" || name == "when";
		const bool specific = b.range
			? name == "from" || name == "to" || name == "includeFrom" ||
				name == "includeTo"
			: b.action != MDBX_DELETE_WHOLE && name == "key";
		if (!common && !specific)
			throw std::runtime_error("query bulk unknown property");
	}
	auto flag = [&](const char* name, bool& target) {
		if (!obj.Has(name)) return;
		const auto value = obj.Get(name);
		if (!value.IsBoolean())
			throw std::runtime_error("query bulk flag must be boolean");
		target = value.As<Napi::Boolean>().Value();
	};
	flag("result", return_result);
	flag("includeFrom", b.include_from);
	flag("includeTo", b.include_to);
	auto input = [&](const char* name, async_keyval& target, bool optional) {
		if (!obj.Has(name)) {
			if (optional) return false;
			throw std::runtime_error("query bulk requires key");
		}
		const auto value = obj.Get(name);
		if (optional && value.IsNull()) return false;
		if (value.IsUndefined() || value.IsNull())
			throw std::runtime_error("query bulk invalid key or bound");
		auto wrapped = Napi::Object::New(obj.Env());
		wrapped.Set("key", value);
		target.parse(*this, wrapped);
		return true;
	};
	if (b.range) {
		b.has_from = input("from", b.from, true);
		b.has_to = input("to", b.to, true);
	} else if (b.action != MDBX_DELETE_WHOLE) {
		b.has_from = input("key", b.from, false);
	}
	if (obj.Has("push")) {
		const auto value = obj.Get("push");
		if (!value.IsArray())
			throw std::runtime_error("query bulk push must be a field array");
		const auto list = value.As<Napi::Array>();
		const char* fields[] = {
			"count", "firstKey", "firstValue", "lastKey", "lastValue"};
		for (std::uint32_t i = 0; i < list.Length(); ++i) {
			const auto value = list.Get(i);
			if (!value.IsString())
				throw std::runtime_error("query bulk unknown output field");
			const auto name = value.As<Napi::String>().Utf8Value();
			std::size_t field = 0;
			while (field < query_bulk::fields && name != fields[field])
				++field;
			if (field == query_bulk::fields)
				throw std::runtime_error("query bulk unknown output field");
			b.outputs.push_back(field);
		}
	}
	item.resize(query_bulk::fields);
}

void query_line::parse(txn_mode txn, const Napi::Object& arg0)
{
	if (arg0.Has("when") && !arg0.Get("when").IsUndefined())
		throw std::runtime_error("query when is not supported");
	const bool has_op = arg0.Has("op");
	std::string name;
	if (has_op) {
		const auto value = arg0.Get("op");
		if (!value.IsString())
			throw std::runtime_error("query op must be a string");
		name = value.As<Napi::String>().Utf8Value();
		if (name == "bulk") {
			parse_bulk(txn, arg0);
			return;
		}
	}
	if (has_op) throw std::runtime_error("unsupported query operation");
	//  парсим общие параметры
	auto dbi = async_common::parse(arg0, "query");
	value_flag = dbi->get_value_flag();
	if (arg0.Has("mode")) {
		mode = query_mode::parse(txn, arg0.Get("mode").As<Napi::Number>());
	} else if (arg0.Has("queryMode")) {
		mode = query_mode::parse(txn, arg0.Get("queryMode").As<Napi::Number>());
	}
	return_result = mode.is_write() ? kWriteResultDefault : true;
	if (arg0.Has("push")) {
		auto flag = arg0.Get("push");
		if (!flag.IsUndefined()) {
			if (!flag.IsBoolean()) {
				throw Napi::TypeError::New(
					arg0.Env(), "query push must be a boolean");
			}
			push = flag.As<Napi::Boolean>().Value();
			if (push && !mode.is_get()) {
				throw Napi::TypeError::New(
					arg0.Env(), "query push requires get queryMode");
			}
		}
	}
	if (arg0.Has("putFlag")) {
		put_flags = put_flag::parse_query(arg0.Get("putFlag"));
		if (!mode.is_write()) {
			throw Napi::TypeError::New(
				arg0.Env(), "query putFlag requires write queryMode");
		}
	}
	if (arg0.Has("result")) {
		auto result = arg0.Get("result");
		if (!result.IsUndefined()) {
			if (!result.IsBoolean()) {
				throw Napi::TypeError::New(
					arg0.Env(), "query result must be a boolean");
			}
			return_result = result.As<Napi::Boolean>().Value();
		}
	}
	auto items_array = arg0.Get("item").As<Napi::Array>();
	auto item_len = items_array.Length();
	if (item_len > 0) {
		item.reserve(item_len);
		for (uint32_t i = 0; i < item_len; ++i) {
			auto item_obj = items_array.Get(i).As<Napi::Object>();
			async_keyval keyval{};
			keyval.parse(*this, item_obj);
			item.emplace_back(std::move(keyval));
		}
	}
}

static void bind_query_references(query_request& query, Napi::Env env)
{
	std::vector<std::pair<std::size_t, std::size_t>> stack;
	auto bind = [&](query_reference& source) {
		if (!source.active()) {
			return;
		}
		if (source.depth >= stack.size()) {
			throw Napi::TypeError::New(env, "query stack underflow");
		}
		const auto& producer = stack[stack.size() - 1 - source.depth];
		source.row = producer.first;
		source.item = producer.second;
		query[source.row].item[source.item].referenced = true;
		if (source.op == query_reference::operation::pop) {
			stack.pop_back();
		}
	};
	for (std::size_t r = 0; r < query.size(); ++r) {
		auto& row = query[r];
		if (row.bulk) {
			for (auto* operand : {&row.bulk->from, &row.bulk->to}) {
				bind(operand->key_source);
			}
			for (auto field : row.bulk->outputs)
				stack.emplace_back(r, field);
			continue;
		}
		for (std::size_t i = 0; i < row.item.size(); ++i) {
			auto& item = row.item[i];
			bind(item.key_source);
			bind(item.value_source);
			if (row.push) {
				stack.emplace_back(r, i);
			}
		}
	}
}

query_request parse_query(txn_mode txn, const Napi::Value& arg0)
{
	query_request rc{};
	if (arg0.IsArray()) {
		auto arr = arg0.As<Napi::Array>();
		rc.reserve(arr.Length());
		for (uint32_t i = 0; i < arr.Length(); ++i) {
			query_line row{};
			row.parse(txn, arr.Get(i).As<Napi::Object>());
			rc.push_back(std::move(row));
		}
	} else if (arg0.IsObject()) {
		query_line row{};
		row.parse(txn, arg0.As<Napi::Object>());
		rc.push_back(std::move(row));
	} else {
		throw Napi::TypeError::New(
			arg0.Env(), "Expected array or object for query");
	}
	bind_query_references(rc, arg0.Env());
	return rc;
}

void keys_line::parse(const Napi::Object& arg0)
{
	// парсим общие параметры
	async_common::parse(arg0, "keys");

	// парсим параметры scan_from
	if (arg0.Has("from")) {
		keymou key{};
		has_from_key = true;
		async_key::parse(*this, arg0.Get("from"));
	}

	if (arg0.Has("limit")) {
		auto limit_val = arg0.Get("limit");
		if (limit_val.IsNumber()) {
			limit = limit_val.As<Napi::Number>().Uint32Value();
		}
	}

	if (arg0.Has("cursorMode")) {
		cursor_mode = parse_cursor_mode(arg0.Get("cursorMode"));
	}
}

keys_request parse_keys(const Napi::Value& obj)
{
	keys_request rc{};
	if (obj.IsArray()) {
		auto arr = obj.As<Napi::Array>();
		rc.reserve(arr.Length());
		for (uint32_t i = 0; i < arr.Length(); ++i) {
			keys_line row{};
			row.parse(arr.Get(i).As<Napi::Object>());
			rc.push_back(std::move(row));
		}
	} else if (obj.IsObject()) {
		keys_line row{};
		row.parse(obj.As<Napi::Object>());
		rc.push_back(std::move(row));
	} else {
		throw Napi::TypeError::New(
			obj.Env(), "Expected array or object for query");
	}
	return rc;
}

}  // namespace mdbxmou

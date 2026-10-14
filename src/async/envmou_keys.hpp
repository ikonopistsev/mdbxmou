#pragma once

#include "querymou.hpp"

namespace mdbxmou {

class envmou;

class async_keys final : public Napi::AsyncWorker
{
	Napi::Promise::Deferred deferred_;
	envmou* env_{};
	txn_mode txn_mode_{};
	// действия для выполнения
	keys_request query_{};
	// упрощенный режим 1 массив
	bool single_{false};

	void finish() noexcept;

public:
	async_keys(const Napi::Object& receiver,
		envmou& owner,
		txn_mode txn_mode,
		keys_request query,
		bool single = false);
	~async_keys() override;

	void OnWorkComplete(Napi::Env env, napi_status status) override;

	void Execute() override;

	void OnOK() override;

	void OnError(const Napi::Error& e) override;

	Napi::Promise GetPromise() const
	{
		return deferred_.Promise();
	}

	txnmou_managed start_transaction();

	void do_keys(txnmou_managed& txn, mdbx::map_handle dbi, keys_line& arg0);

	void do_keys_batch(
		txnmou_managed& txn, mdbx::map_handle dbi, keys_line& arg0);

	void do_keys_from(
		txnmou_managed& txn, mdbx::map_handle dbi, keys_line& arg0);
};

}  // namespace mdbxmou

#include <mdbx.h++>

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using clock_type = std::chrono::steady_clock;

constexpr std::uint64_t map_size = 4ULL * 1024 * 1024 * 1024;
constexpr std::intptr_t page_size = 4096;

enum class write_mode { commit, checkpoint };

struct interval_result {
	double elapsed_seconds{};
	std::uint64_t next_value{};
	std::uint64_t writes{};
	std::uint64_t transactions{};
};

struct benchmark_result {
	write_mode mode{};
	std::size_t batch_size{};
	double elapsed_seconds{};
	std::uint64_t writes{};
	double writes_per_second{};
	std::uint64_t transactions{};
	double transactions_per_second{};
};

const char* mode_name(write_mode mode)
{
	return mode == write_mode::commit ? "commit" : "checkpoint";
}

double env_seconds(const char* name, double fallback)
{
	const char* text = std::getenv(name);
	if (!text) {
		return fallback;
	}
	const double value = std::stod(text);
	if (!std::isfinite(value) || value <= 0) {
		throw std::invalid_argument(std::string(name) + " must be positive");
	}
	return value;
}

std::vector<std::size_t> batch_sizes()
{
	return {50, 100, 150, 200, 250, 300, 350};
}

void write_batch(mdbx::txn& transaction,
	mdbx::map_handle database,
	std::uint64_t& value,
	std::size_t batch_size)
{
	for (std::size_t index = 0; index < batch_size; ++index) {
		transaction.put(database,
			mdbx::slice::wrap(value),
			mdbx::slice::wrap(value),
			mdbx::put_mode::upsert);
		++value;
	}
}

interval_result write_until(mdbx::env_managed& environment,
	mdbx::map_handle database,
	std::uint64_t first_value,
	double run_seconds,
	write_mode mode,
	std::size_t batch_size,
	mdbx::txn_managed* checkpoint_transaction)
{
	const auto started = clock_type::now();
	const auto deadline = started + std::chrono::duration<double>(run_seconds);
	std::uint64_t value = first_value;
	std::uint64_t transactions = 0;

	do {
		if (mode == write_mode::commit) {
			auto transaction = environment.start_write();
			write_batch(transaction, database, value, batch_size);
			transaction.commit();
		} else {
			if (!checkpoint_transaction) {
				throw std::logic_error("checkpoint transaction is missing");
			}
			write_batch(*checkpoint_transaction, database, value, batch_size);
			if (checkpoint_transaction->checkpoint()) {
				throw std::runtime_error("dirty checkpoint returned no-op");
			}
		}
		++transactions;
	} while (clock_type::now() < deadline);

	const double elapsed =
		std::chrono::duration<double>(clock_type::now() - started).count();
	return {elapsed, value, value - first_value, transactions};
}

mdbx::env::operate_parameters operate_parameters()
{
	mdbx::env::operate_options options;
	options.exclusive = true;
	options.disable_clear_memory = true;
	return {2,
		2,
		mdbx::env::mode::write_mapped_io,
		mdbx::env::durability::whole_fragile,
		mdbx::env::reclaiming_options(),
		options};
}

MDBX_env_flags_t expected_flags()
{
	return static_cast<MDBX_env_flags_t>(
		MDBX_EXCLUSIVE | MDBX_WRITEMAP | MDBX_NOMEMINIT | MDBX_UTTERLY_NOSYNC);
}

benchmark_result run_mode(const std::filesystem::path& root,
	write_mode mode,
	std::size_t batch_size,
	double warmup_seconds,
	double duration_seconds)
{
	const auto suffix = clock_type::now().time_since_epoch().count();
	const std::string directory_name = std::string("mdbx-cpp-") +
		mode_name(mode) + "-bench-" + std::to_string(suffix) + "-" +
		std::to_string(batch_size);
	const auto database_path = root / directory_name;
	std::filesystem::remove_all(database_path);
	std::filesystem::create_directory(database_path);

	try {
		mdbx::env_managed::create_parameters create_parameters;
		create_parameters.use_subdirectory = true;
		create_parameters.file_mode_bits = 0664;
		create_parameters.geometry =
			mdbx::env::geometry(mdbx::env::geometry::default_value,
				static_cast<std::intptr_t>(map_size),
				static_cast<std::intptr_t>(map_size),
				0,
				0,
				page_size);

		const auto operation = operate_parameters();
		const auto configured_flags = operation.make_flags(false, true);
		if (configured_flags != expected_flags()) {
			throw std::logic_error("C++ environment flags do not match JS");
		}

		mdbx::env_managed environment(
			database_path.string(), create_parameters, operation, false);
		const auto opened_flags = environment.get_flags();
		if ((opened_flags & expected_flags()) != expected_flags()) {
			std::string message = "opened environment flags changed: expected=";
			message +=
				std::to_string(static_cast<std::uint32_t>(expected_flags()));
			message += " actual=";
			message += std::to_string(static_cast<std::uint32_t>(opened_flags));
			throw std::logic_error(message);
		}

		auto setup_transaction = environment.start_write();
		const auto database = setup_transaction.create_map(
			"numbers", mdbx::key_mode::ordinal, mdbx::value_mode::single);
		setup_transaction.commit();

		mdbx::txn_managed checkpoint_transaction;
		mdbx::txn_managed* checkpoint_pointer = nullptr;
		if (mode == write_mode::checkpoint) {
			checkpoint_transaction = environment.start_write();
			checkpoint_pointer = &checkpoint_transaction;
		}

		const auto warmup = write_until(environment,
			database,
			0,
			warmup_seconds,
			mode,
			batch_size,
			checkpoint_pointer);
		const auto measured = write_until(environment,
			database,
			warmup.next_value,
			duration_seconds,
			mode,
			batch_size,
			checkpoint_pointer);

		if (checkpoint_pointer) {
			checkpoint_transaction.abort();
		}

		auto read_transaction = environment.start_read();
		const auto entries = read_transaction.get_map_stat(database).ms_entries;
		const std::uint64_t last_key = measured.next_value - 1;
		const std::uint64_t last_value =
			read_transaction.get(database, mdbx::slice::wrap(last_key))
				.as_uint64();
		read_transaction.commit();

		if (entries != measured.next_value) {
			throw std::runtime_error("entry count verification failed");
		}
		if (last_value != last_key) {
			throw std::runtime_error("last value verification failed");
		}

		environment.close(true);
		std::filesystem::remove_all(database_path);

		return {mode,
			batch_size,
			measured.elapsed_seconds,
			measured.writes,
			measured.writes / measured.elapsed_seconds,
			measured.transactions,
			measured.transactions / measured.elapsed_seconds};
	} catch (...) {
		std::filesystem::remove_all(database_path);
		throw;
	}
}

std::uint64_t rounded(double value)
{
	return static_cast<std::uint64_t>(std::llround(value));
}

}  // namespace

int main(int argc, char** argv)
{
	try {
		const std::filesystem::path root = argc > 1 ? argv[1] : "/tmp";
		const double warmup_seconds = env_seconds("BENCH_WARMUP_SECONDS", 1.0);
		const double duration_seconds =
			env_seconds("BENCH_DURATION_SECONDS", 10.0);
		const auto batches = batch_sizes();
		std::vector<benchmark_result> results;
		results.reserve(batches.size() * 2);

		std::cout << "root=" << root << " flags=0x" << std::hex
				  << static_cast<std::uint32_t>(expected_flags()) << std::dec
				  << " map=" << map_size << " page=" << page_size << '\n';

		for (const auto batch_size : batches) {
			for (const auto mode :
				{write_mode::commit, write_mode::checkpoint}) {
				const auto result = run_mode(
					root, mode, batch_size, warmup_seconds, duration_seconds);
				results.push_back(result);
				std::cout << "batch=" << batch_size << ' ' << mode_name(mode)
						  << ": " << rounded(result.writes_per_second)
						  << " writes/sec, "
						  << rounded(result.transactions_per_second) << ' '
						  << (mode == write_mode::commit ? "transactions"
														 : "checkpoints")
						  << "/sec (" << result.writes << " writes in "
						  << std::fixed << std::setprecision(3)
						  << result.elapsed_seconds << " s)\n";
			}
		}

		std::cout << "\nsummary\n"
				  << "batch\tcommit writes/s\tcommit tx/s\t"
					 "checkpoint writes/s\tcheckpoint/s\tdelta\n";
		for (std::size_t index = 0; index < results.size(); index += 2) {
			const auto& committed = results[index];
			const auto& checkpointed = results[index + 1];
			const double delta =
				(checkpointed.writes_per_second / committed.writes_per_second -
					1) *
				100;
			std::cout << committed.batch_size << '\t'
					  << rounded(committed.writes_per_second) << '\t'
					  << rounded(committed.transactions_per_second) << '\t'
					  << rounded(checkpointed.writes_per_second) << '\t'
					  << rounded(checkpointed.transactions_per_second) << '\t'
					  << std::showpos << std::fixed << std::setprecision(2)
					  << delta << "%\n"
					  << std::noshowpos;
		}
		return EXIT_SUCCESS;
	} catch (const std::exception& error) {
		std::cerr << "benchmark failed: " << error.what() << '\n';
		return EXIT_FAILURE;
	}
}

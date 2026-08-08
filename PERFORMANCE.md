---
title: mdbxmou getView Performance Report
status: completed
area: mdbxmou
tags:
  - mdbxmou
  - getview
  - performance
updated_at: 2026-08-08
---

# `getView()` Performance Report

Read the caller-owned lifetime and safety contract in
[GETVIEW.md](GETVIEW.md) before using this API in production.

## Executive Summary

The benchmark compared copied `get()` reads with two `getView()` modes:

- **Tracked mode** is the safe default (`trackBorrowedViews: true`). The
  transaction tracks borrowed buffers and detaches them before `commit()` or
  `abort()` releases the MDBX snapshot.
- **Untracked mode** is an unsafe opt-out (`trackBorrowedViews: false`). It
  removes reference tracking and detach work; the caller must discard every
  view before transaction completion and must never access it afterward.

The production benchmark ran on Linux x64 with Node.js 26 and warm values from
4 KiB to 8 MiB. It measured partial access to eight bytes, a full JavaScript
checksum over every byte, and transaction completion with up to 100,000 live
views.

**Conclusion:** use `get()` by default. `getView()` is valuable when an
application reads only a small part of a large binary value. It does not make
the application's parsing or business logic faster. When every byte is read,
JavaScript processing and memory bandwidth dominate, so the zero-copy gain is
usually modest and can be negative for small values. In this baseline the
4 KiB tracked partial read reached `0.93x` of `get()`, while the untracked full
checksum reached `0.50 GiB/s` against `0.94 GiB/s` for `get()`. Keep tracked
mode enabled unless a concrete hot path has been measured and can satisfy the
stricter untracked lifetime contract.

### Partial Read: Eight Bytes per Value

Ratios are relative to copied `get()` throughput; values above `1.00x` are
faster.

| Value | Tracked / `get()` | Untracked / `get()` |
|---:|---:|---:|
| 4 KiB | 0.93x | 1.16x |
| 16 KiB | 1.68x | 1.75x |
| 64 KiB | 2.79x | 2.53x |
| 256 KiB | 9.19x | 7.66x |
| 1 MiB | 3.25x | 3.18x |
| 8 MiB | 78.18x | 66.14x |

### Full Read: JavaScript Checksum

| Value | `get()` GiB/s | Tracked GiB/s | Untracked GiB/s |
|---:|---:|---:|---:|
| 4 KiB | 0.94 | 0.92 | 0.50 |
| 16 KiB | 0.53 | 0.55 | 0.55 |
| 64 KiB | 0.55 | 0.56 | 0.56 |
| 256 KiB | 0.55 | 0.56 | 0.56 |
| 1 MiB | 0.52 | 0.56 | 0.56 |
| 8 MiB | 0.47 | 0.56 | 0.57 |

With 100,000 live 4 KiB views, tracked issuance reached approximately
0.79 million views/s and transaction completion detached all buffers in
9.49 ms. Untracked completion took approximately 0.006 ms, but provides no
runtime invalidation. These figures are a reproducible baseline, not an SLA or
a future capacity estimate.

## Подробный Отчет На Русском

### Термины И Примечания

- **Checksum** в этом отчете - не криптографический hash, а сложение всех байтов
  value в `uint32`. Операция заставляет JavaScript прочитать весь payload и
  позволяет сравнить результат с заранее рассчитанным значением.

## Зачем Выполнялся Тест

Stage 5 должен был ответить на четыре ограниченных вопроса:

1. Устраняет ли `getView()` цену полного копирования, когда нужны только
   несколько байт большого value.
2. Остается ли польза, когда приложение фактически читает весь payload.
3. Какова наблюдаемая цена safe-default tracking и detach относительно явного
   untracked режима.
4. Не скрывает ли benchmark ошибку данных ради высокой скорости.

Это не capacity test betting-платформы и не сравнение с `mmap-cache`. Dataset
больше RAM, random/Zipf/sequential workloads, несколько reader processes,
page faults, LLC misses и конкурентный writer относятся к будущему расширенному
benchmark-сравнению `mmap-cache` и `mdbxmou`.

## Проверенный Snapshot

- Ветка: `feature/0001-mdbxmou-getview`.
- Base commit до Stage 5: `97db47a395d3f7c312253bc50f27e5e8b951c026`.
- Production build: `MDBXMOU_TESTING=OFF`, ASan/UBSan отключены.
- Runner: [test/stage5-benchmark.js](test/stage5-benchmark.js), SHA-256
  `dce54ea33c0019b7801b6082421bdd8c145e8170557a97a099ce7de2a7e2813b`.
- Raw JSON verification artifact не входит в npm package; SHA-256 исходного
  результата, по которому составлены таблицы:
  `66c3213ade9a45e77ae4abf824603f3f8b7c86421b621b2354346897404d6ada`.

## Запуск

Сначала соберите production addon, затем запустите benchmark с открытым GC:

```bash
npm run build
npm run benchmark:stage5
```

По умолчанию итоговый JSON выводится в stdout. Для записи в файл задайте
`STAGE5_OUTPUT`; размеры, число samples и lifecycle matrix настраиваются через
переменные `STAGE5_*`, перечисленные в начале runner.

## Стенд

| Параметр | Значение |
|---|---|
| OS | Linux `6.18.30`, x64 |
| CPU | AMD Ryzen 9 7900X, 12 cores / 24 logical CPUs |
| RAM | 66 595 618 816 bytes |
| Node.js | `26.3.0` |
| N-API runtime | `10`; addon contract собран с `NAPI_VERSION=8` |
| libmdbx | bundled `0.14.2` |
| Residency | warm |
| Processes | один reader process |

CPU affinity, real-time scheduling и изоляция host не применялись. Результат
описывает этот запуск и не является обещанием нагрузки через 1-2 года.

## Методика

### Throughput

- Размеры value: 4 KiB, 16 KiB, 64 KiB, 256 KiB, 1 MiB и 8 MiB.
- Режимы: копирующий `get()`, tracked `getView()` и untracked `getView()`.
- `get()` возвращает готовый `Buffer`, а для каждого результата `getView()`
  runner внутри измеряемого цикла создает новый `Uint8Array` над borrowed
  backing buffer. Эта дополнительная аллокация включена в результат и
  консервативно снижает показатели `getView()`, особенно на малых values.
- Доступ `touch8`: восемь равномерно расположенных байт по всему value.
- Доступ `checksum`: последовательное суммирование каждого байта в JavaScript;
  это проверочная `uint32`-сумма, а не криптографический алгоритм.
- Для каждого case: один warm-up и пять измеряемых samples.
- Один read transaction создается на sample; read loop и `abort()` измеряются
  отдельно.
- Число операций адаптируется к payload: target 256 MiB для `touch8` и 64 MiB
  для checksum, с границами 8-100 000 операций.
- Явный GC внутри throughput cases не вызывается, чтобы не подменять обычное
  поведение runtime искусственными паузами.

`p50`/`p99` latency в raw JSON - процентили средней latency операции внутри
каждого sample. При пяти samples `p99` практически равен худшему sample и не
является настоящей per-request tail latency.

### Transaction Lifecycle

- Value фиксирован на 4 KiB.
- Transaction выдает 1, 10, 1 000 или 100 000 views.
- Target retention равен 0%, 1% или 100%. Точное число объектов вычисляется как
  `round(count * targetFraction)`, а raw JSON отдельно сохраняет достигнутую
  долю. Поэтому 1% для count 1 и 10 означает 0 объектов, для 1 000 - 10, для
  100 000 - 1 000.
- Для каждой комбинации выполняются три samples.
- До выдачи, перед completion и после очистки выполняются три явных GC turns.
- Отдельно измеряются issue throughput, GC time, transaction completion и
  изменения `process.memoryUsage()`.

В untracked mode retained objects учитываются для сопоставимой нагрузки, затем
все ссылки отбрасываются до GC и `abort()`. После completion к untracked view
обращений нет. В tracked mode весь retained-набор читается после
pre-completion GC, остается наблюдаемо живым во время `abort()`, а после него
каждый backing ArrayBuffer проверяется на detach.

## Как Проверялись Данные

Для каждого размера runner создает детерминированный payload и сохраняет его в
отдельный MDBX map. До измерения по исходному Buffer вычисляются ожидаемые
`touch8` и full checksum.

Каждый измеряемый sample:

1. читает value выбранным API;
2. фактически выполняет `touch8` или checksum, поэтому JIT не может просто
   удалить чтение как неиспользуемое;
3. накапливает результат всех iterations в `uint32`-совместимой арифметике;
4. сравнивает итог с заранее рассчитанным значением через strict assertion;
5. только после успешной проверки завершает read transaction.

Lifecycle cases дополнительно проверяют, что **каждый** retained tracked
backing ArrayBuffer имеет `byteLength === 0` после `abort()`. Fixture setup,
transaction и удаление временных каталогов защищены cleanup paths; исходная
ошибка не заменяется ошибкой очистки. Untracked case следует своему контракту:
удаляет ссылки до completion и никогда не читает освобожденный pointer.
Некорректная env-конфигурация benchmark, например
`STAGE5_SIZES=4096,bad`, завершается ошибкой вместо молчаливого изменения
матрицы.

## Partial Read: `touch8`

Все значения - p50 одного итогового запуска.

| Value | `get()` ops/s | tracked ops/s | tracked / `get()` | untracked ops/s | untracked / `get()` |
|---:|---:|---:|---:|---:|---:|
| 4 KiB | 907 750 | 845 953 | 0.93x | 1 054 652 | 1.16x |
| 16 KiB | 606 480 | 1 018 336 | 1.68x | 1 062 183 | 1.75x |
| 64 KiB | 245 421 | 683 975 | 2.79x | 621 030 | 2.53x |
| 256 KiB | 36 386 | 334 269 | 9.19x | 278 681 | 7.66x |
| 1 MiB | 26 754 | 86 980 | 3.25x | 85 135 | 3.18x |
| 8 MiB | 350 | 27 335 | 78.18x | 23 126 | 66.14x |

В этом сценарии `get()` обязан скопировать весь value, хотя consumer использует
только восемь байт. Поэтому выигрыш `getView()` в целом растет с payload. Это и
есть основной целевой сценарий zero-copy API.

Tracked и untracked результаты местами меняются местами. Разница невелика по
сравнению с выигрышем относительно копирования и чувствительна к JIT, GC,
mapping и порядку samples. Делать вывод, что tracked систематически быстрее
untracked, по этому baseline нельзя.

## Full Read: Контрольная Сумма

Здесь useful GiB/s равен реально прочитанному payload throughput.

| Value | `get()` GiB/s | tracked GiB/s | untracked GiB/s |
|---:|---:|---:|---:|
| 4 KiB | 0.94 | 0.92 | 0.50 |
| 16 KiB | 0.53 | 0.55 | 0.55 |
| 64 KiB | 0.55 | 0.56 | 0.56 |
| 256 KiB | 0.55 | 0.56 | 0.56 |
| 1 MiB | 0.52 | 0.56 | 0.56 |
| 8 MiB | 0.47 | 0.56 | 0.57 |

Полная контрольная сумма в этом запуске ограничена JavaScript-циклом и
пропускной способностью памяти примерно на уровне `0.47-0.94 GiB/s`. Отдельно
выделяется 4 KiB untracked: `0.50 GiB/s` против `0.94 GiB/s` у `get()`. На
результат могли повлиять wrapper allocation, mappings, порядок samples и шум
запуска, но baseline не гарантирует выигрыш на малых values. Zero-copy
сохраняет умеренный выигрыш на больших values, потому что убирает copy-out, но
не сам проход по bytes.

## Tracking И Completion

Наиболее показателен case 100 000 views по 4 KiB:

| Mode | Retained | Issue ops/s | Completion p50 | GC p50 |
|---|---:|---:|---:|---:|
| tracked | 0 | 957 500 | 0.107 ms | 9.08 ms |
| tracked | 1 000 | 948 437 | 0.315 ms | 9.12 ms |
| tracked | 100 000 | 794 486 | 9.493 ms | 17.53 ms |
| untracked | 0 | 1 039 735 | 0.006 ms | 8.21 ms |
| untracked | 1 000 | 1 025 771 | 0.006 ms | 8.92 ms |
| untracked | 100 000 | 801 804 | 0.006 ms | 15.06 ms |

Tracked completion растет с числом живых buffers, потому что каждый из них
нужно detach. Даже максимальный проверенный case завершился за `9.49 ms`.
Untracked completion практически не зависит от числа ранее выданных views, но
безопасность после transaction end полностью остается обязанностью caller.

## Memory Observation

При 100 000 живых views по 4 KiB V8 показал рост `external` ровно
`409 600 000` bytes и в tracked, и в untracked mode. Это сумма заявленных
размеров всех external ArrayBuffers, а не объем уникально выделенной памяти:
views указывают на уже существующее MDBX mapping.

После pre-completion GC tracked mode по-прежнему показывал все
`409 600 000` bytes, потому что 100 000 views оставались живыми; после detach
значение стало нулевым. Untracked mode удалил ссылки до GC, поэтому перед
completion значение уже было нулевым.

Медианный прирост RSS после выдачи составил около `1.23 MiB` для tracked и
`1.31 MiB` для untracked, heap - около `23 MiB` в обоих режимах. Следовательно,
`external` нельзя трактовать как реальное дополнительное потребление RAM.
Однако V8 может использовать этот accounting как сигнал для GC, поэтому
поведение важно отдельно проверить под длительной смешанной нагрузкой.

## Ограничения

- Измерен только Linux x64 и Node 26 production build.
- Dataset маленький и warm; storage/page-fault поведение не измерялось.
- Tracked и untracked fixtures используют разные environments, temporary
  files и MDBX mappings и создаются в фиксированном порядке tracked, затем
  untracked, поскольку tracking задается на уровне environment. Поэтому этот
  baseline не изолирует цену tracking от влияния mapping, cache и порядка.
- Повторяется один key, один process и один read transaction на sample.
- Нет конкурентного writer, нескольких readers и snapshot renewal.
- Payload детерминированный и простой; полноценный benchmark `0002` должен
  использовать воспроизводимый PRNG и несжимаемые values.
- Нет CPU pinning, host isolation и hardware counters.
- RSS/external measurements - process-level observations с GC noise, не точный
  allocation profiler.
- Пять samples достаточны для baseline, но не для SLA или tail-latency выводов.
- `getInto()` пока отсутствует и не сравнивался.
- Никакой performance threshold не применялся и regression budget пока не
  устанавливается.

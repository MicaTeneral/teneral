# Minimal Bun binding: loopback IPC scalar milestone

`evalRayforce(port, trustedRfl, timeoutMs?)` in rayforce.ts connects only to
127.0.0.1, uses wire v3, evaluates one synchronous request, then disconnects.
No native addon/compiler needed. No server is launched by the binding.

Verified locally against official Rayforce v3.0.2 Linux x86_64 release:
archive SHA256 ea20fd48a223ffb3ed3e37a5edcb8a7caf5c5199d4cc8ba4e072d0c21e4a57b7
matches published checksum. Download is disposable /tmp/mica-ray-bin, not a
committed dependency. This is NOT validation against source HEAD c3353ff.

Start a synthetic server explicitly with:
`rayforce -p 127.0.0.1:19761 -c 1`
Then import evalRayforce from Bun. Observed actual results:
- (+ 1 2) => {type:-5,value:3n}
- 9007199254740993 => exact bigint, no JS precision loss
- 0Nl => {type:-5,value:null}
- "hello" => {type:-13,value:"hello"}
- (/ 1 0) => {type:-7,value:null}
- nonexistent_mica_symbol => throws Rayforce: name
Test server was killed after verification. No private records were sent.

Limits: scalar values only, no GUIDs, vectors/tables, compressed frames, auth,
transport upgrade, prepared parameters or blob operations. Unsupported types
fail explicitly. Source is executable RFL, NOT a safe data ingestion API: never
interpolate untrusted data. No live memory integration. Numeric type codes retain
Rayforce date/time/unit distinction. Tokenizer and memory model remain separate.

Response bodies <=1MiB, absolute deadline <=60s, no automatic retry. A timeout,
disconnect, or unsupported response does not imply rollback: the query may have
executed. Source can mutate state and files with the server's permissions.
Loopback is not an authentication boundary against other local processes.

Persistence: default server invocation is ephemeral. The release exposes -l
(journal) and -L (fsync per write), but this milestone does NOT verify restart,
snapshot/parted rollover, durability acknowledgments, atomic ingestion or crash
recovery. Do not use for durable memory until those experiments pass. Add typed
parameter/value encoding and bounded compound-value decoding before ingestion.

Unit tests use a local fake server, so standard gates need neither a download
nor a Rayforce process. Real-engine results above are manual integration evidence,
not evidence supplied by the fake server tests.

## Typed-value milestone
`sendRayData(port, data)` now accepts a closed subset: null, boolean, bigint
(signed i64), finite number (f64), well-formed UTF-8 text and nested lists.
It returns a one-element list envelope. A builtin `list` call carries the data;
there are no user-provided symbols/functions and no source interpolation.
This is safe data transport, NOT yet a parameterized insertion interface.
`queryRayforce` evaluates trusted RFL and decodes supported compound results.

Decoder limits: 1MiB, 10000 elements/nodes, depth32; rejects trailing bytes,
invalid UTF-8, unknown types/flags, duplicate table column names, ragged tables.
Supports ordinary lists, scalar vectors and tables, not dicts/functions/GUIDs.
Nonzero vector/compound attrs rejected except schema SYM W64=3 (release serializer
explicitly emits it). Numeric vectors retain raw null-sentinel payloads; they
are not claimed to provide normalized nullable cells. Compression still refused.
Typed scalar nulls retain their type. Large responses may execute then fail to
decode: do not retry mutations automatically.

Real v3.0.2 synthetic verification: sending `(set mica_injected 99)` as text
returned that exact text; querying mica_injected afterward returned name error.
Nested mixed data and Unicode also returned list envelopes. Querying
`(table [id text] (list [1 2] (list "a" "b")))` returned schema id/text,
i64 column 1n/2n and string column a/b. Server killed and awaited afterward.
No private ingestion or persistence validation performed.

## Architecture decision after native evaluation
An isolated native FFI experiment also succeeded, but the selected baseline
keeps the engine in a separate process for crash containment (not a security
sandbox). Real native Rayforce peers negotiated `shm` and returned 3 locally.
This Bun client advertises zero transport capabilities and remains TCP. Shared
memory requires negotiation, descriptor passing and rings; no upgrade support
is claimed here. Reuse the native client transport in a separately evaluated
helper if needed rather than duplicating that machinery prematurely.

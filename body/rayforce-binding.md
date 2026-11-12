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

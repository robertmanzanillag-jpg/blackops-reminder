# Exact free-count admission within existing Factory escrow

The conservative byte bound in cache-write billing can exceed the approved
10-cent discovery reservation for a legitimate repository listing. This adapter
uses the Factory's existing free input-token count to tighten that input bound.
It does not raise any budget, change a model/rate, reconcile historical spending,
activate paid work, or grant a provider permission.

Only the existing scoped `createFactoryOpenAiCountTransport` can tag a successful
count response. It validates a bounded official response before creating a private
receipt: exact canonical model/instructions/input/reasoning/schema, raw-response
SHA, measured input count, owner/job/fence, timestamp and unique nonce. Neither a
JSON request nor an injected count callback can provide this proof.

The routing closure keeps at most 32 receipts for 120 seconds. Generation must
match the exact counted prompt and fixed stateless default-tier text options.
It removes a matching receipt before invoking the gate, and passes it through a
private asynchronous scope. The raw Responses guard consumes it once. Its remaining lifetime also limits the
monetary gate’s dispatch window, so a delayed admission cannot use an expired proof. Different
owner/job/fence, changed prompt, expired receipt, abort, replay or an untrusted
count response cannot acquire a smaller reservation. Such requests retain the
ordinary byte bound and every normal monetary admission check.

The primary reservation binds the count evidence and still covers the most
expensive approved input cache bucket plus maximum output. Measured input must
then equal the exact count; inconsistent input remains unknown and retains its
escrow. Maximum output, priced input tier, profile expiry, parent fence, shared
$100 authority, reconciliation checkpoint and historical unknown holds all remain
mandatory. Generic SDK and Office requests retain their conservative byte bound.

Offline validation includes a 28,000-byte synthetic prompt counted at 7,000 input
tokens: at explicit synthetic Sol-shaped rates, worst-cache reservation is 45,240
microUSD and measured cost is 14,050 microUSD. It fits the unchanged 100,000
microUSD parent reservation. An injected untrusted count makes zero paid requests;
a paid response differing from the exact count retains an unknown hold and cannot
replay. These fixtures prove accounting behavior, not live provider prices or real
usage. No provider requests are made by the tests.

This is source code only. A reviewed current deployment must include this adapter
and the cache-write modules; the frozen v6 bundle is unchanged. Paid activation
still requires the historical attribution checkpoint and operator-reviewed price
profiles. Reverting the code must preserve all newer receipts and unknown holds.

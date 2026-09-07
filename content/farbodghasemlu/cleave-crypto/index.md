---
intracloud: 1
title: "What actually costs time in browser post-quantum encryption"
summary: "The common objection to post-quantum cryptography in the browser is that lattice schemes are too slow for client-side use. Measured against a working implementation, that objection is misdirected."
tags: [post-quantum-cryptography, hybrid-key-establishment, committing-authenticated-encry, file-encryption, cryptographic-erasure]
canonical: https://doi.org/10.5281/zenodo.22172869
---
# What actually costs time in browser post-quantum encryption

The common objection to post-quantum cryptography in the browser is that lattice
schemes are too slow for client-side use. Measured against a working
implementation, that objection is misdirected. ML-KEM-768 combined with X25519
establishes a key in about five milliseconds in Chrome. The password hash that
protects it takes five seconds.

That inversion held up across two runtimes and turned out to be one of six
results worth reporting, most of which apply to any cryptographic code running in
JavaScript rather than to one library in particular. The measurements below come
from CLEAVE, a post-quantum file encryption format and its reference
implementation.

## Passphrase hashing costs a thousand times more than the post-quantum parts

I expected ML-KEM to be the expensive operation. It is not close.

![Cost of each operation on a log scale](/i/25f6749339039686.webp)

One Argon2id derivation at 64 MiB and three passes takes 5.1 seconds in Chrome.
One X-Wing encapsulation, which is ML-KEM-768 and X25519 together, takes 5.05
milliseconds. The ratio is about 1015 to 1.

This inverts the usual worry about post-quantum cryptography being too slow for
the browser. Hybrid key establishment is cheap enough that you can do thirty-two
of them and still finish in under a third of a second. The thing that freezes
your tab is the password hash, and it freezes it for five seconds on the main
thread.

The uncomfortable part is that this is Argon2id working correctly. Memory
hardness is the point. But pure-JavaScript Argon2id runs roughly an order of
magnitude slower than a native implementation at the same parameters, and the
attacker is not running JavaScript. You pay the full latency and receive a
fraction of the intended margin. Lower the parameters to make the UX tolerable
and you have also lowered the attacker's cost.

I do not think there is a clean answer. Moving it to a worker thread stops the
freeze but not the wait. What I settled on was making recipient keys the primary
path, since they skip Argon2id entirely, and treating passphrases as the
fallback rather than the default.

## A hash function choice cost 38x throughput

The original design signed a SHA3-512 digest of the container body. SHA-3 was
already a dependency through the X-Wing combiner, so reusing it felt tidy.

Measured on identical 1 MiB input, the pure-JavaScript SHA3-512 ran at about 10
MiB/s. WebCrypto's SHA-512 ran at about 377 MiB/s. The platform implementation
is roughly 38 times faster, and it turned the hash into the bottleneck for every
signed container. ML-DSA-65 signing itself takes 15.9 ms, which was being dwarfed
by a pre-hash costing over 100 ms per megabyte.

The general rule I took away: if WebCrypto implements the primitive, use
WebCrypto, even when a pure-JavaScript version is already loaded. SHA-3 has no
WebCrypto equivalent, which is exactly why it is slow here. The tidiness of a
single hash family is not worth an order of magnitude.

Switching the pre-hash to SHA-512 changed the signed-container format, since the
bytes fed to ML-DSA are different. Nothing else about the layout changed, which
made the incompatibility silent: an old container parses fine and fails
verification with the same error as a forged one. Worth catching before anything
ships rather than after.

## Two runtimes, two different optimal chunk sizes

The format encrypts in chunks, each with its own key from a ratchet. Chunk size
is a free parameter, so I swept it.

![Throughput against chunk size in both runtimes](/i/297ed3d9d4af3d62.webp)

Node improves monotonically up to 4 MiB. Chrome peaks at 256 KiB and then gets
worse, losing about a quarter of its throughput by 1 MiB. I attribute the browser
decline to allocation and copying costs for large buffers inside the tab, though
I have not proven that.

At 4 KiB the penalty is severe in both: 26 MiB/s in Node against 452 at the top
of the range, a factor of 17. Every chunk needs an independent key import,
because the ratchet gives each chunk a distinct key by design, so per-call
overhead cannot amortize across chunks. That is the cost of forward secrecy at
chunk granularity, and it is worth knowing before you pick a small chunk size for
streaming reasons.

I kept 1 MiB as the default. It is within 3 percent of Node's best and about 25
percent off Chrome's best, which makes it a compromise rather than an optimum. I
would rather say that than claim a number is optimal when the data shows two
runtimes disagreeing.

## The bug that only appears past 62,000 chunks

`concat(...parts)` is idiomatic and wrong at scale. Spreading an array into
function arguments hits a call-stack limit, which I measured at 125,293 arguments
on V8.

Encryption pushes two array entries per chunk, so the failure begins around 62,600
chunks. At the 4 KiB minimum chunk size that is a 245 MiB file. Every test I had
written passed, because none of them used a file that large with a chunk size that
small.

My first regression test used 10,241 chunks, which would not have caught it
either. I only found the real threshold by binary-searching the argument limit
directly. The fix is a loop instead of a spread, and the test now asserts against
200,000 parts and separately checks that the spread limit is still reachable, so
the test cannot silently stop testing anything if V8 raises the cap.

## `heapUsed` does not measure what you probably think

My first memory benchmark reported a flat 20 MiB peak whether the input was 1 MiB
or 256 MiB. That is not a suspiciously good result, it is a broken measurement.

`process.memoryUsage().heapUsed` excludes external `ArrayBuffer` storage, which is
where every payload byte in a crypto library actually lives. Sampling it tells
you about your bookkeeping objects and nothing about your data.

Reading `arrayBuffers` and `rss` instead, peak retention during encryption is
about 2.3 times the plaintext size, since the input, the per-chunk ciphertexts,
and the assembled output all exist at once. For a browser tool this matters more
than throughput does: memory is what bounds the largest file you can handle in a
tab, and 236 MiB/s is irrelevant if the tab dies first.

## Key commitment and information-theoretic erasure cannot coexist

This one is specific to the design but the principle generalizes.

The format can split its master key into a half stored in the container and a
detachable 61-byte fragment. Destroy every copy of the fragment and the container
becomes unreadable. Since the split is a one-time pad, I originally wrote that
the erasure was information-theoretic.

That claim was wrong, and I want to be precise about why, because the error is
easy to repeat. The container also carries a key-committing tag, which is a
deterministic function of the master key. An adversary with unbounded time
enumerates candidate fragments and tests each one against that tag. The tag is a
verifier, and a verifier defeats an information-theoretic argument by
construction. The work is around 2^192 with the pairing hint present and 2^256
without it, so it is irrelevant against any real adversary, but it is not
unconditional and the paper should not have said it was.

Stated generally: key commitment requires retaining something that determines the
key, and information-theoretic erasure requires retaining nothing that determines
it. You can have either property in a single container, not both. Any design
combining crypto-shredding with committing AEAD inherits this, and that
combination is becoming common.

I chose commitment and downgraded the erasure claim to computational.
[Theorem 7.3 in the paper](https://doi.org/10.5281/zenodo.22172869) states the
bound.

## What the numbers came from

Chrome 149 and Node.js 22 on a quad-core mobile x86-64 machine, which is
deliberately ordinary hardware. Medians with interquartile ranges rather than
means, warmup iterations discarded, and seeded inputs so runs are comparable. Any
figure whose spread exceeded ten percent of its median is flagged in the output
rather than quietly reported.

One measurement is genuinely noisy and stays that way: ML-DSA-65 signing has an
interquartile range of about 71 percent, with observed values from 8.2 ms to 48.9
ms. That is rejection sampling working as designed, not measurement error. A mean
would misrepresent it.

For completeness, the parts that did work as expected: encryption reaches 236
MiB/s in Chrome and 452 MiB/s in Node, fixed framing is 1286 bytes for a single
recipient plus 20 bytes per chunk, and worst-case decryption cost is almost
independent of recipient count, rising from 9.7 ms at one recipient to 14.7 ms at
thirty-two because an 8-byte key identifier lets a reader skip slots that are not
theirs before doing any lattice work.

![Encryption and decryption cost against recipient count](/i/d683341a8baa4372.webp)

## Caveats

The library is unaudited. The primitives underneath it are standardized and their
implementations are audited, but the protocol layer on top is mine and nobody
else has reviewed it. The version number is 0.1.0 and should be read literally.

Browser cryptography also has a trust problem that measurements cannot fix. If
the code arrives over the web, whoever controls the server controls the code, and
no property below the delivery layer survives that. Subresource integrity and
packaging narrow the window without closing it. For threat models that include
the origin operator, this is the wrong tool.

The benchmark harness ships with the library, records its own environment, and has
an `--anonymize` flag for anyone who would rather not publish their kernel version
along with their timings.

## References

Source, tests, and benchmark harness:
[github.com/farbodghasemlu/cleave-crypto](https://github.com/farbodghasemlu/cleave-crypto)

Format specification, threat model, and security analysis, including the erasure
bound discussed above: [doi.org/10.5281/zenodo.22172869](https://doi.org/10.5281/zenodo.22172869)

Raw benchmark output for both runtimes: [`paper/bench-results/`](/@farbodghasemlu/cleave-crypto/paper/bench-results)

The exact revision these measurements were taken from is archived at
[doi.org/10.5281/zenodo.21759377](https://doi.org/10.5281/zenodo.21759377).

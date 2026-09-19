---
intracloud: 1
title: "What actually goes wrong when you hardcode a proxy creation code"
summary: "The assumption behind a hardcoded proxyCreationCode constant is that a wrong value will announce itself. It does not. It produces a valid, fundable address that no transaction on any chain can ever deploy to."
tags: [create2, safe-proxy-factory, counterfactual-addresses, address-derivation, evm]
---
There is a way to lose money on an EVM chain that never once tells you something went wrong. No revert. No failed transaction. Nothing in the logs, because nothing failed. You derive a Safe proxy address, it passes every check you have, you put it on an invoice, a customer pays it, and the contract you meant to deploy there can never be deployed. Not by you, not by anyone, not later when you figure it out.

One input causes this. The proxy creation code you fed into the CREATE2 derivation. If it does not match, byte for byte, what the factory on that chain actually uses, you have computed a perfectly valid address that nothing can ever be deployed to. The funds sitting there are gone in the boring, permanent way.

You already know how CREATE2 works, so I am not going to walk you through it. What I want to show you is why this particular mistake stays silent, because the silence is the entire problem. Most bugs in this neighborhood are loud. This one hands you a well-formed address, smiles, and lets you ship.

## Everything succeeds, and the answer is still wrong

The derivation:

```
bytecodeHash = keccak256(proxyCreationCode ++ abi.encode(uint256(singleton)))
salt         = keccak256(keccak256(initializer) ++ abi.encode(uint256(saltNonce)))
address      = CREATE2(proxyFactory, salt, bytecodeHash)
```

One thing here trips people even before we get to the creation code. The singleton is not inside the creation code. It is a constructor argument, ABI-encoded and appended, which is why `bytecodeHash` hashes the concatenation instead of the creation code alone. Get that backwards and you land in the same hole by a different route.

Now put wrong bytes at the front of that first line and watch what happens. keccak256 does not care. It hashes what you give it and returns something that looks exactly like what it returns for correct input. The concatenation is fine. The salt is untouched, since the creation code never enters the salt. The final twenty bytes have a valid checksum and look like every other address you have ever seen. An explorer shows an empty account, which is precisely what a correct counterfactual address looks like before deployment.

So your formula is right. Only its input is wrong, and the formula has no opinion about its inputs. There is no assertion the arithmetic can make on your behalf. The only way to catch this is to compare against something outside the computation, which means you have to go ask the chain.

And the address stays dead because the factory will not take a bytecode hash from you. `createProxyWithNonce` assembles the init code itself, from its own compiled proxy and the singleton you passed. It deploys where its creation code says, not where yours does. You cannot aim it. The single transaction in the universe that could have deployed to your address does not exist and cannot be built.

## Nobody types the wrong bytes on purpose

It always arrives politely. A constant copied from a gist, a tutorial, or the last codebase you worked in. Creation code is a hex blob nobody reads, so the moment it lands in your config it becomes invisible. It passes review because there is nothing in it to review. I have approved PRs containing values like this and so have you.

Then it drifts, or it was wrong from the start. Safe's factory versions do not share a proxy. The 1.3.0 factory at `0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2` returns `type(GnosisSafeProxy).creationCode`. The 1.4.1 factory at `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` returns `type(SafeProxy).creationCode`. Different contracts, different bytes, different addresses for identical inputs. If your constant came from a 1.3.0 integration and your factory address came from the 1.4.1 docs, every piece looks right and the whole thing is wrong.

Chains do the rest. Not every network implements CREATE2 the way mainnet does. zkSync derives from a different preimage entirely, so a value that is correct on Base is simply not correct there. A default that works on eight chains and fails quietly on the ninth is worse than having no default, because by the time you reach the ninth you have stopped questioning it.

## So make the caller say it out loud

When I wrote a library for this, the tempting design was right there. Ship the creation code as a constant. Make the argument optional. Four parameters instead of five, a shorter quickstart, a nicer README.

I think that convenience is the bug. A bundled default is a value your caller never chose, never looked at, and cannot see, and it turns a decision with unrecoverable consequences into something that happens by omission. So the package ships no creation code at all and the argument is required. You cannot derive an address without stating which bytes you believe the factory uses. It is one more line and it is the line that saves you.

Read it from the factory, on the chain you are deriving for:

```ts
const proxyCreationCode = await client.readContract({
  address: proxyFactory,
  abi: [{
    name: 'proxyCreationCode',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes' }],
  }],
  functionName: 'proxyCreationCode',
});
```

Or from the terminal when you want to look at it with your own eyes:

```
cast call 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67 "proxyCreationCode()(bytes)" --rpc-url $RPC_URL
```

It is a `pure` function that exists for exactly this. Safe put it there so integrators could predict addresses. It costs you one read at startup, which is nothing.

## Then refuse to be clever about it

Reading it once is not the same as trusting it forever. Do the read at cold start, compare it to what you have configured, and refuse to operate on any chain where the two disagree:

```ts
import { assertCreationCode } from 'safe-counterfactual';

assertCreationCode({
  expected: config.proxyCreationCode,        // what you think it is
  onchain: await readCreationCode(chainId),  // what it actually is
});
```

Refuse is the operative word. A mismatch is not a warning you log and step over. It means your config and the deployed factory disagree about what a proxy is, and every address you quote from that moment on may be a hole in the ground. Stop quoting on that chain and wake someone up. Graceful degradation here degrades into losing customer money, which is a strange thing to be graceful about.

Do it per chain, obviously. The whole failure mode is a value that is right in one place and wrong in another.

## Test against the chain, not against yourself

Unit tests are close to useless here, and this is the part I find genuinely funny. A test that derives an address from your constant and compares it to a fixture derived from your constant will pass happily for years while both are wrong together. Congratulations, you have proven keccak256 is deterministic.

Fork tests catch it. Fork the chain, read `proxyCreationCode()` live, derive, then call `createProxyWithNonce` for real and assert the proxy landed exactly where you promised. That test breaks the moment your assumptions drift from the deployed contracts, which is the only break worth having. Mine run against Base and Arbitrum and skip themselves when the network is unreachable, so a sulking RPC does not block the suite.

## The rule

Treat proxy creation code as chain state you observe, never as a constant you carry around. Read it from the deployed factory, on the chain you are deriving for, at every cold start. Compare it to what you expect. If they disagree, quote nothing.

[safe-counterfactual](https://www.npmjs.com/package/safe-counterfactual) is built around that rule. `proxyCreationCode` is required, no default ships with the package, and `assertCreationCode` is there for the boot check. Pure functions, one peer dependency, no network calls of its own, which means reading the creation code stays your job. I would rather hand you that job than make the decision for you and be wrong on your ninth chain.

# Hardline

**Rules hardwired into chips nobody can change.**

Hardline turns a plain rule (*"allow if at least 3 of 5 signers approved and the treasury isn't frozen"*) into a real logic chip on [TapeOut](https://tapeout.net), proves it correct for every possible input, and mints it on **X Layer**. After that, any contract, vault or AI agent can call `eval(chipId, facts)` and get ALLOW / DENY from a chip that can never be edited — not even by its creator.

Built for **X Layer TapeOut Accelerate** (Build X Series).

## How it works

1. **Write** — conditions (yes/no facts) + a rule built from ALL / ANY / AT LEAST k / NONE groups.
2. **Compile** — `src/compiler.js` lowers the rule to 2-input NAND gates with constant folding, double-negation removal and structural hashing, and emits TapeOut's on-chain netlist format (7-byte cells: `opcode | left uint24 | right uint24`).
3. **Prove** — every one of the 2ⁿ input combinations is run through the raw netlist bytes and compared with the rule. Any mismatch blocks minting.
4. **Mint** — `src/chain.js` + `src/mint.js` (no external libraries): create the Hardline processor once via the TapeOut factory, buy NAND units, `tapeout(nl, nIn, 1)`. Every transaction is simulated, gas-estimated and balance-checked before the wallet is asked to sign.
5. **Verify live** — after tape-out the page reads `circuitInfo` and calls `eval` on the live chip with several input vectors and checks each answer against the rule.

## TapeOut usage (X Layer, chain 196)

| Contract | Address / call |
| --- | --- |
| TapeOut factory | `0x1f09daefa827f02cbb40967cc91b259763760761` — `createCPU`, `deployFee` |
| Hardline processor | set in `src/chain.js` (`XL.hardline`) after creation |
| Per chip | `mint(0, n)` on transistors, `tapeout(bytes,uint32,uint32)`, `eval(uint256,bytes)`, `circuitInfo(uint256)` |

`eval` input bytes: condition *i* is bit `i & 7` of byte `i >> 3`. Output byte `0x01` = ALLOW, `0x00` = DENY.

## Verification

- `node test/compiler.test.js` — 20,000 random rules, each proven against every input; template gate counts.
- The netlist simulator reproduces a live TapeOut 8-bit adder circuit for all 65,536 inputs.
- Calldata encoding was cross-checked byte-for-byte against ethers v6.

## Build

```
python3 build.py   # writes index.html from src/
```

Open the page inside **OKX Wallet → Discover** to connect and mint.

Unaudited hackathon build. By **Tajudeen** · [@Tajudeen](https://x.com/Tajudeen)

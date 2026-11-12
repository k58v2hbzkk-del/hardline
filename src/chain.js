// Hardline <-> X Layer: minimal ABI codec + TapeOut calls. No external libraries.
// Interface (from TapeOut builders' mainnet fork tests on X Layer):
//   Factory  createCPU(string,string,string,uint256,uint256) payable -> (transistors, circuits)
//            deployFee() cpuCount() cpuAt(uint256)
//   Transistors mint(uint256 id, uint256 amount) payable   id 0 = NAND
//            mintPrice() protocolFee() balanceOf(address,uint256)
//   Circuits tapeout(bytes nl, uint32 nIn, uint32 nOut) payable -> id
//            TAPEOUT_FEE() eval(uint256,bytes) circuitInfo(uint256) ownerOf(uint256)
const XL = {
  chainId: 196, chainHex: "0xc4", name: "X Layer Mainnet", symbol: "OKB",
  rpc: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
  explorer: "https://www.oklink.com/xlayer",
  factory: "0x1f09daefa827f02cbb40967cc91b259763760761",
  // Hardline's own processor. Filled in after the one-time createCPU transaction.
  hardline: { transistors: "", circuits: "" },
};
const SEL = {
  createCPU: "47f9b5fd", deployFee: "eb2a5d2c", cpuCount: "a94da8a7", cpuAt: "4bc7cbbd",
  mint: "1b2ef1ca", mintPrice: "6817c76c", protocolFee: "b0e21e8a", balanceOf: "00fdd58e",
  tapeout: "7bd3ac1d", tapeFee: "adfb2b69", eval: "934d06ea", circuitInfo: "084d60f1", ownerOf: "6352211e",
};
const TAPEDOUT_TOPIC = "0xc11215e417669c143c8a07aeb778034c0a0a85ebdf305d64a629b19a7a9ce031";

const Abi = {
  word(n) { n = BigInt(n); if (n < 0n) throw new Error("negative"); return n.toString(16).padStart(64, "0"); },
  addr(a) { if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("bad address"); return a.slice(2).toLowerCase().padStart(64, "0"); },
  bytesHex(h) { h = h.replace(/^0x/, ""); const len = h.length / 2; return Abi.word(len) + h.padEnd(Math.ceil(h.length / 64) * 64 || 0, "0"); },
  str(s) { return Abi.bytesHex([...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("")); },
  // types: "uint" | "address" | "bytes" | "string"
  encode(sel, types, vals) {
    let head = "", tail = "", base = 32 * types.length;
    types.forEach((t, i) => {
      if (t === "uint") head += Abi.word(vals[i]);
      else if (t === "address") head += Abi.addr(vals[i]);
      else { head += Abi.word(base + tail.length / 2); tail += t === "string" ? Abi.str(vals[i]) : Abi.bytesHex(vals[i]); }
    });
    return "0x" + sel + head + tail;
  },
  uint(ret, i = 0) { return BigInt("0x" + ret.slice(2 + i * 64, 2 + (i + 1) * 64)); },
  address(ret, i = 0) { return "0x" + ret.slice(2 + i * 64 + 24, 2 + (i + 1) * 64); },
  bytes(ret) { const off = Number(Abi.uint(ret, 0)) * 2, len = Number(BigInt("0x" + ret.slice(2 + off, 2 + off + 64))); return "0x" + ret.slice(2 + off + 64, 2 + off + 64 + len * 2); },
};
const okb = (wei) => { wei = BigInt(wei); if (wei > 0n && wei < 10n ** 10n) return wei.toString() + " wei"; const s = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, ""); return (wei / 10n ** 18n).toString() + (s ? "." + s.slice(0, 8).replace(/0+$/, "") : ""); };
const errText = (e) => {
  if (!e) return "Unknown error";
  const parts = [e.message, e.reason, e.data && (typeof e.data === "string" ? e.data : e.data.message || e.data.data), e.error && e.error.message, e.code != null && "code " + e.code];
  return parts.filter(Boolean).join(" · ") || String(e);
};

const Chain = {
  provider: () => window.ethereum || window.okxwallet || null,
  async rpc(method, params) {
    const p = Chain.provider();
    if (p && Chain.account) return p.request({ method, params });
    let last;
    for (const url of XL.rpc) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
      } catch (e) { last = e; }
    }
    throw last || new Error("RPC unreachable");
  },
  call(to, data, from, value) { const tx = { to, data }; if (from) tx.from = from; if (value != null) tx.value = "0x" + BigInt(value).toString(16); return Chain.rpc("eth_call", [tx, "latest"]); },
  account: null,
  async connect() {
    const p = Chain.provider(); if (!p) throw new Error("NO_WALLET");
    const [a] = await p.request({ method: "eth_requestAccounts" });
    Chain.account = a;
    const cid = await p.request({ method: "eth_chainId" });
    if (cid.toLowerCase() !== XL.chainHex) {
      try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XL.chainHex }] }); }
      catch (e) {
        if (e && (e.code === 4902 || /unrecognized|not added/i.test(e.message || ""))) {
          await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: XL.chainHex, chainName: XL.name, nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: XL.rpc, blockExplorerUrls: [XL.explorer] }] });
        } else throw e;
      }
    }
    return a;
  },
  async balance() { return BigInt(await Chain.rpc("eth_getBalance", [Chain.account, "latest"])); },
  simulate(to, data, value) { return Chain.rpc("eth_call", [{ from: Chain.account, to, data, value: "0x" + BigInt(value).toString(16) }, "latest"]); },
  // simulate -> estimate -> balance check -> send -> wait
  async send(to, data, value, onStatus) {
    const from = Chain.account, v = "0x" + BigInt(value).toString(16);
    onStatus && onStatus("Simulating…");
    const sim = await Chain.rpc("eth_call", [{ from, to, data, value: v }, "latest"]);
    let gas = BigInt(await Chain.rpc("eth_estimateGas", [{ from, to, data, value: v }]));
    gas = (gas * 13n) / 10n;
    const gp = BigInt(await Chain.rpc("eth_gasPrice", []));
    const bal = await Chain.balance();
    if (bal < BigInt(value) + gas * gp) throw new Error(`Not enough OKB: need about ${okb(BigInt(value) + gas * gp)}, wallet has ${okb(bal)}`);
    onStatus && onStatus("Confirm in your wallet…");
    const hash = await Chain.provider().request({ method: "eth_sendTransaction", params: [{ from, to, data, value: v, gas: "0x" + gas.toString(16) }] });
    onStatus && onStatus("Waiting for X Layer…", hash);
    for (let i = 0; i < 120; i++) {
      const r = await Chain.rpc("eth_getTransactionReceipt", [hash]);
      if (r) { if (r.status !== "0x1") throw new Error("Transaction failed onchain: " + hash); return { hash, receipt: r, sim }; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    throw new Error("Timed out waiting for " + hash);
  },
};

const TapeOut = {
  deployFee: async () => Abi.uint(await Chain.call(XL.factory, "0x" + SEL.deployFee)),
  cpuCount: async () => Abi.uint(await Chain.call(XL.factory, "0x" + SEL.cpuCount)),
  createCpuData: (name, symbol, story, supply, price) => Abi.encode(SEL.createCPU, ["string", "string", "string", "uint", "uint"], [name, symbol, story, supply, price]),
  mintPrice: async (t) => Abi.uint(await Chain.call(t, "0x" + SEL.mintPrice)),
  protocolFee: async (t) => Abi.uint(await Chain.call(t, "0x" + SEL.protocolFee)),
  nandBalance: async (t, who) => Abi.uint(await Chain.call(t, Abi.encode(SEL.balanceOf, ["address", "uint"], [who, 0]))),
  mintData: (amount) => Abi.encode(SEL.mint, ["uint", "uint"], [0, amount]),
  tapeFee: async (c) => Abi.uint(await Chain.call(c, "0x" + SEL.tapeFee)),
  tapeoutData: (hex, nIn, nOut) => Abi.encode(SEL.tapeout, ["bytes", "uint", "uint"], [hex, nIn, nOut]),
  evalOnchain: async (c, id, inputHex) => Abi.bytes(await Chain.call(c, Abi.encode(SEL.eval, ["uint", "bytes"], [id, inputHex]))),
  info: async (c, id) => { const r = await Chain.call(c, Abi.encode(SEL.circuitInfo, ["uint"], [id])); return { nIn: Number(Abi.uint(r, 0)), nOut: Number(Abi.uint(r, 1)), nState: Number(Abi.uint(r, 2)), gates: Number(Abi.uint(r, 3)) }; },
  idFromReceipt(receipt, circuits) {
    const log = (receipt.logs || []).find((l) => l.address.toLowerCase() === circuits.toLowerCase() && l.topics[0] === TAPEDOUT_TOPIC);
    return log ? BigInt(log.topics[1]) : null;
  },
};

if (typeof module !== "undefined") module.exports = { XL, SEL, Abi, okb, errText, TapeOut };

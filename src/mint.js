(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const txLink = (h) => `<a href="${XL.explorer}/tx/${h}" target="_blank" rel="noopener">${short(h)}</a>`;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const proc = () => (XL.hardline.circuits ? XL.hardline : store.get("hl_proc", null));
  let busy = false;

  function log(html, cls = "") { const d = document.createElement("div"); d.className = "lg " + cls; d.innerHTML = html; $("mintLog").appendChild(d); $("mintLog").classList.remove("hidden"); return d; }
  function err(e) { log("⛔ " + esc(errText(e)), "bad"); }

  async function render() {
    const W = $("walletBox"), P = $("procBox"), C = $("costBox"), B = $("mintBtn");
    B.classList.add("hidden"); C.innerHTML = "";
    if (!Chain.provider()) {
      W.innerHTML = `<div class="note"><b>Open this page inside OKX Wallet to mint.</b><br>Copy the link → open OKX Wallet → <b>Discover</b> → paste it in the search bar.</div>
        <button class="btn ghost" id="copyLink">Copy page link</button>`;
      $("copyLink").onclick = () => navigator.clipboard?.writeText(location.href.split("#")[0]).then(() => toastMsg("Link copied"), () => {});
      return renderProcReadonly(P);
    }
    if (!Chain.account) {
      W.innerHTML = `<button class="btn primary" id="connectBtn">Connect wallet</button>`;
      $("connectBtn").onclick = async () => { try { await Chain.connect(); render(); } catch (e) { err(e); } };
      return renderProcReadonly(P);
    }
    let bal = 0n; try { bal = await Chain.balance(); } catch (e) {}
    W.innerHTML = `<div class="row"><span class="dotlive"></span><b>${short(Chain.account)}</b><span class="muted">· ${okb(bal)} OKB · X Layer</span></div>`;
    const pr = proc();
    if (!pr) {
      let fee = null; try { fee = await TapeOut.deployFee(); } catch (e) {}
      P.innerHTML = `<div class="note"><b>One-time setup:</b> create the Hardline processor on TapeOut. Every Hardline chip will live on it.<br>Protocol fee: <b>${fee == null ? "…" : okb(fee) + " OKB"}</b> + gas.</div>`;
      B.textContent = "Create Hardline processor"; B.classList.remove("hidden");
      B.onclick = () => createProcessor(fee);
      return;
    }
    P.innerHTML = `<div class="kv"><span>Processor</span><span><a href="${XL.explorer}/address/${pr.circuits}" target="_blank" rel="noopener">${short(pr.circuits)}</a></span></div>`;
    const S = window.HL.get();
    if (!S.compiled || !S.proof || !S.proof.ok) { C.innerHTML = `<div class="note">Fix the rule first. Only proven chips can be minted.</div>`; return; }
    try {
      const [price, pfee, tfee, have] = await Promise.all([TapeOut.mintPrice(pr.transistors), TapeOut.protocolFee(pr.transistors), TapeOut.tapeFee(pr.circuits), TapeOut.nandBalance(pr.transistors, Chain.account)]);
      const gates = BigInt(S.compiled.gates), need = have >= gates ? 0n : gates - have;
      const mintCost = need ? price * need + pfee : 0n, total = mintCost + tfee;
      C.innerHTML = `<div class="kv"><span>Gates in this chip</span><span>${gates}</span>
        <span>NAND gates you own</span><span>${have}</span>
        <span>Buy ${need} gate${need === 1n ? "" : "s"}</span><span>${okb(mintCost)} OKB</span>
        <span>Tape-out fee</span><span>${okb(tfee)} OKB</span>
        <span><b>Total</b></span><span><b>${okb(total)} OKB</b> + gas</span></div>`;
      B.textContent = `Mint this chip · ${okb(total)} OKB`; B.classList.remove("hidden");
      B.onclick = () => mintChip({ pr, price, pfee, tfee, need });
    } catch (e) { err(e); }
  }

  async function renderProcReadonly(P) {
    const pr = proc();
    P.innerHTML = pr ? `<div class="kv"><span>Processor</span><span>${short(pr.circuits)}</span></div>` : "";
  }

  async function createProcessor(fee) {
    if (busy) return; busy = true; $("mintLog").innerHTML = "";
    try {
      if (fee == null) fee = await TapeOut.deployFee();
      const story = "Hardline: rules hardwired into chips nobody can change. Each chip is a rule compiled to NAND gates and proven for every input before tape-out. By @Tajudeen.";
      // Known-good mainnet setup first (210000 supply, 0.000066 OKB per gate), then fallbacks.
      const options = [
        { supply: 210000, price: 66000000000000n },
        { supply: 210000, price: 0n },
        { supply: 21000, price: 66000000000000n },
      ];
      const st = log(`Testing processor setups with TapeOut (fee ${okb(fee)} OKB)…`);
      let pick = null, sim = null; const fails = [];
      for (const o of options) {
        const data = TapeOut.createCpuData("Hardline", "HLINE", story, o.supply, o.price);
        try { sim = await Chain.simulate(XL.factory, data, fee); pick = { ...o, data }; break; }
        catch (e) { fails.push(`${o.supply} / ${okb(o.price)} OKB → ${errText(e)}`); }
      }
      if (!pick) { st.innerHTML = "⛔ TapeOut refused every setup. Send this to Claude:<br>" + fails.map(esc).join("<br>") + `<br>fee: ${fee} wei`; throw new Error("No setup accepted"); }
      st.innerHTML = `✅ TapeOut accepts: supply ${pick.supply.toLocaleString()}, ${okb(pick.price)} OKB per gate`;
      const st2 = log("Creating processor…");
      const r = await Chain.send(XL.factory, pick.data, fee, (s, h) => (st2.innerHTML = esc(s) + (h ? " " + txLink(h) : "")));
      const pr = { transistors: Abi.address(r.sim, 0), circuits: Abi.address(r.sim, 1), tx: r.hash };
      store.set("hl_proc", pr);
      st2.innerHTML = `✅ Hardline processor created ${txLink(r.hash)}<br><span class="muted">Circuits ${esc(pr.circuits)}<br>Transistors ${esc(pr.transistors)}</span><br><b>Screenshot this and send it to Claude.</b>`;
    } catch (e) { if (!/No setup accepted/.test(e.message || "")) err(e); }
    busy = false; render();
  }

  async function mintChip({ pr, price, pfee, tfee, need }) {
    if (busy) return; busy = true; $("mintLog").innerHTML = "";
    const S = window.HL.get(), c = S.compiled, nIn = S.state.names.length;
    try {
      if (need > 0n) {
        const st = log(`Step 1/3 · Buying ${need} NAND gates…`);
        const r = await Chain.send(pr.transistors, TapeOut.mintData(need), price * need + pfee, (s, h) => (st.innerHTML = `Step 1/3 · ${esc(s)} ${h ? txLink(h) : ""}`));
        st.innerHTML = `✅ Step 1/3 · Gates bought ${txLink(r.hash)}`;
      } else log("✅ Step 1/3 · You already own enough gates");
      const st2 = log("Step 2/3 · Taping out your chip…");
      const r2 = await Chain.send(pr.circuits, TapeOut.tapeoutData(c.hex, nIn, 1), tfee, (s, h) => (st2.innerHTML = `Step 2/3 · ${esc(s)} ${h ? txLink(h) : ""}`));
      const id = TapeOut.idFromReceipt(r2.receipt, pr.circuits) ?? Abi.uint(r2.sim);
      st2.innerHTML = `✅ Step 2/3 · Chip #${id} is onchain ${txLink(r2.hash)}`;
      const st3 = log("Step 3/3 · Checking the live chip against your rule…");
      const info = await TapeOut.info(pr.circuits, id);
      if (info.nIn !== nIn || info.nOut !== 1 || info.gates !== c.gates) throw new Error(`Onchain shape mismatch: ${JSON.stringify(info)}`);
      const vecs = sampleVectors(nIn, S.facts);
      for (const bits of vecs) {
        const got = await TapeOut.evalOnchain(pr.circuits, id, evalBytes(bits));
        const want = evalRule(S.state.rule, bits);
        if (parseInt(got.slice(2, 4) || "0", 16) !== want) throw new Error(`Chip answered ${got} for ${evalBytes(bits)}, rule says ${want}`);
      }
      st3.innerHTML = `✅ Step 3/3 · Live chip matches your rule (${vecs.length} onchain checks + ${S.proof.total.toLocaleString()} offline)`;
      const chips = store.get("hl_chips", []);
      chips.unshift({ id: id.toString(), circuits: pr.circuits, tx: r2.hash, hex: c.hex, names: S.state.names, rule: S.state.rule, gates: c.gates, t: Date.now() });
      store.set("hl_chips", chips.slice(0, 30));
      log(`<b>🎉 Chip #${id} is live.</b> Any contract can now call <code>eval(${id}, facts)</code> on ${short(pr.circuits)}.`, "ok");
    } catch (e) { err(e); }
    busy = false; render(); renderChips(); window.HL.onUpdate();
  }

  function sampleVectors(n, facts) {
    const out = [facts.slice(), Array(n).fill(0), Array(n).fill(1)];
    for (let i = 0; i < 5; i++) out.push(Array.from({ length: n }, () => (Math.random() < 0.5 ? 1 : 0)));
    return out;
  }

  function renderChips() {
    const chips = store.get("hl_chips", []), box = $("myChips");
    if (!chips.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="tag" style="margin-top:14px">Your chips</div>` + chips.map((ch) =>
      `<div class="chipRow"><b>Chip #${esc(ch.id)}</b><span class="muted">${ch.gates} gates · ${ch.names.length} conditions</span>${txLink(ch.tx)}</div>`).join("");
  }

  // Live check from the Test step: ask the minted chip itself
  window.HL.liveChip = () => { const S = window.HL.get(); return store.get("hl_chips", []).find((ch) => ch.hex === S.compiled?.hex) || null; };
  window.HL.askLive = async () => {
    const ch = window.HL.liveChip(), S = window.HL.get(); if (!ch) return null;
    const out = await TapeOut.evalOnchain(ch.circuits, BigInt(ch.id), evalBytes(S.facts));
    return { id: ch.id, out: parseInt(out.slice(2, 4) || "0", 16) };
  };
  function toastMsg(t) { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toastMsg.t); toastMsg.t = setTimeout(() => e.classList.remove("show"), 2000); }
  window.HL.renderMint = render;
  const p = Chain.provider();
  if (p && p.on) { p.on("accountsChanged", (a) => { Chain.account = a[0] || null; render(); }); p.on("chainChanged", () => location.reload()); }
  render(); renderChips();
})();

// Step 06: demo vault — real OKB that only moves when the chip says ALLOW.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const txLink = (h) => `<a href="${XL.explorer}/tx/${h}" target="_blank" rel="noopener">${short(h)}</a>`;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const VS = { deposit: "d0e30db0", propose: "589de5df", approve: "3eabe96f", setFrozen: "7e932d32", execute: "fe0d94c1",
               check: "5f72f450", count: "aafab1e8", payments: "87d81789", frozen: "054f7d9c", chipId: "0351e494" };
  const T_RELEASED = "0x0733ccbbd0f281b0785c709501e14e19c52af562aded2373185b11b7ba6023e0";
  const T_BLOCKED = "0x1afa530244423dea784784d15258ad54b6c71b63a300394413029b9fafad8576";
  const DEMO_DEPOSIT = 1000000000000000n;  // 0.001 OKB
  const DEMO_PAY = 500000000000000n;       // 0.0005 OKB (sent back to you)
  let busy = false, vault = store.get("hl_vault", null), state = null;

  function log(html, cls = "") { const d = document.createElement("div"); d.className = "lg " + cls; d.innerHTML = html; $("vaultLog").prepend(d); $("vaultLog").classList.remove("hidden"); return d; }
  const word = (h) => h.replace(/^0x/, "").padStart(64, "0");

  function liveTreasuryChip() {
    return store.get("hl_chips", []).find((c) => c.nIn === 6 && c.verified) || store.get("hl_chips", []).find((c) => c.nIn === 6) || null;
  }

  async function deployVault(chip) {
    const me = Chain.account;
    const args = Abi.addr(chip.circuits) + Abi.word(BigInt(chip.id)) + Abi.addr(me) + [me, me, me, me, me].map(Abi.addr).join("");
    const data = VAULT_BYTECODE + args;
    const st = log("Deploying vault… (simulating first)");
    await Chain.rpc("eth_call", [{ from: me, data }, "latest"]);
    let gas = BigInt(await Chain.rpc("eth_estimateGas", [{ from: me, data }])); gas = (gas * 13n) / 10n;
    const gp = BigInt(await Chain.rpc("eth_gasPrice", [])), bal = await Chain.balance();
    if (bal < gas * gp) throw new Error(`Not enough OKB for gas: need about ${okb(gas * gp)}`);
    st.innerHTML = "Confirm the deploy in your wallet…";
    const hash = await Chain.provider().request({ method: "eth_sendTransaction", params: [{ from: me, data, gas: "0x" + gas.toString(16) }] });
    st.innerHTML = "Waiting for X Layer… " + txLink(hash);
    for (let i = 0; i < 120; i++) {
      const r = await Chain.rpc("eth_getTransactionReceipt", [hash]);
      if (r) { if (r.status !== "0x1" || !r.contractAddress) throw new Error("Deploy failed: " + hash);
        vault = { address: r.contractAddress, chipId: chip.id, circuits: chip.circuits, tx: hash }; store.set("hl_vault", vault);
        st.innerHTML = `✅ Vault deployed ${txLink(hash)}<br><span class="muted">${esc(vault.address)}</span>`; return; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    throw new Error("Timed out waiting for deploy");
  }

  async function read() {
    const a = vault.address;
    const [bal, fz, cnt] = await Promise.all([
      Chain.rpc("eth_getBalance", [a, "latest"]).then(BigInt),
      Chain.call(a, "0x" + VS.frozen).then((r) => Abi.uint(r) === 1n),
      Chain.call(a, "0x" + VS.count).then((r) => Abi.uint(r)),
    ]);
    let pay = null;
    if (cnt > 0n) {
      const id = cnt - 1n, r = await Chain.call(a, "0x" + VS.payments + word(id.toString(16)));
      pay = { id, to: Abi.address(r, 0), amount: Abi.uint(r, 1), approvals: Number(Abi.uint(r, 2)), done: Abi.uint(r, 3) === 1n };
      if (!pay.done) { const c = await Chain.call(a, "0x" + VS.check + word(id.toString(16))); pay.allowed = Abi.uint(c, 0) === 1n; pay.facts = "0x" + c.slice(66, 68); }
    }
    return { bal, frozen: fz, pay };
  }

  async function tx(label, data, value = 0n) {
    const st = log(esc(label) + "…");
    const r = await Chain.send(vault.address, data, value, (s, h) => (st.innerHTML = esc(label) + " · " + esc(s) + (h ? " " + txLink(h) : "")));
    st.innerHTML = `✅ ${esc(label)} ${txLink(r.hash)}`;
    return r;
  }

  async function act(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { log("⛔ " + esc(errText(e)), "bad"); } busy = false; render(); }

  async function render() {
    const box = $("vaultBody"); if (!box) return;
    if (!Chain.provider() || !Chain.account) { box.innerHTML = `<div class="note">Connect your wallet in Step 05 first.</div>`; return; }
    const chip = liveTreasuryChip();
    if (!vault) {
      if (!chip) { box.innerHTML = `<div class="note">Mint or add a <b>Treasury 3-of-5</b> chip in Step 05 first. The vault is wired for that rule: 5 signer slots + a freeze switch.</div>`; return; }
      box.innerHTML = `<div class="note"><b>One-time:</b> deploy a vault that obeys <b>Chip #${esc(chip.id)}</b>. For this demo all 5 signer slots and the freeze switch belong to your wallet, so you can play every role. Only gas is paid.</div>
        <button class="btn primary" id="vDeploy">Deploy vault for Chip #${esc(chip.id)}</button>
        <div class="row" style="margin-top:10px"><input type="text" id="vAddr" placeholder="or paste an existing vault address" style="flex:1"><button class="add" id="vUse">Use</button></div>`;
      $("vDeploy").onclick = () => act(() => deployVault(chip));
      $("vUse").onclick = () => { const a = ($("vAddr").value || "").trim(); if (/^0x[0-9a-fA-F]{40}$/.test(a)) { vault = { address: a, chipId: chip.id, circuits: chip.circuits }; store.set("hl_vault", vault); render(); } };
      return;
    }
    box.innerHTML = `<div class="note">Loading vault…</div>`;
    try { state = await read(); } catch (e) { box.innerHTML = `<div class="note">⛔ Couldn't read the vault: ${esc(errText(e))}</div>`; return; }
    const p = state.pay, open = p && !p.done;
    const slots = [0, 1, 2, 3, 4].map((s) => { const on = open && (p.approvals >> s) & 1;
      return `<button class="slot ${on ? "on" : ""}" data-s="${s}" ${!open || on ? "disabled" : ""}>Signer ${s + 1}${on ? " ✓" : ""}</button>`; }).join("");
    box.innerHTML = `
      <div class="kv"><span>Vault</span><span><a href="${XL.explorer}/address/${vault.address}" target="_blank" rel="noopener">${short(vault.address)}</a></span>
        <span>Obeys</span><span>Chip #${esc(vault.chipId)}</span>
        <span>Holds</span><span><b>${okb(state.bal)} OKB</b></span>
        <span>Frozen</span><span>${state.frozen ? "🧊 yes" : "no"}</span></div>
      <div class="row" style="margin-top:10px;gap:8px"><button class="add" id="vDep">+ Deposit 0.001 OKB</button><button class="add" id="vFreeze">${state.frozen ? "Unfreeze" : "Freeze"} vault</button></div>
      ${open ? `<div class="note" style="margin-top:12px"><b>Payment #${p.id}</b>: send ${okb(p.amount)} OKB back to ${short(p.to)}<br>
          Facts right now: <code>${esc(p.facts)}</code> · chip says <b style="color:${p.allowed ? "var(--allow)" : "var(--deny)"}">${p.allowed ? "ALLOW" : "DENY"}</b></div>
        <div class="slots">${slots}</div>
        <button class="btn primary" id="vExec" style="margin-top:12px">Try to release the money</button>`
      : `<button class="btn primary" id="vProp" style="margin-top:12px">Propose a payment · 0.0005 OKB back to you</button>`}`;
    $("vDep").onclick = () => act(() => tx("Deposit 0.001 OKB", "0x" + VS.deposit, DEMO_DEPOSIT));
    $("vFreeze").onclick = () => act(() => tx(state.frozen ? "Unfreeze" : "Freeze", "0x" + VS.setFrozen + word(state.frozen ? "0" : "1")));
    if (open) {
      box.querySelectorAll(".slot").forEach((b) => (b.onclick = () => act(() => tx(`Signer ${+b.dataset.s + 1} approves`, "0x" + VS.approve + word(p.id.toString(16)) + word(b.dataset.s)))));
      $("vExec").onclick = () => act(async () => {
        const r = await tx("Ask the chip and execute", "0x" + VS.execute + word(p.id.toString(16)));
        const logs = r.receipt.logs || [];
        if (logs.some((l) => l.topics[0] === T_RELEASED)) log(`<b style="color:var(--allow)">✅ RELEASED.</b> Chip #${esc(vault.chipId)} said ALLOW, so the vault paid out.`, "ok");
        else if (logs.some((l) => l.topics[0] === T_BLOCKED)) log(`<b style="color:var(--deny)">⛔ BLOCKED.</b> Chip #${esc(vault.chipId)} said DENY. Not a single wei moved.`, "bad");
      });
    } else {
      $("vProp").onclick = () => act(() => tx("Propose payment", "0x" + VS.propose + Abi.addr(Chain.account) + word(DEMO_PAY.toString(16))));
    }
  }

  window.HL.renderVault = render;
  let seen = Chain.account;
  setInterval(() => { if (Chain.account !== seen) { seen = Chain.account; render(); } }, 700);
  render();
})();

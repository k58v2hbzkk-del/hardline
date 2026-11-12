// Hardline compiler: rule tree -> optimized NAND netlist in TapeOut's on-chain format.
// Netlist format (verified against a live TapeOut circuit):
//   7-byte cells: opcode(0x00 = NAND) | left uint24 big-endian | right uint24 big-endian
//   wire 0 = const 0, wire 1 = const 1, wires 2..nIn+1 = inputs, cell k drives wire nIn+2+k,
//   outputs = the last nOut cells. eval() input bytes: input bit i = byte[i>>3] bit (i&7).

// Rule node shapes:
//   { op: "var", v: <input index>, neg: bool }
//   { op: "all" | "any" | "none", kids: [...] }
//   { op: "atleast", k: <int>, kids: [...] }

function evalRule(node, bits) {
  switch (node.op) {
    case "var": return node.neg ? 1 - bits[node.v] : bits[node.v];
    case "all": return node.kids.every((c) => evalRule(c, bits)) ? 1 : 0;
    case "any": return node.kids.some((c) => evalRule(c, bits)) ? 1 : 0;
    case "none": return node.kids.some((c) => evalRule(c, bits)) ? 0 : 1;
    case "atleast": return node.kids.filter((c) => evalRule(c, bits)).length >= node.k ? 1 : 0;
  }
  throw new Error("unknown op " + node.op);
}

class NandBuilder {
  constructor(nIn) {
    this.nIn = nIn;
    this.cells = []; // [refA, refB]
    this.memo = new Map();
  }
  static C0 = { k: "c", v: 0 };
  static C1 = { k: "c", v: 1 };
  key(r) { return r.k + r.v; }
  same(a, b) { return a.k === b.k && a.v === b.v; }
  isNotOf(a, b) { // a == NOT(b)?
    if (a.k !== "g") return false;
    const [x, y] = this.cells[a.v];
    return this.same(x, y) && this.same(x, b);
  }
  nand(a, b) {
    if ((a.k === "c" && a.v === 0) || (b.k === "c" && b.v === 0)) return NandBuilder.C1;
    if (a.k === "c") return this.not(b);
    if (b.k === "c") return this.not(a);
    if (this.isNotOf(a, b) || this.isNotOf(b, a)) return NandBuilder.C1; // x NAND !x = 1
    const ka = this.key(a), kb = this.key(b), key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
    if (this.memo.has(key)) return this.memo.get(key);
    const ref = { k: "g", v: this.cells.length };
    this.cells.push([a, b]);
    this.memo.set(key, ref);
    return ref;
  }
  not(a) {
    if (a.k === "c") return a.v ? NandBuilder.C0 : NandBuilder.C1;
    if (a.k === "g") { const [x, y] = this.cells[a.v]; if (this.same(x, y)) return x; } // !!x = x
    return this.nand(a, a);
  }
  and(a, b) { return this.not(this.nand(a, b)); }
  or(a, b) { return this.nand(this.not(a), this.not(b)); }
  andAll(list) { return list.length ? list.reduce((x, y) => this.and(x, y)) : NandBuilder.C1; }
  orAll(list) { return list.length ? list.reduce((x, y) => this.or(x, y)) : NandBuilder.C0; }
  // at least k of list: T[j] = "at least j true so far"
  atLeast(k, list) {
    if (k <= 0) return NandBuilder.C1;
    if (k > list.length) return NandBuilder.C0;
    if (k === 1) return this.orAll(list);
    if (k === list.length) return this.andAll(list);
    let T = [NandBuilder.C1];
    for (let j = 1; j <= k; j++) T.push(NandBuilder.C0);
    list.forEach((x) => {
      const N = T.slice();
      for (let j = k; j >= 1; j--) N[j] = this.or(T[j], this.and(x, T[j - 1]));
      T = N;
    });
    return T[k];
  }
}

function build(node, B) {
  switch (node.op) {
    case "var": { const r = { k: "i", v: node.v }; return node.neg ? B.not(r) : r; }
    case "all": return B.andAll(node.kids.map((c) => build(c, B)));
    case "any": return B.orAll(node.kids.map((c) => build(c, B)));
    case "none": return B.not(B.orAll(node.kids.map((c) => build(c, B))));
    case "atleast": return B.atLeast(node.k, node.kids.map((c) => build(c, B)));
  }
}

function compileRule(rule, nIn) {
  if (nIn < 1) throw new Error("need at least one condition");
  const B = new NandBuilder(nIn);
  let out = build(rule, B);
  // output must be a cell
  const cells = []; // emitted [wireA, wireB]
  const wireOf = new Map();
  const wire = (r) => {
    if (r.k === "c") return r.v; // wire 0 / 1
    if (r.k === "i") return 2 + r.v;
    if (wireOf.has(r.v)) return wireOf.get(r.v);
    const [a, b] = B.cells[r.v];
    const wa = wire(a), wb = wire(b);
    const w = nIn + 2 + cells.length;
    cells.push([wa, wb]);
    wireOf.set(r.v, w);
    return w;
  };
  let constOut = null;
  if (out.k === "g") wire(out);
  else if (out.k === "i") { const w = 2 + out.v; cells.push([w, w]); cells.push([nIn + 2, nIn + 2]); }
  else { // constant rule: x NAND (x NAND x) = 1, then NOT for 0
    constOut = out.v;
    cells.push([2, 2]); cells.push([2, nIn + 2]);
    if (out.v === 0) cells.push([nIn + 3, nIn + 3]);
  }
  const hex = "0x" + cells.map(([a, b]) => "00" + a.toString(16).padStart(6, "0") + b.toString(16).padStart(6, "0")).join("");
  return { cells, hex, nIn, nOut: 1, gates: cells.length, bytes: cells.length * 7, constOut };
}

// Simulate raw netlist bytes exactly as the processor reads them.
function parseNetlist(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex, cells = [];
  for (let i = 0; i < h.length; i += 14) {
    if (h.slice(i, i + 2) !== "00") throw new Error("non-NAND opcode");
    cells.push([parseInt(h.slice(i + 2, i + 8), 16), parseInt(h.slice(i + 8, i + 14), 16)]);
  }
  return cells;
}
function simulate(cells, nIn, nOut, bits) {
  const w = new Uint8Array(2 + nIn + cells.length);
  w[1] = 1;
  for (let i = 0; i < nIn; i++) w[2 + i] = bits[i];
  for (let k = 0; k < cells.length; k++) w[2 + nIn + k] = 1 - (w[cells[k][0]] & w[cells[k][1]]);
  return Array.from(w.slice(w.length - nOut));
}

// Exhaustive proof: chip output == rule for every possible input.
function prove(rule, nIn, hex) {
  const cells = parseNetlist(hex), total = 1 << nIn, bits = new Array(nIn);
  let allow = 0;
  for (let m = 0; m < total; m++) {
    for (let i = 0; i < nIn; i++) bits[i] = (m >> i) & 1;
    const want = evalRule(rule, bits), got = simulate(cells, nIn, 1, bits)[0];
    if (want !== got) return { ok: false, total, counterexample: bits.slice(), want, got };
    allow += want;
  }
  return { ok: true, total, allow };
}

// eval(id, inputs) argument and expected return bytes for a given set of condition bits.
function evalBytes(bits) {
  const n = Math.max(1, Math.ceil(bits.length / 8)), b = new Array(n).fill(0);
  bits.forEach((v, i) => { if (v) b[i >> 3] |= 1 << (i & 7); });
  return "0x" + b.map((x) => x.toString(16).padStart(2, "0")).join("");
}

function describe(node, names) {
  switch (node.op) {
    case "var": return (node.neg ? "NOT " : "") + (names[node.v] || "?");
    case "all": return node.kids.length ? "(" + node.kids.map((c) => describe(c, names)).join(" AND ") + ")" : "(always)";
    case "any": return node.kids.length ? "(" + node.kids.map((c) => describe(c, names)).join(" OR ") + ")" : "(never)";
    case "none": return "NONE OF (" + node.kids.map((c) => describe(c, names)).join(", ") + ")";
    case "atleast": return `AT LEAST ${node.k} OF (` + node.kids.map((c) => describe(c, names)).join(", ") + ")";
  }
}

if (typeof module !== "undefined") module.exports = { evalRule, compileRule, parseNetlist, simulate, prove, evalBytes, describe };

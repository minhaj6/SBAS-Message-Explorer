/* SBAS L1 message decoder: field layouts per RTCA DO-229 Appendix A.
   Pure functions, no DOM. Every message type is described as a list of
   fields (start bit, width, sign, scale, unit, explanation), so the same
   description drives decoding, the bit map and the field table. */

const MT_NAMES = {
  0: "Do not use (test mode)",
  1: "PRN mask",
  2: "Fast corrections, slots 1–13",
  3: "Fast corrections, slots 14–26",
  4: "Fast corrections, slots 27–39",
  5: "Fast corrections, slots 40–51",
  6: "Integrity information",
  7: "Fast correction degradation",
  9: "GEO navigation message",
  10: "Degradation parameters",
  12: "SBAS network time / UTC",
  17: "GEO almanacs",
  18: "Ionospheric grid point mask",
  24: "Mixed fast / long-term corrections",
  25: "Long-term satellite corrections",
  26: "Ionospheric delay corrections",
  27: "SBAS service message",
  28: "Clock-ephemeris covariance",
  62: "Internal test message",
  63: "Null message",
};

const UDRE_M = [0.75, 1.0, 1.25, 1.75, 2.25, 3.0, 3.75, 4.5, 5.25, 6.0, 7.5, 15.0, 50.0, 150.0];
const UDRE_VAR = [0.052, 0.0924, 0.1444, 0.283, 0.4678, 0.8315, 1.2992, 1.8709, 2.5465, 3.326, 5.1968, 20.787, 230.9661, 2078.695];
const GIVE_M = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.6, 4.5, 6.0, 15.0, 45.0];
const GIVE_VAR = [0.0084, 0.0333, 0.0749, 0.1331, 0.2079, 0.2994, 0.4075, 0.5322, 0.6735, 0.8315, 1.1974, 1.8709, 3.326, 20.787, 187.0826];
const AI_FACTOR = [0, 0.00005, 0.00009, 0.00012, 0.00015, 0.0002, 0.0003, 0.00045, 0.0006, 0.0009, 0.0015, 0.0021, 0.0027, 0.0033, 0.0046, 0.0058];
const PREAMBLES = [0x53, 0x9a, 0xc6];

/* ---------- bits ---------- */

function hexToBits(hex) {
  const bits = new Uint8Array(hex.length * 4);
  for (let i = 0; i < hex.length; i++) {
    const v = parseInt(hex[i], 16);
    for (let b = 0; b < 4; b++) bits[i * 4 + b] = (v >> (3 - b)) & 1;
  }
  return bits;
}
function getU(bits, start, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 2 + bits[start + i];
  return v;
}
function getS(bits, start, len) {
  const v = getU(bits, start, len);
  return bits[start] ? v - Math.pow(2, len) : v;
}
function bitString(bits, start, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += bits[start + i];
  return s;
}
/* CRC-24Q over bits 0..225 (preamble, type, data); compared with bits 226..249. */
function crc24q(bits) {
  let crc = 0;
  for (let i = 0; i < 226; i++) {
    const msb = (crc >>> 23) & 1;
    crc = (crc << 1) & 0xffffff;
    if (msb ^ bits[i]) crc ^= 0x864cfb;
  }
  return crc;
}

/* ---------- labels ---------- */

function prnCodeName(code) {
  if (code >= 1 && code <= 37) return "G" + String(code).padStart(2, "0");
  if (code >= 38 && code <= 61) return "R" + String(code - 37).padStart(2, "0");
  if (code >= 120 && code <= 158) return "S" + code;
  return "code " + code;
}
function prnCodeSystem(code) {
  if (code >= 1 && code <= 37) return "GPS PRN " + code;
  if (code >= 38 && code <= 61) return "GLONASS slot " + (code - 37);
  if (code >= 62 && code <= 119) return "reserved for future GNSS";
  if (code >= 120 && code <= 158) return "SBAS PRN " + code;
  return "reserved";
}
function fmt(v, digits) {
  if (!isFinite(v)) return String(v);
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e7)) return v.toExponential(3);
  return Number(v.toFixed(digits == null ? 4 : digits)).toString();
}
function udreText(i) {
  if (i === 14) return "Not monitored";
  if (i === 15) return "Do not use";
  return `UDRE ${UDRE_M[i]} m (σ ${Math.sqrt(UDRE_VAR[i]).toFixed(3)} m)`;
}
function giveText(i) {
  if (i === 15) return "Not monitored";
  return `GIVE ${GIVE_M[i]} m (σ ${Math.sqrt(GIVE_VAR[i]).toFixed(3)} m)`;
}

/* ---------- IGP geometry (bands 0–10), as in RTKLIB rtklib_sbas.h ---------- */

const X1 = [-75, -65, -55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 65, 75, 85];
const X2 = [-55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const X3 = [-75, -65, -55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 65, 75];
const X4 = [-85, -75, -65, -55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 65, 75];
const range = (a, b, s) => { const r = []; for (let v = a; v < b; v += s) r.push(v); return r; };
const X5 = range(-180, 180, 5), X6 = range(-180, 180, 10), X7 = range(-180, 180, 30), X8 = range(-170, 180, 30);
const BAND_V = [
  [[-180, X1, 1, 28], [-175, X2, 29, 51], [-170, X3, 52, 78], [-165, X2, 79, 101], [-160, X3, 102, 128], [-155, X2, 129, 151], [-150, X3, 152, 178], [-145, X2, 179, 201]],
  [[-140, X4, 1, 28], [-135, X2, 29, 51], [-130, X3, 52, 78], [-125, X2, 79, 101], [-120, X3, 102, 128], [-115, X2, 129, 151], [-110, X3, 152, 178], [-105, X2, 179, 201]],
  [[-100, X3, 1, 27], [-95, X2, 28, 50], [-90, X1, 51, 78], [-85, X2, 79, 101], [-80, X3, 102, 128], [-75, X2, 129, 151], [-70, X3, 152, 178], [-65, X2, 179, 201]],
  [[-60, X3, 1, 27], [-55, X2, 28, 50], [-50, X4, 51, 78], [-45, X2, 79, 101], [-40, X3, 102, 128], [-35, X2, 129, 151], [-30, X3, 152, 178], [-25, X2, 179, 201]],
  [[-20, X3, 1, 27], [-15, X2, 28, 50], [-10, X3, 51, 77], [-5, X2, 78, 100], [0, X1, 101, 128], [5, X2, 129, 151], [10, X3, 152, 178], [15, X2, 179, 201]],
  [[20, X3, 1, 27], [25, X2, 28, 50], [30, X3, 51, 77], [35, X2, 78, 100], [40, X4, 101, 128], [45, X2, 129, 151], [50, X3, 152, 178], [55, X2, 179, 201]],
  [[60, X3, 1, 27], [65, X2, 28, 50], [70, X3, 51, 77], [75, X2, 78, 100], [80, X3, 101, 127], [85, X2, 128, 150], [90, X1, 151, 178], [95, X2, 179, 201]],
  [[100, X3, 1, 27], [105, X2, 28, 50], [110, X3, 51, 77], [115, X2, 78, 100], [120, X3, 101, 127], [125, X2, 128, 150], [130, X4, 151, 178], [135, X2, 179, 201]],
  [[140, X3, 1, 27], [145, X2, 28, 50], [150, X3, 51, 77], [155, X2, 78, 100], [160, X3, 101, 127], [165, X2, 128, 150], [170, X3, 151, 177], [175, X2, 178, 200]],
];
const BAND_H = [
  [[60, X5, 1, 72], [65, X6, 73, 108], [70, X6, 109, 144], [75, X6, 145, 180], [85, X7, 181, 192]],
  [[-60, X5, 1, 72], [-65, X6, 73, 108], [-70, X6, 109, 144], [-75, X6, 145, 180], [-85, X8, 181, 192]],
];
function igpCoords(band, bit) {
  if (band >= 0 && band <= 8) {
    for (const [lon, lats, a, b] of BAND_V[band]) if (bit >= a && bit <= b) return [lats[bit - a], lon];
  } else if (band === 9 || band === 10) {
    for (const [lat, lons, a, b] of BAND_H[band - 9]) if (bit >= a && bit <= b) return [lat, lons[bit - a]];
  }
  return null;
}
function latLonText(c) {
  if (!c) return "outside band definition";
  const [lat, lon] = c;
  return `${Math.abs(lat)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon)}°${lon >= 0 ? "E" : "W"}`;
}

/* ---------- file parsing ---------- */

/* Accepts three line formats:
   GNSS-SDR / RTKLIB : <week> <tow_s> <prn> [<type>] : <hex>
   ESA EMS           : <prn> <yy> <mm> <dd> <hh> <mm> <ss> <type> <hex>
   Lines starting with ';' or '#' are comments. */
function parseFile(text) {
  const msgs = [], errors = [], comments = [];
  const lines = text.split(/\r?\n/);
  let format = null;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === ";" || line[0] === "#") { comments.push(line); continue; }
    let m, msg = null;
    if ((m = line.match(/^(\d+)\s+([-+]?\d+(?:\.\d*)?)\s+(\d+)(?:\s+(\d+))?\s*:\s*([0-9A-Fa-f]+)\s*$/))) {
      msg = { format: "gnss-sdr", week: +m[1], tow: +m[2], prn: +m[3], typeCol: m[4] == null ? null : +m[4], hex: m[5].toUpperCase() };
      msg.cols = [["week", m[1]], ["tow", m[2]], ["prn", m[3]]];
      if (m[4] != null) msg.cols.push(["type", m[4]]);
      msg.cols.push(["sep", ":"], ["hex", m[5]]);
    } else if ((m = line.match(/^(\d+)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d*)?)\s+(\d+)\s+([0-9A-Fa-f]+)\s*$/))) {
      const yy = +m[2];
      const year = yy < 70 ? 2000 + yy : 1900 + yy;
      const sec = +m[7];
      const date = new Date(Date.UTC(year, +m[3] - 1, +m[4], +m[5], +m[6], Math.floor(sec)));
      msg = { format: "ems", prn: +m[1], date, tow: date.getTime() / 1000, typeCol: +m[8], hex: m[9].toUpperCase() };
      msg.cols = [["prn", m[1]], ["yy", m[2]], ["mon", m[3]], ["day", m[4]], ["hh", m[5]], ["min", m[6]], ["ss", m[7]], ["type", m[8]], ["hex", m[9]]];
    }
    if (!msg) { errors.push({ line: n + 1, text: line, why: "unrecognised line format" }); continue; }
    if (msg.hex.length < 63) { errors.push({ line: n + 1, text: line, why: `only ${msg.hex.length} hex digits; a frame needs at least 63 (250 bits)` }); continue; }
    format = format || msg.format;
    msg.line = n + 1;
    msg.rawLine = raw;
    msg.bits = hexToBits(msg.hex);
    msg.nbits = msg.bits.length;
    msg.preamble = getU(msg.bits, 0, 8);
    msg.mt = getU(msg.bits, 8, 6);
    msg.crcCalc = crc24q(msg.bits);
    msg.crcRx = getU(msg.bits, 226, 24);
    msg.crcOk = msg.crcCalc === msg.crcRx;
    msg.index = msgs.length;
    msgs.push(msg);
  }
  return { msgs, errors, comments, format };
}

/* ---------- masks known from the whole file ---------- */

class History {
  constructor() { this.byKey = new Map(); this.all = []; }
  add(key, t, value) {
    if (!this.byKey.has(key)) this.byKey.set(key, []);
    const entry = { t, value };
    this.byKey.get(key).push(entry);
    this.all.push(entry);
  }
  pick(list, t) {
    if (!list || !list.length) return null;
    let cur = list[0];
    for (const e of list) { if (e.t > t) break; cur = e; }
    return cur;
  }
  get(key, t) { return this.pick(this.byKey.get(key), t); }
  latest(t) { return this.pick(this.all, t); }
}

function buildContext(msgs) {
  const ctx = { prn: new Map(), igp: new Map() };
  const per = (map, prn) => { if (!map.has(prn)) map.set(prn, new History()); return map.get(prn); };
  for (const m of msgs) {
    if (!m.crcOk) continue;
    if (m.mt === 1) {
      const codes = [];
      for (let i = 0; i < 210; i++) if (m.bits[14 + i]) codes.push(i + 1);
      per(ctx.prn, m.prn).add(getU(m.bits, 224, 2), m.tow, { codes, msg: m });
    } else if (m.mt === 18) {
      const band = getU(m.bits, 18, 4), iodi = getU(m.bits, 22, 2);
      const igps = [];
      for (let i = 0; i < 201; i++) if (m.bits[24 + i]) igps.push({ bit: i + 1, coords: igpCoords(band, i + 1) });
      per(ctx.igp, m.prn).add(band + "/" + iodi, m.tow, { band, igps, msg: m });
    }
  }
  for (const h of ctx.prn.values()) h.all.sort((a, b) => a.t - b.t);
  for (const h of ctx.igp.values()) h.all.sort((a, b) => a.t - b.t);
  return ctx;
}

/* Resolve a 1-based mask slot to a satellite. Returns {name, code, via} or null. */
function resolveSlot(ctx, msg, slot, iodp) {
  const h = ctx.prn.get(msg.prn);
  if (!h) return null;
  const e = iodp == null ? h.latest(msg.tow) : h.get(iodp, msg.tow);
  if (!e) return { missing: iodp == null ? "no MT1 in file" : `no MT1 with IODP ${iodp} in file` };
  const codes = e.value.codes;
  if (slot < 1 || slot > codes.length) return { beyond: true, size: codes.length, via: e.value.msg };
  const code = codes[slot - 1];
  return { name: prnCodeName(code), code, via: e.value.msg };
}
function resolveIgp(ctx, msg, band, iodi, index) {
  const h = ctx.igp.get(msg.prn);
  const e = h && h.get(band + "/" + iodi, msg.tow);
  if (!e) return { missing: `no MT18 for band ${band}, IODI ${iodi} in file` };
  const igps = e.value.igps;
  if (index >= igps.length) return { beyond: true, size: igps.length, via: e.value.msg };
  return { ...igps[index], via: e.value.msg };
}

/* ---------- field layouts ---------- */

const D = 14; // first data bit

function F(key, name, start, len, o = {}) {
  return { key, name, start, len, signed: !!o.signed, scale: o.scale, unit: o.unit || "", desc: o.desc || "", meaning: o.meaning, group: o.group, kind: o.kind || "data", bitLabel: o.bitLabel };
}
const spare = (key, start, len, group) =>
  F(key, "Spare", start, len, { kind: "spare", group, desc: "Reserved bits, broadcast as zeros.", meaning: (r) => (r === 0 ? "All zero, as expected" : "Non-zero: unexpected for spare bits") });

const DESC = {
  iodp: "Issue of data, PRN mask. Ties this message to the MT1 mask with the same IODP, which says which satellite each slot refers to.",
  iodf: "Issue of data, fast corrections. Increments when the corrections change; IODF 3 in MT2–5 signals an alarm condition.",
  prc: "Fast pseudorange correction for this slot, added to the measured pseudorange. 12-bit two's complement, 0.125 m per count (range ±256 m).",
  udrei: "User Differential Range Error indicator. Bounds the residual range error after corrections at 99.9 %. Index 14 = not monitored, 15 = do not use.",
};

function slotMeaning(fieldSlot, iodpKey) {
  return (raw, v, all, ctx, msg) => {
    const iodp = iodpKey ? all[iodpKey] : null;
    const r = resolveSlot(ctx, msg, fieldSlot(raw, all), iodp);
    return r;
  };
}

/* Fast corrections: ``count`` PRCs then ``count`` UDREIs. For MT2-5 ``base``
   is the first slot; for MT24 (base null) the slot depends on the block ID
   and is worked out in decodeMessage. */
function fastFields(base, prcStart, udreStart, count, iodpKey) {
  const out = [];
  const group = (i) => (base == null ? `Entry ${i + 1}` : `Slot ${base + i}`);
  const slot = (i) => (base == null ? i : base + i);
  for (let i = 0; i < count; i++) {
    const f = F(`prc${i}`, "PRC", prcStart + 12 * i, 12, { signed: true, scale: 0.125, unit: "m", group: group(i), desc: DESC.prc,
      meaning: (r, v) => `${v >= 0 ? "+" : ""}${fmt(v, 3)} m correction` });
    f.slot = slot(i); f.iodpKey = iodpKey;
    out.push(f);
  }
  for (let i = 0; i < count; i++) {
    const f = F(`udrei${i}`, "UDREI", udreStart + 4 * i, 4, { group: group(i), desc: DESC.udrei, meaning: (r) => udreText(r) });
    f.slot = slot(i); f.iodpKey = iodpKey;
    out.push(f);
  }
  return out;
}

function ltcHalf(bits, s, prefix, groupPrefix) {
  const vc = bits[s];
  const out = [F(prefix + "vc", "Velocity code", s, 1, { group: groupPrefix, desc: "0: two satellites, position and clock offsets only. 1: one satellite, with velocity and clock drift terms.", meaning: (r) => (r ? "1 satellite with velocity terms" : "2 satellites, offsets only") })];
  const iodpKey = prefix + "iodp";
  if (vc === 0) {
    let p = s + 1;
    for (let k = 0; k < 2; k++) {
      const g = `${groupPrefix} · satellite ${k + 1}`;
      out.push(F(`${prefix}slot${k}`, "PRN mask slot", p, 6, { group: g, kind: "slot", iodpKey, desc: "Position of the satellite in the MT1 PRN mask (1-based). Slot 0 means this entry is unused." })); p += 6;
      out.push(F(`${prefix}iod${k}`, "IOD", p, 8, { group: g, desc: "Issue of data of the broadcast ephemeris (GPS IODE) these corrections apply to." })); p += 8;
      for (const ax of ["x", "y", "z"]) { out.push(F(`${prefix}d${ax}${k}`, `δ${ax}`, p, 9, { signed: true, scale: 0.125, unit: "m", group: g, desc: `ECEF ${ax.toUpperCase()} correction to the broadcast satellite position.` })); p += 9; }
      out.push(F(`${prefix}daf0${k}`, "δaf0", p, 10, { signed: true, scale: Math.pow(2, -31), unit: "s", group: g, desc: "Correction to the satellite clock offset.", meaning: (r, v) => `${fmt(v * 299792458, 3)} m in range` })); p += 10;
    }
    out.push(F(iodpKey, "IODP", p, 2, { group: `${groupPrefix} · issue of data`, desc: DESC.iodp })); p += 2;
    out.push(spare(prefix + "spare", p, 1, `${groupPrefix} · issue of data`));
  } else {
    let p = s + 1;
    const g = `${groupPrefix} · satellite`;
    out.push(F(`${prefix}slot0`, "PRN mask slot", p, 6, { group: g, kind: "slot", iodpKey, desc: "Position of the satellite in the MT1 PRN mask (1-based)." })); p += 6;
    out.push(F(`${prefix}iod0`, "IOD", p, 8, { group: g, desc: "Issue of data of the broadcast ephemeris these corrections apply to." })); p += 8;
    for (const ax of ["x", "y", "z"]) { out.push(F(`${prefix}d${ax}0`, `δ${ax}`, p, 11, { signed: true, scale: 0.125, unit: "m", group: g, desc: `ECEF ${ax.toUpperCase()} position correction at time t0.` })); p += 11; }
    out.push(F(`${prefix}daf00`, "δaf0", p, 11, { signed: true, scale: Math.pow(2, -31), unit: "s", group: g, desc: "Satellite clock offset correction.", meaning: (r, v) => `${fmt(v * 299792458, 3)} m in range` })); p += 11;
    const dots = { x: "ẋ", y: "ẏ", z: "ż" };
    for (const ax of ["x", "y", "z"]) { out.push(F(`${prefix}dv${ax}0`, `δ${dots[ax]}`, p, 8, { signed: true, scale: Math.pow(2, -11), unit: "m/s", group: g, desc: `Rate of change of the ECEF ${ax.toUpperCase()} correction.` })); p += 8; }
    out.push(F(`${prefix}daf10`, "δaf1", p, 8, { signed: true, scale: Math.pow(2, -39), unit: "s/s", group: g, desc: "Satellite clock drift correction." })); p += 8;
    out.push(F(`${prefix}t0`, "t0", p, 13, { scale: 16, unit: "s", group: g, desc: "Time of applicability, seconds of the day.", meaning: (r, v) => secondsOfDay(v) })); p += 13;
    out.push(F(iodpKey, "IODP", p, 2, { group: `${groupPrefix} · issue of data`, desc: DESC.iodp }));
  }
  return out;
}

function secondsOfDay(v) {
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = Math.round(v % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} of the day`;
}

function dataFields(msg) {
  const b = msg.bits, mt = msg.mt;
  const out = [];
  switch (mt) {
    case 1:
      out.push(F("mask", "PRN mask", D, 210, { kind: "mask", group: "PRN mask", desc: "One bit per PRN code: bit n set means satellite code n is corrected. Slot numbers in later messages count the set bits in order.",
        bitLabel: (i) => `bit ${i + 1}: ${prnCodeSystem(i + 1)}`,
        meaning: () => { const c = []; for (let i = 0; i < 210; i++) if (b[D + i]) c.push(prnCodeName(i + 1)); return `${c.length} satellites: ${c.join(" ")}`; } }));
      out.push(F("iodp", "IODP", 224, 2, { group: "PRN mask", desc: "Issue of data for this mask. Corrections that quote the same IODP use this mask." }));
      break;
    case 2: case 3: case 4: case 5: {
      const base = { 2: 1, 3: 14, 4: 27, 5: 40 }[mt];
      out.push(F("iodf", "IODF", D, 2, { group: "Header", desc: DESC.iodf, meaning: (r) => (r === 3 ? "3: alarm condition" : `Fast correction set ${r}`) }));
      out.push(F("iodp", "IODP", D + 2, 2, { group: "Header", desc: DESC.iodp }));
      out.push(...fastFields(base, 18, 174, 13, "iodp"));
      break;
    }
    case 0:
      out.push(F("payload", "Payload", D, 212, { kind: "spare", group: "Payload", desc: "MT0 tells receivers the GEO is in test mode and must not be used for safety-of-life navigation. WAAS fills the body with MT2 content; it is not interpreted here.", meaning: () => "Not interpreted" }));
      break;
    case 6:
      for (let i = 0; i < 4; i++) out.push(F(`iodf${i}`, `IODF${i + 2}`, D + 2 * i, 2, { group: "Header", desc: `Issue of data of the MT${i + 2} fast corrections these UDREIs apply to.` }));
      for (let i = 0; i < 51; i++) out.push(F(`udrei${i}`, "UDREI", 22 + 4 * i, 4, { group: `Slot ${i + 1}`, desc: DESC.udrei, meaning: (r) => udreText(r) }));
      out.forEach((f) => { if (f.key.startsWith("udrei")) f.slot = +f.group.split(" ")[1]; });
      break;
    case 7:
      out.push(F("latency", "System latency", D, 4, { unit: "s", scale: 1, group: "Header", desc: "Time from the start of the measurement to the arrival of the first bit of the correction at the user." }));
      out.push(F("iodp", "IODP", 18, 2, { group: "Header", desc: DESC.iodp }));
      out.push(spare("spare", 20, 2, "Header"));
      for (let i = 0; i < 51; i++) out.push(F(`ai${i}`, "aᵢ indicator", 22 + 4 * i, 4, { group: `Slot ${i + 1}`, desc: "Fast correction degradation factor indicator: how quickly confidence in the last fast correction decays with age.", meaning: (r) => `a = ${AI_FACTOR[r]} m/s²` }));
      out.forEach((f) => { if (f.key.startsWith("ai")) { f.slot = +f.group.split(" ")[1]; f.iodpKey = "iodp"; } });
      break;
    case 9: {
      const g = "GEO ephemeris";
      out.push(F("iodn", "IODN / spare", D, 8, { group: g, desc: "Issue of data, navigation (spare in older DO-229 revisions)." }));
      out.push(F("t0", "t0", 22, 13, { scale: 16, unit: "s", group: g, desc: "Reference time of the GEO ephemeris, seconds of the day.", meaning: (r, v) => secondsOfDay(v) }));
      out.push(F("ura", "URA index", 35, 4, { group: g, desc: "Accuracy of the GEO ranging signal, same scale as the GPS URA index. 15 means do not use for ranging.", meaning: (r) => (r === 15 ? "Do not use for ranging" : `URA index ${r}`) }));
      out.push(F("x", "X", 39, 30, { signed: true, scale: 0.08, unit: "m", group: g, desc: "GEO position, ECEF X.",
        meaning: (r, v, all) => `Sub-satellite longitude ${fmt((Math.atan2(all.y * 0.08, v) * 180) / Math.PI, 2)}°` }));
      out.push(F("y", "Y", 69, 30, { signed: true, scale: 0.08, unit: "m", group: g, desc: "GEO position, ECEF Y." }));
      out.push(F("z", "Z", 99, 25, { signed: true, scale: 0.4, unit: "m", group: g, desc: "GEO position, ECEF Z." }));
      out.push(F("vx", "Ẋ", 124, 17, { signed: true, scale: 0.000625, unit: "m/s", group: g, desc: "GEO velocity, ECEF X." }));
      out.push(F("vy", "Ẏ", 141, 17, { signed: true, scale: 0.000625, unit: "m/s", group: g, desc: "GEO velocity, ECEF Y." }));
      out.push(F("vz", "Ż", 158, 18, { signed: true, scale: 0.004, unit: "m/s", group: g, desc: "GEO velocity, ECEF Z." }));
      out.push(F("ax", "Ẍ", 176, 10, { signed: true, scale: 0.0000125, unit: "m/s²", group: g, desc: "GEO acceleration, ECEF X." }));
      out.push(F("ay", "Ÿ", 186, 10, { signed: true, scale: 0.0000125, unit: "m/s²", group: g, desc: "GEO acceleration, ECEF Y." }));
      out.push(F("az", "Z̈", 196, 10, { signed: true, scale: 0.0000625, unit: "m/s²", group: g, desc: "GEO acceleration, ECEF Z." }));
      out.push(F("agf0", "aGf0", 206, 12, { signed: true, scale: Math.pow(2, -31), unit: "s", group: "GEO clock", desc: "GEO clock offset relative to SBAS network time.", meaning: (r, v) => `${fmt(v * 299792458, 2)} m in range` }));
      out.push(F("agf1", "aGf1", 218, 8, { signed: true, scale: Math.pow(2, -40), unit: "s/s", group: "GEO clock", desc: "GEO clock drift." }));
      break;
    }
    case 10: {
      const g = "Degradation parameters";
      const spec = [
        ["brrc", "Brrc", 10, 0.002, "m", "Bound on noise and round-off error in the range-rate correction."],
        ["cltclsb", "Cltc_lsb", 10, 0.002, "m", "Maximum round-off error of the long-term correction."],
        ["cltcv1", "Cltc_v1", 10, 0.00005, "m/s", "Velocity error bound, long-term corrections with velocity code 1."],
        ["iltcv1", "Iltc_v1", 9, 1, "s", "Update interval, long-term corrections with velocity code 1."],
        ["cltcv0", "Cltc_v0", 10, 0.002, "m", "Error bound between successive long-term corrections, velocity code 0."],
        ["iltcv0", "Iltc_v0", 9, 1, "s", "Minimum update interval, long-term corrections with velocity code 0."],
        ["cgeolsb", "Cgeo_lsb", 10, 0.0005, "m", "Maximum round-off error of the GEO navigation message."],
        ["cgeov", "Cgeo_v", 10, 0.00005, "m/s", "Velocity error bound of the GEO navigation message."],
        ["igeo", "Igeo", 9, 1, "s", "Update interval of the GEO navigation message."],
        ["cer", "Cer", 6, 0.5, "m", "Degradation bound applied when en-route fast or long-term corrections are missing."],
        ["cionostep", "Ciono_step", 10, 0.001, "m", "Bound on the change between successive ionospheric grid delays."],
        ["iiono", "Iiono", 9, 1, "s", "Minimum update interval of ionospheric corrections."],
        ["cionoramp", "Ciono_ramp", 10, 0.000005, "m/s", "Rate of change of the ionospheric corrections."],
        ["rssudre", "RSS_UDRE", 1, 1, "", "0: degradation terms add linearly to UDRE. 1: root-sum-square."],
        ["rssiono", "RSS_iono", 1, 1, "", "0: degradation terms add linearly to GIVE. 1: root-sum-square."],
        ["ccov", "Ccovariance", 7, 0.1, "", "Bound on round-off error in the MT28 covariance."],
      ];
      let p = D;
      for (const [key, name, len, scale, unit, desc] of spec) { out.push(F(key, name, p, len, { scale, unit, group: g, desc })); p += len; }
      out.push(spare("spare", p, 226 - p, g));
      break;
    }
    case 12: {
      const g = "Time parameters";
      const spec = [
        ["a1", "A1snt", 24, true, Math.pow(2, -50), "s/s", "Drift of SBAS network time relative to UTC."],
        ["a0", "A0snt", 32, true, Math.pow(2, -30), "s", "Offset of SBAS network time relative to UTC."],
        ["t0t", "t0t", 8, false, 4096, "s", "Reference time of the UTC parameters."],
        ["wnt", "WNt", 8, false, 1, "", "UTC reference week number (8 LSBs)."],
        ["dtls", "ΔtLS", 8, true, 1, "s", "Current leap-second count."],
        ["wnlsf", "WNLSF", 8, false, 1, "", "Week of the next leap-second event."],
        ["dn", "DN", 8, false, 1, "", "Day of the week of the next leap-second event."],
        ["dtlsf", "ΔtLSF", 8, true, 1, "s", "Leap-second count after the event."],
        ["utcid", "UTC standard ID", 3, false, 1, "", "Which UTC realisation the parameters refer to (NIST, USNO, …)."],
        ["gpstow", "GPS TOW", 20, false, 1, "s", "GPS time of week."],
        ["gpswn", "GPS week", 10, false, 1, "", "GPS week number (10 bits)."],
        ["gloind", "GLONASS indicator", 1, false, 1, "", "1 if GLONASS time parameters are provided."],
      ];
      let p = D;
      for (const [key, name, len, signed, scale, unit, desc] of spec) { out.push(F(key, name, p, len, { signed, scale, unit, group: g, desc })); p += len; }
      out.push(spare("spare", p, 226 - p, g));
      break;
    }
    case 17: {
      let p = D;
      for (let k = 0; k < 3; k++) {
        const g = `Almanac ${k + 1}`;
        out.push(F(`id${k}`, "Data ID", p, 2, { group: g, desc: "Data identifier, 00 for almanac data." })); p += 2;
        out.push(F(`prn${k}`, "PRN", p, 8, { group: g, desc: "PRN of the GEO this almanac describes. 0 means the entry is unused.", meaning: (r) => (r ? `SBAS PRN ${r}` : "Unused entry") })); p += 8;
        out.push(F(`health${k}`, "Health and status", p, 8, { group: g, desc: "Bit flags: ranging, corrections and integrity availability, plus service provider ID in the upper bits." })); p += 8;
        out.push(F(`x${k}`, "X", p, 15, { signed: true, scale: 2600, unit: "m", group: g, desc: "GEO position, ECEF X (coarse)." })); p += 15;
        out.push(F(`y${k}`, "Y", p, 15, { signed: true, scale: 2600, unit: "m", group: g, desc: "GEO position, ECEF Y (coarse)." })); p += 15;
        out.push(F(`z${k}`, "Z", p, 9, { signed: true, scale: 26000, unit: "m", group: g, desc: "GEO position, ECEF Z (coarse)." })); p += 9;
        out.push(F(`vx${k}`, "Ẋ", p, 3, { signed: true, scale: 10, unit: "m/s", group: g, desc: "GEO velocity, ECEF X." })); p += 3;
        out.push(F(`vy${k}`, "Ẏ", p, 3, { signed: true, scale: 10, unit: "m/s", group: g, desc: "GEO velocity, ECEF Y." })); p += 3;
        out.push(F(`vz${k}`, "Ż", p, 4, { signed: true, scale: 40.96, unit: "m/s", group: g, desc: "GEO velocity, ECEF Z." })); p += 4;
      }
      out.push(F("t0", "t0", p, 11, { scale: 64, unit: "s", group: "Almanac time", desc: "Almanac reference time, seconds of the day.", meaning: (r, v) => secondsOfDay(v) }));
      break;
    }
    case 18: {
      const band = getU(b, 18, 4);
      out.push(F("nbands", "Bands broadcast", D, 4, { group: "Header", desc: "How many IGP bands this SBAS broadcasts in total." }));
      out.push(F("band", "Band", 18, 4, { group: "Header", desc: "Band number. Bands 0–8 are 40° longitude strips, 9 and 10 cover the north and south polar caps.", meaning: (r) => (r <= 8 ? `${-180 + 40 * r}° to ${-145 + 40 * r}° longitude` : r === 9 ? "North of 60°" : r === 10 ? "South of 60°S" : "Invalid band") }));
      out.push(F("iodi", "IODI", 22, 2, { group: "Header", desc: "Issue of data, ionosphere. MT26 messages with the same band and IODI use this mask." }));
      out.push(F("mask", "IGP mask", 24, 201, { kind: "mask", group: "IGP mask", desc: "One bit per ionospheric grid point in the band. MT26 delays fill the set bits in order, 15 per block.",
        bitLabel: (i) => `bit ${i + 1}: IGP ${latLonText(igpCoords(band, i + 1))}`,
        meaning: () => { let n = 0; for (let i = 0; i < 201; i++) n += b[24 + i]; return `${n} grid points set`; } }));
      out.push(spare("spare", 225, 1, "IGP mask"));
      break;
    }
    case 24:
      out.push(...fastFields(null, D, 86, 6, "iodp"));
      out.push(F("iodp", "IODP", 110, 2, { group: "Fast corrections", desc: DESC.iodp }));
      out.push(F("block", "Block ID", 112, 2, { group: "Fast corrections", desc: "Which group of 13 slots the six fast corrections belong to: slots 13·block+1 to 13·block+6." }));
      out.push(F("iodf", "IODF", 114, 2, { group: "Fast corrections", desc: DESC.iodf }));
      out.push(spare("spare", 116, 4, "Fast corrections"));
      out.push(...ltcHalf(b, 120, "h1", "Long-term half"));
      break;
    case 25:
      out.push(...ltcHalf(b, D, "h0", "First half"));
      out.push(...ltcHalf(b, 120, "h1", "Second half"));
      break;
    case 26: {
      out.push(F("band", "Band", D, 4, { group: "Header", desc: "IGP band these delays belong to." }));
      out.push(F("block", "Block ID", 18, 4, { group: "Header", desc: "Block of 15 grid points within the band mask: points 15·block+1 to 15·block+15.", meaning: (r) => `Mask points ${15 * r + 1}–${15 * r + 15}` }));
      for (let i = 0; i < 15; i++) {
        const g = `Grid point ${i + 1}`;
        out.push(F(`delay${i}`, "Vertical delay", 22 + 13 * i, 9, { scale: 0.125, unit: "m", group: g, igpIndex: i, desc: "Vertical ionospheric delay at the grid point, on L1. 511 means do not use.", meaning: (r, v) => (r === 511 ? "Do not use" : `${fmt(v, 3)} m vertical delay`) }));
        out.push(F(`givei${i}`, "GIVEI", 31 + 13 * i, 4, { group: g, igpIndex: i, desc: "Grid Ionospheric Vertical Error indicator: 99.9 % bound on the vertical delay error. 15 means not monitored.", meaning: (r) => giveText(r) }));
      }
      out.push(F("iodi", "IODI", 217, 2, { group: "Trailer", desc: "Issue of data, ionosphere. Must match the MT18 mask for this band." }));
      out.push(spare("spare", 219, 7, "Trailer"));
      out.forEach((f) => { if (f.key.startsWith("delay") || f.key.startsWith("givei")) f.igpIndex = +f.group.split(" ")[2] - 1; });
      break;
    }
    case 27: {
      const g = "Service message";
      const spec = [["iods", "IODS", 3], ["nmsg", "Number of service messages", 3], ["msgnum", "Service message number", 3], ["nreg", "Number of regions", 3], ["prio", "Priority code", 2], ["dudrein", "δUDRE indicator inside", 4], ["dudreout", "δUDRE indicator outside", 4]];
      let p = D;
      for (const [key, name, len] of spec) { out.push(F(key, name, p, len, { group: g, desc: name + "." })); p += len; }
      for (let k = 0; k < 5; k++) {
        const rg = `Region ${k + 1}`;
        out.push(F(`lat1${k}`, "Latitude 1", p, 8, { signed: true, unit: "°", scale: 1, group: rg, desc: "First corner latitude." })); p += 8;
        out.push(F(`lon1${k}`, "Longitude 1", p, 9, { signed: true, unit: "°", scale: 1, group: rg, desc: "First corner longitude." })); p += 9;
        out.push(F(`lat2${k}`, "Latitude 2", p, 8, { signed: true, unit: "°", scale: 1, group: rg, desc: "Second corner latitude." })); p += 8;
        out.push(F(`lon2${k}`, "Longitude 2", p, 9, { signed: true, unit: "°", scale: 1, group: rg, desc: "Second corner longitude." })); p += 9;
        out.push(F(`shape${k}`, "Region shape", p, 1, { group: rg, desc: "0: triangle, 1: quadrangle." })); p += 1;
      }
      out.push(spare("spare", p, 226 - p, g));
      break;
    }
    case 28: {
      out.push(F("iodp", "IODP", D, 2, { group: "Header", desc: DESC.iodp }));
      let p = 16;
      for (let k = 0; k < 2; k++) {
        const g = `Satellite ${k + 1}`;
        out.push(F(`slot${k}`, "PRN mask slot", p, 6, { group: g, kind: "slot", iodpKey: "iodp", desc: "Satellite position in the MT1 mask. 0 means unused." })); p += 6;
        out.push(F(`sexp${k}`, "Scale exponent", p, 3, { group: g, desc: "Scale factor 2^(exponent−5) applied to the Cholesky factor elements.", meaning: (r) => `scale 2^${r - 5}` })); p += 3;
        for (const [name, len, signed] of [["E1,1", 9, false], ["E2,2", 9, false], ["E3,3", 9, false], ["E4,4", 9, false], ["E1,2", 10, true], ["E1,3", 10, true], ["E1,4", 10, true], ["E2,3", 10, true], ["E2,4", 10, true], ["E3,4", 10, true]]) {
          out.push(F(`e${name.replace(",", "")}${k}`, name, p, len, { signed, group: g, desc: "Element of the upper-triangular Cholesky factor of the clock-ephemeris covariance." })); p += len;
        }
      }
      break;
    }
    case 63:
      out.push(spare("spare", D, 212, "Null message"));
      break;
    default:
      out.push(F("payload", "Payload", D, 212, { kind: "spare", group: "Payload", desc: "No layout is defined here for this message type.", meaning: () => "Not interpreted" }));
  }
  return out;
}

function headerFields(msg) {
  return [
    F("preamble", "Preamble", 0, 8, { kind: "header", group: "Frame header", desc: "8 bits of the 24-bit unique word 0x53 9A C6, sent one byte per message in rotation. It marks the start of each 1-second frame.",
      meaning: (r) => { const i = PREAMBLES.indexOf(r); return i < 0 ? "Not a valid SBAS preamble" : `0x${r.toString(16).toUpperCase()}: part ${i + 1} of 3 of the unique word`; } }),
    F("type", "Message type", 8, 6, { kind: "header", group: "Frame header", desc: "Message type identifier (0–63).", meaning: (r) => `MT${r}: ${MT_NAMES[r] || "unassigned"}` }),
  ];
}
function trailerFields(msg) {
  const out = [F("crc", "CRC-24Q parity", 226, 24, { kind: "crc", group: "Parity", desc: "24-bit cyclic redundancy check over the preceding 226 bits (polynomial 0x1864CFB). A mismatch means the frame is corrupted and must be discarded.",
    meaning: () => (msg.crcOk ? "Matches computed CRC" : `Mismatch: computed 0x${msg.crcCalc.toString(16).toUpperCase().padStart(6, "0")}`) })];
  if (msg.nbits > 250) out.push(F("pad", "Padding", 250, msg.nbits - 250, { kind: "pad", group: "Parity", desc: "Fill bits added so the 250-bit frame is a whole number of hex digits. Not transmitted.", meaning: (r) => (r === 0 ? "Zero" : "Non-zero padding") }));
  return out;
}

/* Decode one message: returns the field list with raw, value and meaning. */
function decodeMessage(msg, ctx) {
  const fields = [...headerFields(msg), ...dataFields(msg), ...trailerFields(msg)];
  const all = {};
  for (const f of fields) {
    if (f.len > 48) { f.raw = null; continue; }
    f.raw = f.signed ? getS(msg.bits, f.start, f.len) : getU(msg.bits, f.start, f.len);
    all[f.key] = f.raw;
  }
  for (const f of fields) {
    f.bitsText = f.len <= 64 ? bitString(msg.bits, f.start, f.len) : null;
    f.value = f.raw != null && f.scale != null ? f.raw * f.scale : null;
    let meaning = "";
    try { meaning = f.meaning ? f.meaning(f.raw, f.value, all, ctx, msg) : ""; } catch (e) { meaning = ""; }
    f.meaningText = meaning || "";
    // Slot references (fast corrections, MT7, MT28, long-term halves)
    const slot = f.kind === "slot" ? f.raw : f.slot;
    if (slot != null && (f.kind === "slot" || f.slot != null)) {
      if (f.kind === "slot" && slot === 0) { f.sat = { unused: true }; }
      else {
        const iodp = f.iodpKey ? all[f.iodpKey] : null;
        let s = slot;
        if (msg.mt === 24 && f.slot != null) s = 13 * all.block + f.slot + 1;
        f.slotResolved = s;
        f.sat = resolveSlot(ctx, msg, s, iodp);
      }
    }
    if (f.igpIndex != null && msg.mt === 26) {
      const idx = 15 * all.block + f.igpIndex;
      f.igp = resolveIgp(ctx, msg, all.band, all.iodi, idx);
      f.igpMaskIndex = idx;
    }
  }
  // Group labels for slot / IGP groups
  for (const f of fields) {
    if (f.sat && f.sat.name && f.slot != null) f.groupLabel = `Slot ${f.slotResolved} · ${f.sat.name}`;
    else if (f.sat && f.sat.beyond && f.slot != null) f.groupLabel = `Slot ${f.slotResolved} · past end of mask`;
    else if (f.igp && f.igp.coords) f.groupLabel = `Grid point ${f.igpMaskIndex + 1} · ${latLonText(f.igp.coords)}`;
    else if (f.igp && f.igp.beyond) f.groupLabel = `Grid point ${f.igpMaskIndex + 1} · past end of mask`;
    if (f.kind === "slot" && f.sat) {
      f.meaningText = f.sat.unused ? "Unused entry" : f.sat.name ? `${f.sat.name} (${prnCodeSystem(f.sat.code)})` : f.sat.beyond ? "Past the end of the mask" : f.sat.missing || "";
    }
  }
  return fields;
}

/* One-line summary for the message list. */
function summarize(msg, ctx) {
  const b = msg.bits;
  switch (msg.mt) {
    case 1: { let n = 0; for (let i = 0; i < 210; i++) n += b[D + i]; return `${n} satellites · IODP ${getU(b, 224, 2)}`; }
    case 2: case 3: case 4: case 5: {
      let mon = 0; for (let i = 0; i < 13; i++) if (getU(b, 174 + 4 * i, 4) < 14) mon++;
      return `IODF ${getU(b, D, 2)} · ${mon} monitored`;
    }
    case 6: { let mon = 0; for (let i = 0; i < 51; i++) if (getU(b, 22 + 4 * i, 4) < 14) mon++; return `${mon} slots monitored`; }
    case 9: return `t0 ${secondsOfDay(getU(b, 22, 13) * 16).split(" ")[0]} · URA ${getU(b, 35, 4)}`;
    case 18: { let n = 0; for (let i = 0; i < 201; i++) n += b[24 + i]; return `band ${getU(b, 18, 4)} · ${n} IGPs · IODI ${getU(b, 22, 2)}`; }
    case 24: case 25: case 28: {
      const fields = decodeMessage(msg, ctx).filter((f) => f.kind === "slot" && f.sat && f.sat.name);
      return fields.map((f) => f.sat.name).join(", ") || "no satellites";
    }
    case 26: return `band ${getU(b, D, 4)} · block ${getU(b, 18, 4)}`;
    default: return "";
  }
}

if (typeof module !== "undefined") module.exports = { parseFile, buildContext, decodeMessage, summarize, MT_NAMES, crc24q, hexToBits };

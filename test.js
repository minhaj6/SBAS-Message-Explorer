const fs = require("fs");
const d = require("./decoder.js");
const f = process.argv[2];
const { msgs, errors, format } = d.parseFile(fs.readFileSync(f, "utf8"));
const ctx = d.buildContext(msgs);
console.log(f.split("/").pop(), "format", format, "frames", msgs.length, "errors", errors.length, "crc bad", msgs.filter(m => !m.crcOk).length);
const types = {};
for (const m of msgs) {
  const fields = d.decodeMessage(m, ctx);
  const end = fields[fields.length - 1];
  // layout sanity: fields tile bits 0..nbits contiguous
  let p = 0;
  for (const x of fields) { if (x.start !== p) { console.log("GAP/OVERLAP MT", m.mt, "at", x.key, x.start, "expected", p); break; } p += x.len; }
  if (p !== m.nbits) console.log("length mismatch MT", m.mt, p, m.nbits);
  types[m.mt] = (types[m.mt] || 0) + 1;
}
console.log("types", JSON.stringify(types));
if (process.argv[3]) {
  const m = msgs.find(m => m.mt === +process.argv[3]);
  for (const x of d.decodeMessage(m, ctx)) if (x.kind !== "spare") console.log(`${(x.groupLabel || x.group).padEnd(34)} ${x.name.padEnd(14)} ${String(x.start).padStart(3)}+${x.len} raw=${x.raw} val=${x.value} | ${x.meaningText.slice(0, 70)}`);
  console.log("summary:", d.summarize(m, ctx));
}

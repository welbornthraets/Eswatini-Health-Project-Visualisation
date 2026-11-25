"use strict";
/* Shared by the public site and the admin page: the combined patient dataset, its
   encryption, CSV import/export and the views the map and the Charts tab read.

   Combined row layout (one row per patient):
     0 participant id, 1 area, 2 constituency, 3 region, 4 helminth ("Yes"/"No"/"Unknown"),
     5 TB type ("DSTB"/"MDR-TB"), 6 HIV ("Positive"/"Negative"), 7 gender, 8 age,
     9 outcome ("Alive"/"Died"), 10 lat, 11 lon, 12 spread lat, 13 spread lon,
     14 location: "data" (given) or "estimated" (filled from nearby patients)
   The encrypted file holds {version: 2, updatedAt, rows}. */
(function(){
  const ITERATIONS = 250000;
  const ESWATINI = {latMin:-27.5, latMax:-25.6, lonMin:30.7, lonMax:32.2, lat:-26.5, lon:31.5};

  /* ---------------- encryption (AES-GCM, key from PBKDF2-SHA256) ---------------- */
  function b64ToBytes(b64){ const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function bytesToB64(bytes){ let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  async function deriveKey(password, salt, iterations, usage){
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), {name:"PBKDF2"}, false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, [usage]);
  }
  async function decrypt(payload, password){
    const key = await deriveKey(password, b64ToBytes(payload.salt), payload.iterations, "decrypt");
    const buf = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64ToBytes(payload.iv)}, key, b64ToBytes(payload.data));
    return JSON.parse(new TextDecoder().decode(buf));
  }
  async function encrypt(obj, password){
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITERATIONS, "encrypt");
    const data = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify(obj))));
    return {salt:bytesToB64(salt), iv:bytesToB64(iv), data:bytesToB64(data), iterations:ITERATIONS};
  }

  /* ---------------- views for the map and the Charts tab ---------------- */
  // Map row: 0 area, 1 constituency, 2 region, 3 mdr(0/1), 4 hiv+(0/1), 5 sex, 6 age, 7 died(0/1), 8 lat, 9 lon, 10 spread lat, 11 spread lon
  const toMapRows = rows => rows.map(r => [r[1], r[2], r[3], r[5]==="MDR-TB"?1:0, r[6]==="Positive"?1:0, r[7], r[8], r[9]==="Died"?1:0, r[10], r[11], r[12], r[13]]);
  // Cohort row: id, area, constituency, region, helminth, tbType, hiv, gender, age, status
  const toCohortRows = rows => rows.map(r => r.slice(0, 10));

  /* ---------------- normalising values typed or uploaded by admins ---------------- */
  const clean = v => String(v == null ? "" : v).trim();
  const low = v => clean(v).toLowerCase();
  function normTb(v){ const s = low(v).replace(/[\s_]/g, ""); if (/^(mdr|mdr-?tb|multidrug|1|yes)/.test(s)) return "MDR-TB"; if (/^(ds|ds-?tb|dstb|drug-?sensitive|sensitive|0|no)/.test(s)) return "DSTB"; return null; }
  function normHiv(v){ const s = low(v); if (/^(positive|pos|\+|1|yes|y|reactive)$/.test(s)) return "Positive"; if (/^(negative|neg|-|0|no|n|non-?reactive)$/.test(s)) return "Negative"; return null; }
  function normGender(v){ const s = low(v); if (/^(f|female|woman|w)$/.test(s)) return "Female"; if (/^(m|male|man)$/.test(s)) return "Male"; return null; }
  function normStatus(v){ const s = low(v); if (/^(died|dead|death|deceased|1|yes)$/.test(s)) return "Died"; if (/^(alive|living|survived|0|no)$/.test(s)) return "Alive"; return null; }
  function normHelminth(v){ const s = low(v); if (s === "") return "Unknown"; if (/^(yes|y|1|enrolled|true)$/.test(s)) return "Yes"; if (/^(no|n|0|not enrolled|false)$/.test(s)) return "No"; if (s === "unknown") return "Unknown"; return null; }
  // Title case for typed names, keeping the existing spelling when the name is already in the data.
  const titleCase = s => clean(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/'S\b/g, "'s");

  /* ---------------- CSV ---------------- */
  function parseCsv(text){
    const rows = []; let row = [], field = "", q = false, i = 0;
    text = String(text).replace(/^﻿/, "");
    while (i < text.length){
      const c = text[i];
      if (q){
        if (c === '"'){ if (text[i+1] === '"'){ field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"'){ q = true; i++; continue; }
      if (c === "," || c === ";" || c === "\t"){ row.push(field); field = ""; i++; continue; }
      if (c === "\r"){ i++; continue; }
      if (c === "\n"){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length){ row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => clean(f) !== ""));
  }
  // Accepted header names for each field (case and spacing ignored).
  const HEADERS = {
    id:["participant_id","participant id","id","patient_id","patient id","pid"],
    area:["area","village","community","residential_area","residence"],
    constituency:["constituency","inkhundla","tinkhundla"],
    region:["region","district"],
    helminth:["helminth","helminth_study","helminth study","helminth_enrolled"],
    tbType:["tb_type","tb type","tbtype","tb","mdr","mdr_tb","drug_resistance"],
    hiv:["hiv","hiv_status","hiv status"],
    gender:["gender","sex"],
    age:["age","age_years","age (years)"],
    status:["status","outcome","died","vital_status"],
    lat:["lat","latitude","y"],
    lon:["lon","lng","long","longitude","x"],
  };
  const FIELD_ORDER = ["id","area","constituency","region","tbType","hiv","gender","age","helminth","status","lat","lon"];
  const TEMPLATE_HEADER = ["participant_id","area","constituency","region","tb_type","hiv_status","gender","age","helminth","status","lat","lon"];
  function mapHeader(header){
    const idx = {};
    header.forEach((h, i) => {
      const k = low(h).replace(/\s+/g, " ");
      for (const f in HEADERS) if (idx[f] === undefined && (HEADERS[f].includes(k) || HEADERS[f].includes(k.replace(/ /g, "_")))) idx[f] = i;
    });
    return idx;
  }
  function csvCell(v){
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // keep spreadsheets from running it as a formula
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows){
    const lines = [TEMPLATE_HEADER.concat(["location"]).join(",")];
    rows.forEach(r => lines.push([r[0], r[1], r[2], r[3], r[5], r[6], r[7], r[8], r[4], r[9], r[10], r[11], r[14]].map(csvCell).join(",")));
    return lines.join("\r\n") + "\r\n";
  }
  const templateCsv = () => TEMPLATE_HEADER.join(",") + "\r\nTB-0001,Example Area,Mbabane East,Hhohho,DSTB,Positive,Female,34,No,Alive,-26.3167,31.1333\r\n";

  /* ---------------- locations ---------------- */
  const inEswatini = (lat, lon) => lat >= ESWATINI.latMin && lat <= ESWATINI.latMax && lon >= ESWATINI.lonMin && lon <= ESWATINI.lonMax;
  const key5 = (lat, lon) => lat.toFixed(5) + "," + lon.toFixed(5);
  // Average position of existing patients in the same area, else constituency, else region.
  function locator(rows){
    const groups = {area:new Map(), cons:new Map(), region:new Map()};
    const add = (m, k, r) => { if (!k) return; const g = m.get(k) || {lat:0, lon:0, n:0}; g.lat += r[10]; g.lon += r[11]; g.n++; m.set(k, g); };
    rows.forEach(r => {
      if (!(typeof r[10] === "number" && typeof r[11] === "number")) return;
      add(groups.area, low(r[3]) + "|" + low(r[2]) + "|" + low(r[1]), r);
      add(groups.cons, low(r[3]) + "|" + low(r[2]), r);
      add(groups.region, low(r[3]), r);
    });
    return (area, cons, region) => {
      for (const [m, k] of [[groups.area, low(region)+"|"+low(cons)+"|"+low(area)], [groups.cons, low(region)+"|"+low(cons)], [groups.region, low(region)]]){
        const g = m.get(k); if (g) return {lat:g.lat/g.n, lon:g.lon/g.n};
      }
      return null;
    };
  }
  // Patients sharing one coordinate are drawn around it on a small spiral so they don't stack.
  function addSpread(rows, newRows){
    const used = new Map();
    rows.forEach(r => { const k = key5(r[10], r[11]); used.set(k, (used.get(k) || 0) + 1); });
    newRows.forEach(r => {
      const k = key5(r[10], r[11]), n = used.get(k) || 0;
      used.set(k, n + 1);
      if (n === 0){ r[12] = r[10]; r[13] = r[11]; return; }
      const a = n * 2.399963, rad = 0.0016 * Math.sqrt(n);
      r[12] = +(r[10] + rad * Math.sin(a)).toFixed(6);
      r[13] = +(r[11] + rad * Math.cos(a) / Math.cos(r[10] * Math.PI / 180)).toFixed(6);
    });
  }

  /* ---------------- checking new rows ---------------- */
  // records: arrays of raw strings in FIELD_ORDER. Returns {rows, errors:[{line, message}]}.
  function buildRows(records, existing, opts){
    const startLine = (opts && opts.startLine) || 2;
    const out = [], errors = [];
    const ids = new Set(existing.map(r => low(r[0])));
    const neighbours = (opts && opts.locateFrom) || existing;
    const names = {region:new Map(), constituency:new Map(), area:new Map()};
    neighbours.forEach(r => { names.region.set(low(r[3]), r[3]); names.constituency.set(low(r[2]), r[2]); names.area.set(low(r[1]), r[1]); });
    const pick = (kind, v) => names[kind].get(low(v)) || titleCase(v);
    const locate = locator(neighbours);
    records.forEach((rec, i) => {
      const line = startLine + i, v = f => clean(rec[FIELD_ORDER.indexOf(f)]);
      const problems = [];
      const id = v("id"); if (!id) problems.push("participant ID is empty"); else if (ids.has(low(id))) problems.push(`participant ID ${id} is already in the data`);
      const area = v("area"), cons = v("constituency"), region = v("region");
      if (!area) problems.push("area is empty");
      if (!cons) problems.push("constituency is empty");
      if (!region) problems.push("region is empty");
      const tb = normTb(v("tbType")); if (!tb) problems.push(`TB type "${v("tbType")}" should be DSTB or MDR-TB`);
      const hiv = normHiv(v("hiv")); if (!hiv) problems.push(`HIV status "${v("hiv")}" should be Positive or Negative`);
      const gender = normGender(v("gender")); if (!gender) problems.push(`gender "${v("gender")}" should be Female or Male`);
      const ageS = v("age"), age = Number(ageS);
      if (!/^\d{1,3}(\.0+)?$/.test(ageS) || age < 0 || age > 120) problems.push(`age "${ageS}" should be a whole number of years`);
      const helminth = normHelminth(v("helminth")); if (!helminth) problems.push(`helminth "${v("helminth")}" should be Yes, No or blank`);
      const status = normStatus(v("status")); if (!status) problems.push(`outcome "${v("status")}" should be Alive or Died`);
      let lat = v("lat"), lon = v("lon"), loc = "data";
      if (lat !== "" || lon !== ""){
        lat = Number(lat); lon = Number(lon);
        if (!isFinite(lat) || !isFinite(lon) || !inEswatini(lat, lon)) problems.push(`location ${v("lat")}, ${v("lon")} is not inside Eswatini`);
      } else if (area && cons && region){
        const p = locate(area, cons, region);
        if (p){ lat = +p.lat.toFixed(6); lon = +p.lon.toFixed(6); loc = "estimated"; }
        else problems.push("no lat/lon given and no other patients in that area, constituency or region to place it near");
      }
      if (problems.length){ errors.push({line, id, message:problems.join("; ")}); return; }
      ids.add(low(id));
      out.push([id, pick("area", area), pick("constituency", cons), pick("region", region), helminth, tb, hiv, gender, Math.round(age), status, lat, lon, lat, lon, loc]);
    });
    addSpread(existing, out);
    return {rows:out, errors};
  }
  function recordsFromCsv(text){
    const table = parseCsv(text);
    if (!table.length) return {records:[], missing:FIELD_ORDER.slice(0, 10)};
    const idx = mapHeader(table[0]);
    const missing = FIELD_ORDER.filter(f => idx[f] === undefined && !["lat","lon","helminth"].includes(f));
    const records = table.slice(1).map(row => FIELD_ORDER.map(f => idx[f] === undefined ? "" : row[idx[f]]));
    return {records, missing};
  }

  /* ---------------- one-time merge of the old map data and cohort data ---------------- */
  // Each cohort patient takes the location of a map patient with the same details
  // (same area first, then same constituency); the rest are placed near their neighbours.
  function combineLegacy(mapRows, cohortRows, keepMapOnly){
    const g = s => { const n = normGender(s); return n ? n[0] : low(s); };
    const pool = mapRows.map((m, i) => ({i, used:false, m,
      exact: [low(m[2]), low(m[1]), low(m[0]), m[3], m[4], g(m[5]), m[6], m[7]].join("|"),
      loose: [low(m[2]), low(m[1]), m[3], m[4], g(m[5]), m[6], m[7]].join("|")}));
    const byExact = new Map(), byLoose = new Map();
    pool.forEach(p => { (byExact.get(p.exact) || byExact.set(p.exact, []).get(p.exact)).push(p); (byLoose.get(p.loose) || byLoose.set(p.loose, []).get(p.loose)).push(p); });
    const take = list => { const p = (list || []).find(x => !x.used); if (p) p.used = true; return p; };
    const report = {exact:0, constituency:0, estimated:0, unplaced:0, mapOnly:0, cohort:cohortRows.length, map:mapRows.length};
    const rows = [], pending = [];
    cohortRows.forEach(c => {
      const mdr = c[5] === "MDR-TB" ? 1 : 0, hiv = c[6] === "Positive" ? 1 : 0, died = c[9] === "Died" ? 1 : 0;
      const ex = [low(c[3]), low(c[2]), low(c[1]), mdr, hiv, g(c[7]), c[8], died].join("|");
      const lo = [low(c[3]), low(c[2]), mdr, hiv, g(c[7]), c[8], died].join("|");
      let p = take(byExact.get(ex)), how = "exact";
      if (!p){ p = take(byLoose.get(lo)); how = "constituency"; }
      const row = [String(c[0]), c[1], c[2], c[3], normHelminth(c[4]) || "Unknown", c[5], c[6], c[7], c[8], c[9]];
      if (p){ report[how]++; rows.push(row.concat([p.m[8], p.m[9], p.m[10], p.m[11], "data"])); }
      else pending.push(row);
    });
    if (keepMapOnly){
      let n = 0;
      pool.filter(p => !p.used).forEach(p => {
        const m = p.m; n++;
        rows.push([`MAP-${String(n).padStart(4, "0")}`, m[0], m[1], m[2], "Unknown", m[3] ? "MDR-TB" : "DSTB", m[4] ? "Positive" : "Negative",
          normGender(m[5]) || titleCase(m[5]), m[6], m[7] ? "Died" : "Alive", m[8], m[9], m[10], m[11], "data"]);
      });
      report.mapOnly = n;
    } else report.mapOnly = pool.filter(p => !p.used).length;
    const locate = locator(rows.concat(mapRows.map(m => [null, m[0], m[1], m[2], 0,0,0,0,0,0, m[8], m[9]])));
    const placed = [];
    pending.forEach(r => {
      const q = locate(r[1], r[2], r[3]);
      if (q){ report.estimated++; placed.push(r.concat([+q.lat.toFixed(6), +q.lon.toFixed(6), 0, 0, "estimated"])); }
      else { report.unplaced++; placed.push(r.concat([ESWATINI.lat, ESWATINI.lon, 0, 0, "estimated"])); }
    });
    addSpread(rows, placed);
    return {rows:rows.concat(placed), report};
  }

  window.TBData = {
    ITERATIONS, decrypt, encrypt, toMapRows, toCohortRows, parseCsv, recordsFromCsv, buildRows, toCsv, templateCsv,
    combineLegacy, FIELD_ORDER, TEMPLATE_HEADER, normTb, normHiv, normGender, normStatus, normHelminth,
  };
})();

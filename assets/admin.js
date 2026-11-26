"use strict";
/* Admin page: sign in, open the data with the viewer password, add patients (CSV or typed),
   download the full data and change the viewer password. Every change is encrypted here in
   the browser and sent to api/admin/save, which commits it to GitHub; Vercel then redeploys. */
(function(){
  const $ = id => document.getElementById(id);
  const S = {email:null, sha:null, pw:null, data:null, combined:null, csvRows:[], csvErrors:[], pending:[]};
  const show = (id, on) => { $(id).hidden = !on; };
  function status(msg, bad){ const el = $("status"); el.textContent = msg; el.classList.toggle("bad", !!bad); el.hidden = !msg; if (msg) el.scrollIntoView({block:"nearest"}); }
  function err(id, msg){ $(id).textContent = msg || ""; $(id).hidden = !msg; }
  function el(tag, attrs, ...kids){
    const e = document.createElement(tag);
    for (const k in attrs || {}) k === "class" ? e.className = attrs[k] : e.setAttribute(k, attrs[k]);
    kids.flat().forEach(k => { if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k))); });
    return e;
  }
  async function api(path, opts){
    const r = await fetch("api/admin/" + path, Object.assign({credentials:"same-origin", cache:"no-store"}, opts,
      opts && opts.body ? {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(opts.body)} : {}));
    let j = {}; try { j = await r.json(); } catch(e){}
    if (r.status === 401 && path !== "login"){ signedOut("Your admin sign-in has ended. Please sign in again."); throw new Error("signed out"); }
    if (!r.ok) throw Object.assign(new Error(j.error || ("Server error " + r.status)), {status:r.status});
    return j;
  }
  function download(name, text, type){
    const a = el("a", {href:URL.createObjectURL(new Blob([text], {type})), download:name});
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const patients = n => n + (n === 1 ? " patient" : " patients");

  /* ---------------- sign in / out ---------------- */
  function signedOut(msg){
    S.email = S.pw = S.data = null;
    ["unlockForm","combineCard","tools","bLogout","who"].forEach(id => show(id, false));
    show("loginForm", true);
    if (msg) status(msg, true);
  }
  function signedIn(email, emailReady){
    S.email = email;
    $("pwEmailNote").textContent = emailReady
      ? "All admins will be emailed the new password."
      : "Admins will not be emailed: Vercel needs GMAIL_USER and GMAIL_APP_PASSWORD (see the README).";
    $("who").textContent = "Signed in as " + email; show("who", true);
    show("bLogout", true); show("loginForm", false); show("unlockForm", true);
    $("unlockPassword").focus();
  }
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault(); err("loginError"); status("");
    $("loginSubmit").disabled = true;
    try {
      const j = await api("login", {body:{email:$("loginEmail").value, password:$("loginPassword").value}});
      $("loginPassword").value = "";
      signedIn(j.email, j.emailReady);
    } catch(ex){ err("loginError", ex.message); }
    $("loginSubmit").disabled = false;
  });
  $("bLogout").addEventListener("click", async () => {
    try { await api("logout", {body:{}}); } catch(e){}
    signedOut(""); status("You have signed out.");
  });

  /* ---------------- open the data ---------------- */
  $("unlockForm").addEventListener("submit", async e => {
    e.preventDefault(); err("unlockError"); status("");
    const pw = $("unlockPassword").value;
    $("unlockSubmit").disabled = true; $("unlockSubmit").textContent = "Opening...";
    try {
      const j = await api("data");
      S.sha = j.sha;
      if (!j.payload){
        // No combined dataset yet: offer the one-time merge of the two old files.
        $("cbMapPw").value = pw;
        show("unlockForm", false); show("combineCard", true);
      } else {
        try { S.data = await TBData.decrypt(j.payload, pw); }
        catch(ex){ throw new Error("That viewer password is not right."); }
        S.pw = pw;
        show("unlockForm", false); openTools();
      }
      $("unlockPassword").value = "";
    } catch(ex){ if (ex.message !== "signed out") err("unlockError", ex.message); }
    $("unlockSubmit").disabled = false; $("unlockSubmit").textContent = "Open";
  });

  /* ---------------- saving ---------------- */
  // Returns a sentence about the admin email when the viewer password changed, else "".
  async function save(data, pw, summary){
    data.version = 2; data.updatedAt = new Date().toISOString();
    const payload = await TBData.encrypt(data, pw);
    const body = {payload, sha:S.sha, summary};
    const pwChanged = S.pw !== null && pw !== S.pw || summary.startsWith("combined") && pw !== S.mapPw;
    if (pwChanged) body.newViewerPassword = pw;
    const j = await api("save", {body});
    S.sha = j.sha; S.data = data; S.pw = pw;
    status("Saved. The live site will show the change in about a minute, once Vercel has redeployed it.");
    if (!pwChanged) return "";
    return j.emailed ? (j.emailed === 1 ? " The admin has been emailed the new password." : ` All ${j.emailed} admins have been emailed the new password.`)
      : ` The admins could NOT be emailed (${j.emailError || "unknown problem"}), so tell them the new password yourself.`;
  }

  /* ---------------- one-time combine ---------------- */
  $("combineForm").addEventListener("submit", async e => {
    e.preventDefault(); err("cbError"); show("cbSave", false); show("cbReport", false);
    const mapPw = $("cbMapPw").value, cohortPw = $("cbCohortPw").value || mapPw, newPw = $("cbNewPw").value;
    if (newPw && newPw.length < 12) return err("cbError", "The new viewer password needs at least 12 characters.");
    let mapRows, cohortRows;
    try { mapRows = await TBData.decrypt(window.ENCRYPTED_PAYLOAD, mapPw); } catch(ex){ return err("cbError", "The map password is not right."); }
    try { cohortRows = await TBData.decrypt(window.COHORT_PAYLOAD, cohortPw); } catch(ex){ return err("cbError", "The Charts (cohort) password is not right."); }
    const res = TBData.combineLegacy(mapRows, cohortRows, $("cbKeepMapOnly").checked);
    const r = res.report;
    S.combined = {rows:res.rows, pw:newPw || mapPw, summary:`combined ${res.rows.length} patients`};
    S.mapPw = mapPw;
    const box = $("cbReport"); box.textContent = "";
    box.append(el("ul", {class:"ad-report"},
      el("li", null, `Chart (cohort) patients: ${r.cohort}. Map patients: ${r.map}.`),
      el("li", null, `Matched to a map location in the same area: ${r.exact}`),
      el("li", null, `Matched in the same constituency (different area spelling): ${r.constituency}`),
      el("li", null, `No match, placed near patients in the same area or constituency: ${r.estimated}`),
      r.unplaced ? el("li", null, `No match and no neighbours, placed in the middle of Eswatini: ${r.unplaced}`) : null,
      el("li", null, $("cbKeepMapOnly").checked ? `Map-only patients kept: ${r.mapOnly}` : `Map-only patients left out: ${r.mapOnly}`),
      el("li", {class:"ad-ok"}, `The combined dataset will have ${res.rows.length} patients.`)));
    show("cbReport", true); show("cbSave", true);
  });
  $("cbSave").addEventListener("click", async () => {
    if (!S.combined) return;
    $("cbSave").disabled = true; err("cbError");
    try {
      const note = await save({rows:S.combined.rows}, S.combined.pw, S.combined.summary);
      show("combineCard", false); openTools();
      status("Combined data saved. From now on the map and the Charts tab both use it. The live site updates in about a minute." + note, note.includes("NOT"));
    } catch(ex){ if (ex.message !== "signed out") err("cbError", ex.message); }
    $("cbSave").disabled = false;
  });

  /* ---------------- tools ---------------- */
  function openTools(){ show("tools", true); renderStats(); }
  function renderStats(){
    const rows = S.data.rows, died = rows.filter(r => r[9] === "Died").length, est = rows.filter(r => r[14] === "estimated").length;
    const regions = new Set(rows.map(r => r[3])).size;
    const st = $("stats"); st.textContent = "";
    [[rows.length, "patients"], [died, "died"], [rows.filter(r => r[5] === "MDR-TB").length, "MDR-TB"], [regions, "regions"],
     [new Set(rows.map(r => r[2])).size, "constituencies"], [est, "with estimated location"]]
      .forEach(([n, t]) => st.append(el("div", null, el("b", null, n), el("span", null, t))));
    $("updated").textContent = S.data.updatedAt ? "Last updated " + new Date(S.data.updatedAt).toLocaleString() : "";
    const fill = (id, i) => { const dl = $(id); dl.textContent = ""; [...new Set(rows.map(r => r[i]))].sort().forEach(v => dl.append(el("option", {value:v}))); };
    fill("dlRegion", 3); fill("dlCons", 2); fill("dlArea", 1);
  }
  function previewTable(rows, removable){
    const head = ["Participant ID","Area","Constituency","Region","TB type","HIV","Gender","Age","Helminth","Outcome","Lat","Lon"];
    const t = el("table", {class:"ad-table"}, el("thead", null, el("tr", null, head.map(h => el("th", null, h)), removable ? el("th", null, "") : null)));
    const tb = el("tbody");
    rows.forEach((r, i) => {
      const tr = el("tr", null, [r[0], r[1], r[2], r[3], r[5], r[6], r[7], r[8], r[4], r[9]].map(v => el("td", null, v)),
        [r[10], r[11]].map(v => el("td", r[14] === "estimated" ? {class:"est", title:"Estimated from nearby patients"} : null, (+v).toFixed(4))));
      if (removable){ const b = el("button", {type:"button", "aria-label":"Remove " + r[0]}, "Remove"); b.addEventListener("click", () => removable(i)); tr.append(el("td", null, b)); }
      tb.append(tr);
    });
    t.append(tb);
    return el("div", {class:"ad-table-wrap"}, t);
  }

  /* ---------------- CSV upload ---------------- */
  let csvText = null;
  const mode = () => document.querySelector('input[name="mode"]:checked').value;
  $("csvFile").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    $("csvName").textContent = f.name;
    const rd = new FileReader();
    rd.onload = () => { csvText = rd.result; checkCsv(); };
    rd.readAsText(f);
    e.target.value = "";
  });
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener("change", () => { if (csvText) checkCsv(); }));
  $("csvSkip").addEventListener("change", updateCsvSave);
  function checkCsv(){
    const box = $("csvPreview"); box.textContent = ""; show("csvPreview", true);
    const {records, missing} = TBData.recordsFromCsv(csvText);
    S.csvRows = []; S.csvErrors = [];
    if (missing.length){
      box.append(el("p", {class:"ad-error"}, "This file is missing columns: " + missing.join(", ") + ". Download the template to see the expected columns."));
      return updateCsvSave();
    }
    const replace = mode() === "replace";
    const res = TBData.buildRows(records, replace ? [] : S.data.rows, {locateFrom:S.data.rows});
    S.csvRows = res.rows; S.csvErrors = res.errors;
    box.append(el("p", null, el("span", {class:"ad-ok"}, `${res.rows.length} ${res.rows.length === 1 ? "row" : "rows"} ready`),
      res.errors.length ? `, ${res.errors.length} with problems` : "",
      replace ? `. The site will then have ${res.rows.length} patients (replacing ${S.data.rows.length}).` : `. The site will then have ${S.data.rows.length + res.rows.length} patients.`));
    if (res.errors.length){
      box.append(el("ul", {class:"ad-problems"}, res.errors.slice(0, 200).map(x => el("li", null, `Line ${x.line}${x.id ? " (" + x.id + ")" : ""}: ${x.message}`))));
    }
    if (res.rows.length){
      const est = res.rows.filter(r => r[14] === "estimated").length;
      if (est) box.append(el("p", {class:"hint"}, `${est === 1 ? "1 row has" : est + " rows have"} no lat/lon and will be placed near patients in the same area (shown in grey italics).`));
      box.append(previewTable(res.rows.slice(0, 50)));
      if (res.rows.length > 50) box.append(el("p", {class:"hint"}, `Showing the first 50 of ${res.rows.length} rows.`));
    }
    updateCsvSave();
  }
  function updateCsvSave(){
    show("csvSkipWrap", S.csvErrors.length > 0 && S.csvRows.length > 0);
    $("csvSave").disabled = !S.csvRows.length || (S.csvErrors.length > 0 && !$("csvSkip").checked);
  }
  $("csvSave").addEventListener("click", async () => {
    const replace = mode() === "replace", n = S.csvRows.length;
    if (replace && !confirm(`Replace all ${S.data.rows.length} patients on the site with the ${n} patients in this file?`)) return;
    $("csvSave").disabled = true;
    try {
      const rows = replace ? S.csvRows : S.data.rows.concat(S.csvRows);
      await save({rows}, S.pw, replace ? `replaced data with ${patients(n)}` : `added ${patients(n)}`);
      csvText = null; S.csvRows = []; S.csvErrors = []; $("csvName").textContent = ""; show("csvPreview", false); $("csvSkip").checked = false;
      renderStats();
    } catch(ex){ if (ex.message !== "signed out") status(ex.message, true); }
    updateCsvSave();
  });
  $("bTemplate").addEventListener("click", () => download("tb-patients-template.csv", TBData.templateCsv(), "text/csv;charset=utf-8"));

  /* ---------------- typed entry ---------------- */
  $("manualForm").addEventListener("submit", e => {
    e.preventDefault(); err("manualError");
    const rec = {id:$("mId").value, area:$("mArea").value, constituency:$("mCons").value, region:$("mRegion").value,
      tbType:$("mTb").value, hiv:$("mHiv").value, gender:$("mGender").value, age:$("mAge").value,
      helminth:$("mHelminth").value, status:$("mStatus").value, lat:$("mLat").value, lon:$("mLon").value};
    const res = TBData.buildRows([TBData.FIELD_ORDER.map(f => rec[f])], S.data.rows.concat(S.pending), {});
    if (res.errors.length) return err("manualError", res.errors[0].message.replace(/^./, c => c.toUpperCase()) + ".");
    S.pending.push(res.rows[0]);
    ["mId","mAge","mLat","mLon"].forEach(id => $(id).value = "");
    $("mId").focus();
    renderPending();
  });
  function renderPending(){
    const box = $("manualList"); box.textContent = "";
    show("manualList", S.pending.length > 0); show("manualSave", S.pending.length > 0);
    if (!S.pending.length) return;
    box.append(el("p", null, `${S.pending.length} patient${S.pending.length === 1 ? "" : "s"} waiting to upload:`),
      previewTable(S.pending, i => { S.pending.splice(i, 1); renderPending(); }));
    $("manualSave").textContent = `Upload ${S.pending.length} patient${S.pending.length === 1 ? "" : "s"} and update the site`;
  }
  $("manualSave").addEventListener("click", async () => {
    $("manualSave").disabled = true;
    try {
      const n = S.pending.length;
      await save({rows:S.data.rows.concat(S.pending)}, S.pw, `added ${patients(n)}`);
      S.pending = []; renderPending(); renderStats();
    } catch(ex){ if (ex.message !== "signed out") status(ex.message, true); }
    $("manualSave").disabled = false;
  });

  /* ---------------- downloads ---------------- */
  $("bDlCsv").addEventListener("click", () => download(`eswatini-tb-data-${today()}.csv`, TBData.toCsv(S.data.rows), "text/csv;charset=utf-8"));
  $("bDlJson").addEventListener("click", () => {
    const keys = ["participant_id","area","constituency","region","helminth","tb_type","hiv_status","gender","age","status","lat","lon","spread_lat","spread_lon","location"];
    const out = {exported:new Date().toISOString(), patients:S.data.rows.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])))};
    download(`eswatini-tb-data-${today()}.json`, JSON.stringify(out, null, 2), "application/json");
  });

  /* ---------------- viewer password ---------------- */
  $("pwForm").addEventListener("submit", async e => {
    e.preventDefault(); err("pwError");
    const a = $("pwNew").value, b = $("pwRepeat").value;
    if (a.length < 12) return err("pwError", "Use at least 12 characters.");
    if (a !== b) return err("pwError", "The two passwords are not the same.");
    if (!confirm("Change the viewer password? Everyone will need the new password to open the map.")) return;
    try {
      const note = await save({rows:S.data.rows}, a, "viewer password changed");
      $("pwNew").value = $("pwRepeat").value = "";
      status("Viewer password changed. The live site will ask for the new password in about a minute." + note, note.includes("NOT"));
    } catch(ex){ if (ex.message !== "signed out") err("pwError", ex.message); }
  });

  /* ---------------- start ---------------- */
  fetch("api/admin/session", {credentials:"same-origin", cache:"no-store"}).then(r => r.json()).then(s => {
    if (s.admin) signedIn(s.email, s.emailReady);
    else { signedOut(""); if (s.configured === false) status("Admin sign-in is not set up on the server yet. Vercel needs: " + (s.missing || []).join(", ") + ". Add them in Vercel → Settings → Environment Variables, then deploy again.", true); }
  }).catch(() => { signedOut(""); status("The admin service is not reachable. Admin sign-in only works on the live site, not on a local copy.", true); });
})();

"use strict";
/* Shared helpers for the admin API (Vercel serverless functions).

   Settings, all in Vercel → Project → Settings → Environment Variables:
     ADMIN_ACCOUNTS  email=scrypt:N:r:p:salt:hash entries separated by ";"
                     (make them with: python tools/make_admin_hash.py)
     SESSION_SECRET  long random string that signs the login cookie
     GITHUB_TOKEN    fine-grained token with Contents read/write on this repository only
     GITHUB_REPO     owner/name, default Welshamar/Eswatini-Health-Project-Visualisation
     GITHUB_BRANCH   default main

   The server never sees readable patient data: the admin's browser encrypts the
   dataset with the viewer password and sends only the encrypted file. */
const crypto = require("crypto");

const COOKIE = "tb_admin";
const SESSION_HOURS = 8;
const DATA_PATH = "assets/tb-combined.enc.js";
const DATA_PREFIX = "window.TB_COMBINED_PAYLOAD = ";

function send(res, status, body){
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function accounts(){
  const map = new Map();
  for (const part of String(process.env.ADMIN_ACCOUNTS || "").split(/[;\n]/)){
    const at = part.indexOf("=");
    if (at < 1) continue;
    const email = part.slice(0, at).trim().toLowerCase(), hash = part.slice(at + 1).trim();
    if (email && hash.startsWith("scrypt:")) map.set(email, hash);
  }
  return map;
}
function secret(){ const s = process.env.SESSION_SECRET || ""; return s.length >= 32 ? s : null; }
const configured = () => accounts().size > 0 && !!secret();
// Names (never values) of settings that are missing or unusable, to help set the server up.
function missingSettings(){
  const m = [];
  if (!accounts().size) m.push("ADMIN_ACCOUNTS");
  if (!secret()) m.push("SESSION_SECRET (at least 32 characters)");
  if (!process.env.GITHUB_TOKEN) m.push("GITHUB_TOKEN");
  return m;
}

// scrypt:N:r:p:saltB64:hashB64
function checkPassword(password, stored){
  const [, N, r, p, saltB64, hashB64] = stored.split(":");
  const expected = Buffer.from(hashB64, "base64");
  const got = crypto.scryptSync(String(password), Buffer.from(saltB64, "base64"), expected.length,
    {N:Number(N), r:Number(r), p:Number(p), maxmem:256 * 1024 * 1024});
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}
// Same work for unknown emails, so response time doesn't reveal which emails are admins.
const DUMMY = "scrypt:16384:8:1:" + Buffer.alloc(16).toString("base64") + ":" + Buffer.alloc(32).toString("base64");

function sign(value){ return crypto.createHmac("sha256", secret()).update(value).digest("base64url"); }
function makeSession(email){
  const body = Buffer.from(JSON.stringify({e:email, x:Date.now() + SESSION_HOURS * 3600e3})).toString("base64url");
  return body + "." + sign(body);
}
function readCookie(req, name){
  for (const c of String(req.headers.cookie || "").split(";")){
    const i = c.indexOf("="); if (i > 0 && c.slice(0, i).trim() === name) return c.slice(i + 1).trim();
  }
  return null;
}
function session(req){
  if (!secret()) return null;
  const v = readCookie(req, COOKIE); if (!v) return null;
  const [body, sig] = v.split(".");
  if (!body || !sig) return null;
  const good = Buffer.from(sign(body)), given = Buffer.from(sig);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!s.x || s.x < Date.now() || !accounts().has(s.e)) return null; // removed admins lose access at once
    return {email:s.e, expires:s.x};
  } catch(e){ return null; }
}
function cookieHeader(value, maxAge){
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// Writes must come from this site's own pages: JSON body (no plain form posts) and a matching Origin.
function sameOrigin(req){
  const ct = String(req.headers["content-type"] || "");
  if (!ct.startsWith("application/json")) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch(e){ return false; }
}
async function body(req){
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = []; for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

/* ---------------- GitHub ---------------- */
const repo = () => process.env.GITHUB_REPO || "Welshamar/Eswatini-Health-Project-Visualisation";
const branch = () => process.env.GITHUB_BRANCH || "main";
const apiBase = () => process.env.GITHUB_API_URL || "https://api.github.com";
async function gh(path, init){
  if (!process.env.GITHUB_TOKEN) { const e = new Error("GITHUB_TOKEN is not set in Vercel"); e.status = 503; throw e; }
  const r = await fetch(apiBase() + path, Object.assign({}, init, {headers:{
    "Authorization": "Bearer " + process.env.GITHUB_TOKEN, "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "eswatini-tb-admin", "Content-Type": "application/json"}}));
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch(e){}
  return {status:r.status, json};
}
async function readDataFile(){
  const r = await gh(`/repos/${repo()}/contents/${DATA_PATH}?ref=${encodeURIComponent(branch())}`);
  if (r.status === 404) return {sha:null, payload:null};
  if (r.status !== 200) { const e = new Error("GitHub said " + r.status + " when reading the data file"); e.status = 502; throw e; }
  const text = Buffer.from(r.json.content || "", "base64").toString("utf8").trim();
  let payload = null;
  if (text.startsWith(DATA_PREFIX)) { try { payload = JSON.parse(text.slice(DATA_PREFIX.length).replace(/;\s*$/, "")); } catch(e){} }
  return {sha:r.json.sha, payload};
}
function validPayload(p){
  const b64 = s => typeof s === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
  return p && typeof p === "object" && b64(p.salt) && b64(p.iv) && b64(p.data) &&
    Number.isInteger(p.iterations) && p.iterations >= 100000 && p.iterations <= 2000000 &&
    p.data.length <= 4000000 && Object.keys(p).every(k => ["salt","iv","data","iterations"].includes(k));
}
async function writeDataFile(payload, sha, message){
  const content = DATA_PREFIX + JSON.stringify(payload) + ";\n";
  const r = await gh(`/repos/${repo()}/contents/${DATA_PATH}`, {method:"PUT", body:JSON.stringify({
    message, branch:branch(), sha:sha || undefined, content:Buffer.from(content).toString("base64")})});
  if (r.status === 409 || r.status === 422) { const e = new Error("conflict"); e.status = 409; throw e; }
  if (r.status !== 200 && r.status !== 201) { const e = new Error("GitHub said " + r.status + " when saving"); e.status = 502; throw e; }
  return {sha:r.json.content && r.json.content.sha, commit:r.json.commit && r.json.commit.sha};
}

module.exports = {COOKIE, SESSION_HOURS, send, accounts, configured, missingSettings, checkPassword, DUMMY, makeSession, session,
  cookieHeader, sameOrigin, body, readDataFile, writeDataFile, validPayload};

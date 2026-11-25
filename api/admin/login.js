"use strict";
const L = require("../_lib");

// POST {email, password} -> sets the admin session cookie.
module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, {error:"Use POST"});
  if (!L.sameOrigin(req)) return L.send(res, 403, {error:"Bad request origin"});
  if (!L.configured()) return L.send(res, 503, {error:"Admin login is not set up yet (ADMIN_ACCOUNTS and SESSION_SECRET in Vercel)."});
  let b; try { b = await L.body(req); } catch(e){ return L.send(res, 400, {error:"Bad request"}); }
  const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
  const stored = L.accounts().get(email);
  const ok = L.checkPassword(password, stored || L.DUMMY) && !!stored && password.length > 0;
  if (!ok){
    await new Promise(r => setTimeout(r, 800)); // slows down guessing
    return L.send(res, 401, {error:"That email or password is not right."});
  }
  res.setHeader("Set-Cookie", L.cookieHeader(L.makeSession(email), L.SESSION_HOURS * 3600));
  return L.send(res, 200, {email});
};

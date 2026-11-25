"use strict";
const L = require("../_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, {error:"Use POST"});
  if (!L.sameOrigin(req)) return L.send(res, 403, {error:"Bad request origin"});
  res.setHeader("Set-Cookie", L.cookieHeader("", 0));
  return L.send(res, 200, {ok:true});
};

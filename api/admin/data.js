"use strict";
const L = require("../_lib");

// GET -> the latest encrypted dataset straight from GitHub (fresher than the deployed copy).
module.exports = async (req, res) => {
  if (req.method !== "GET") return L.send(res, 405, {error:"Use GET"});
  if (!L.session(req)) return L.send(res, 401, {error:"Please sign in again."});
  try {
    const f = await L.readDataFile();
    return L.send(res, 200, {sha:f.sha, payload:f.payload});
  } catch(e){ return L.send(res, e.status || 500, {error:e.message}); }
};

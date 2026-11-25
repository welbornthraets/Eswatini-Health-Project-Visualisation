"use strict";
const L = require("../_lib");

// POST {payload, sha, summary} -> commits the encrypted dataset; Vercel then redeploys the site.
module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, {error:"Use POST"});
  if (!L.sameOrigin(req)) return L.send(res, 403, {error:"Bad request origin"});
  if (!L.session(req)) return L.send(res, 401, {error:"Please sign in again."});
  let b; try { b = await L.body(req); } catch(e){ return L.send(res, 400, {error:"Bad request"}); }
  if (!L.validPayload(b.payload)) return L.send(res, 400, {error:"The encrypted data is not in the expected format."});
  // Commit messages are public, so they say what changed but never who or which patients.
  const summary = String(b.summary || "update").replace(/[^\w ,.()+\-]/g, "").slice(0, 80);
  try {
    const r = await L.writeDataFile(b.payload, b.sha || null, "Data update from the admin page: " + summary);
    return L.send(res, 200, {ok:true, sha:r.sha, commit:r.commit});
  } catch(e){
    if (e.status === 409) return L.send(res, 409, {error:"The data was changed by someone else since you opened it. Reload the admin page and try again."});
    return L.send(res, e.status || 500, {error:e.message});
  }
};

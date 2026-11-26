"use strict";
const L = require("../_lib");
const mail = require("../_mail");

// POST {payload, sha, summary, newViewerPassword?} -> commits the encrypted dataset; Vercel then
// redeploys the site. When the viewer password changed, every admin is emailed the new one
// (it is only passed on to the email, never stored or logged).
module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, {error:"Use POST"});
  if (!L.sameOrigin(req)) return L.send(res, 403, {error:"Bad request origin"});
  const who = L.session(req);
  if (!who) return L.send(res, 401, {error:"Please sign in again."});
  let b; try { b = await L.body(req); } catch(e){ return L.send(res, 400, {error:"Bad request"}); }
  if (!L.validPayload(b.payload)) return L.send(res, 400, {error:"The encrypted data is not in the expected format."});
  // Commit messages are public, so they say what changed but never who or which patients.
  const summary = String(b.summary || "update").replace(/[^\w ,.()+\-]/g, "").slice(0, 80);
  try {
    const r = await L.writeDataFile(b.payload, b.sha || null, "Data update from the admin page: " + summary);
    const out = {ok:true, sha:r.sha, commit:r.commit};
    const pw = typeof b.newViewerPassword === "string" ? b.newViewerPassword : null;
    if (pw !== null){
      try {
        if (pw.length < 12 || pw.length > 200 || /[\r\n]/.test(pw)) throw new Error("the new password is not valid for an email");
        const admins = [...L.accounts().keys()];
        await mail.send(admins, "Eswatini TB Map: the viewer password was changed", passwordEmail(pw, who.email, siteUrl(req)));
        out.emailed = admins.length;
      } catch(e){ out.emailError = e.message; }
    }
    return L.send(res, 200, out);
  } catch(e){
    if (e.status === 409) return L.send(res, 409, {error:"The data was changed by someone else since you opened it. Reload the admin page and try again."});
    return L.send(res, e.status || 500, {error:e.message});
  }
};

function siteUrl(req){
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? "https://" + host + "/" : "";
}
function passwordEmail(pw, by, url){
  const when = new Date().toLocaleString("en-GB", {timeZone:"Africa/Mbabane", dateStyle:"long", timeStyle:"short"});
  return [
    "Hello,",
    "",
    `The viewer password for the Eswatini TB Map (map and charts) was changed by ${by} on ${when} (Eswatini time).`,
    "",
    "New password: " + pw,
    "",
    url ? "Open the site: " + url : "",
    "The site asks for the new password about a minute after the change, once the update is live.",
    "",
    "Keep this password private and share it only with people who need the data. Consider deleting this email once you have stored the password safely.",
    "",
    "This message was sent to all admins of the Eswatini TB Map.",
  ].join("\n");
}

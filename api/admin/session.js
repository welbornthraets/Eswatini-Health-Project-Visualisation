"use strict";
const L = require("../_lib");
const mail = require("../_mail");

// GET -> {admin: true, email} when signed in. The public page uses it to show admin-only buttons.
module.exports = async (req, res) => {
  const s = L.session(req);
  return L.send(res, 200, s ? {admin:true, email:s.email, expires:s.expires, emailReady:mail.configured()} : {admin:false, configured:L.configured(), missing:L.missingSettings()});
};

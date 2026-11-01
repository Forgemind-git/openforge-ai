const { PUBLIC_URL } = require('./config');

// The public origin used in webhook + OAuth redirect URLs. PUBLIC_URL wins;
// otherwise it is derived from the proxy headers of the current request.
module.exports = function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
};

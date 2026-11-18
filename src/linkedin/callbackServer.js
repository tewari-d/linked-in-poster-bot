// Receives LinkedIn's redirect after the owner taps Allow in a browser on this device.
// Bound to 127.0.0.1 only, so nothing on the network or the internet can reach it.
const http = require('node:http');
const { redirectParams } = require('./auth');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const page = (message) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LinkedIn connection</title><p style="font:16px system-ui;margin:2em">${escapeHtml(message)}</p>`;

// Resolves to the listening server, or null when the redirect address is not served here
// (the owner then pastes the address into Telegram instead).
function startCallbackServer({ redirectUri, onRedirect, log }) {
  const target = new URL(redirectUri);
  if (target.protocol !== 'http:' || !LOCAL_HOSTS.has(target.hostname)) {
    log(`LinkedIn redirect ${target.origin} is not a local http address, so no callback server runs. Paste the address the browser lands on into Telegram.`);
    return Promise.resolve(null);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, target.origin);
    if (req.method !== 'GET' || url.pathname !== target.pathname) {
      res.writeHead(404).end();
      return;
    }
    // onRedirect reports problems in its result and never throws, so the browser always gets a page.
    const { ok, message } = await onRedirect(redirectParams(url.searchParams));
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' }).end(page(message));
  });

  return new Promise((resolve) => {
    server.once('error', (err) => {
      // The bot still works without it: the pasted-address route needs no server.
      log(`LinkedIn callback server could not start on port ${target.port}: ${err.code ?? err.message}. Paste the address the browser lands on into Telegram instead.`);
      resolve(null);
    });
    server.listen(Number(target.port || 80), '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startCallbackServer };

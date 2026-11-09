// Spotify integration — Authorization Code with PKCE, no client secret.
//
// A desktop app can't keep a secret (anyone can unzip the .exe), so Spotify's PKCE flow
// exists exactly for this: we prove it's the same app that started the login by hashing a
// random string, and the user's own browser does the consent screen.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const PORT = 8888;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* not json */ }
        resolve({ status: res.statusCode, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

class Spotify {
  constructor(dir, log) {
    this.dir = dir;
    this.log = log || (() => {});
    this.cfgFile = path.join(dir, 'spotify.json');
    this.tokFile = path.join(dir, 'spotify-token.json');
    this.token = null;
    this.timer = null;
    this.onUpdate = null;
    this.verifier = null;
    this.lastSent = null;
    this.loadToken();
  }

  // ---------------------------------------------------------------- config & storage
  clientId() {
    try {
      const cfg = JSON.parse(fs.readFileSync(this.cfgFile, 'utf8'));
      if (cfg.clientId && cfg.clientId.trim()) return cfg.clientId.trim();
    } catch { /* no config yet */ }
    return (process.env.SPOTIFY_CLIENT_ID || '').trim() || null;
  }

  hasClientId() { return !!this.clientId(); }
  isConnected() { return !!(this.token && this.token.refresh_token); }

  loadToken() {
    try {
      this.token = JSON.parse(fs.readFileSync(this.tokFile, 'utf8'));
      if (this.token && this.token.refresh_token) this.log('spotify: stored token found');
    } catch { this.token = null; }
  }

  saveToken() {
    try {
      fs.writeFileSync(this.tokFile, JSON.stringify(this.token, null, 2), { mode: 0o600 });
    } catch (e) { this.log('spotify: could not save token', String(e)); }
  }

  disconnect() {
    this.token = null;
    try { fs.unlinkSync(this.tokFile); } catch { /* already gone */ }
    this.stopPolling();
    this.emit(null);
  }

  // ---------------------------------------------------------------- PKCE login
  async connect(openBrowser) {
    const id = this.clientId();
    if (!id) return { ok: false, reason: 'no-client-id' };

    this.verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(this.verifier).digest());
    const state = b64url(crypto.randomBytes(12));

    const url = `${AUTH_URL}?` + new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: REDIRECT,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
      scope: SCOPES
    }).toString();

    const codePromise = this.waitForCode(state);
    openBrowser(url);
    const result = await codePromise;
    if (!result.code) return { ok: false, reason: result.error || 'no-code' };
    return this.exchange(result.code);
  }

  // A loopback listener is the standard desktop OAuth pattern: Spotify redirects the
  // browser to 127.0.0.1, which only this app can be listening on. The server is created
  // once and kept alive, so a retry can never collide with its own previous socket.
  ensureServer() {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }

      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      const state = u.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8">
        <body style="font:16px system-ui;background:#0b1a24;color:#dfefff;display:grid;place-items:center;height:100vh;margin:0">
        <div style="text-align:center">
          <div style="font-size:44px">${code && !err ? '🐋' : '⚠️'}</div>
          <h2 style="margin:12px 0 6px">${code && !err ? 'Orca is connected' : 'Authorisation failed'}</h2>
          <p style="opacity:.7">You can close this tab and go back to the desktop.</p>
        </div></body>`);

      const pending = this.pending;
      this.pending = null;
      if (!pending) return;

      if (err) return pending.resolve({ error: err });
      if (state !== pending.state) return pending.resolve({ error: 'state-mismatch' });
      pending.resolve({ code });
    });
    this.server.on('error', (e) => {
      const pending = this.pending;
      this.pending = null;
      if (pending) pending.resolve({ error: 'port-in-use' });
      this.log('spotify: callback server error', String(e));
    });
    this.server.listen(PORT, '127.0.0.1');
  }

  waitForCode(expectedState) {
    this.ensureServer();
    return new Promise((resolve) => {
      this.pending = { state: expectedState, resolve: (v) => { clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => {
        if (this.pending && this.pending.state === expectedState) this.pending = null;
        resolve({ error: 'timeout' });
      }, 180000);
      timer.unref?.();
    });
  }

  async exchange(code) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: this.clientId(),
      code_verifier: this.verifier
    }).toString();

    const r = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, body);

    if (r.status !== 200 || !r.body || !r.body.access_token) {
      this.log('spotify: token exchange failed', String(r.status), r.raw.slice(0, 300));
      return { ok: false, reason: 'exchange-failed', status: r.status, detail: r.body };
    }

    this.token = {
      access_token: r.body.access_token,
      refresh_token: r.body.refresh_token,
      expires_at: Date.now() + (r.body.expires_in - 60) * 1000
    };
    this.saveToken();
    this.startPolling();
    return { ok: true };
  }

  async refresh() {
    if (!this.token || !this.token.refresh_token) return false;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.token.refresh_token,
      client_id: this.clientId()
    }).toString();

    const r = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, body);

    if (r.status !== 200 || !r.body || !r.body.access_token) {
      this.log('spotify: refresh failed', String(r.status));
      return false;
    }
    this.token.access_token = r.body.access_token;
    if (r.body.refresh_token) this.token.refresh_token = r.body.refresh_token;
    this.token.expires_at = Date.now() + (r.body.expires_in - 60) * 1000;
    this.saveToken();
    return true;
  }

  async api(endpoint, method = 'GET') {
    if (!this.token) return { status: 401 };
    if (Date.now() > (this.token.expires_at || 0)) {
      const ok = await this.refresh();
      if (!ok) return { status: 401 };
    }
    const headers = { Authorization: `Bearer ${this.token.access_token}` };
    if (method !== 'GET') { headers['Content-Length'] = '0'; }
    let r = await request(API + endpoint, { method, headers });
    if (r.status === 401) {
      const ok = await this.refresh();
      if (ok) {
        const h2 = { Authorization: `Bearer ${this.token.access_token}` };
        if (method !== 'GET') h2['Content-Length'] = '0';
        r = await request(API + endpoint, { method, headers: h2 });
      }
    }
    return r;
  }

  // ---------------------------------------------------------------- polling
  startPolling() {
    this.stopPolling();
    if (!this.isConnected()) return;
    const tick = async () => {
      const r = await this.api('/me/player');
      if (r.status === 204) { this.authFails = 0; return this.emit(null); }   // nothing playing
      if (r.status === 401) {
        this.authFails = (this.authFails || 0) + 1;
        this.emit({ needsAuth: true });
        if (this.authFails >= 3) {
          this.log('spotify: giving up after repeated auth failures');
          this.stopPolling();
        }
        return;
      }
      this.authFails = 0;
      if (r.status !== 200 || !r.body) return;
      const p = r.body;
      const item = p.item;
      if (!item) return this.emit(null);
      this.emit({
        title: item.name,
        artist: (item.artists || []).map((a) => a.name).join(', '),
        art: item.album && item.album.images && item.album.images[0] ? item.album.images[0].url : null,
        playing: !!p.is_playing,
        progress: (p.progress_ms || 0) / 1000,
        duration: (item.duration_ms || 0) / 1000
      });
    };
    tick();
    this.timer = setInterval(tick, 5000);
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  emit(data) {
    const key = JSON.stringify(data);
    if (key === this.lastSent) return;
    this.lastSent = key;
    if (this.onUpdate) this.onUpdate(data);
  }

  async control(act) {
    let endpoint, method;
    if (act === 'toggle') {
      const r = await this.api('/me/player');
      const playing = r.body && r.body.is_playing;
      endpoint = playing ? '/me/player/pause' : '/me/player/play';
      method = 'PUT';
    } else if (act === 'next') { endpoint = '/me/player/next'; method = 'POST'; }
    else if (act === 'prev') { endpoint = '/me/player/previous'; method = 'POST'; }
    else return { ok: false };

    const res = await this.api(endpoint, method);
    // 403 here almost always means the account is not Premium — Spotify restricts
    // playback control to Premium subscribers.
    return { ok: res.status === 204 || res.status === 200, status: res.status };
  }
}

module.exports = { Spotify };

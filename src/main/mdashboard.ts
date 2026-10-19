/**
 * mOffice ↔ mDashboard: the studio floor link (electron half).
 *
 * See src/shared/mdashboard.ts for the whole design. This file holds the three
 * things that need electron: the loopback server the browser hands the sign-in
 * to, the encrypted token (safeStorage, through integrations.ts), and the calls
 * to mDashboard.
 *
 * The token never leaves main. The renderer is told only who is signed in, and
 * gets the floor snapshot, which mDashboard has already cut back to what a
 * status board needs.
 */
import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSecret, setSecret, deleteSecret } from './integrations';
import {
  MDASHBOARD_APP_ID, MDASHBOARD_DEFAULT_URL, SIGN_IN_TIMEOUT_MS,
  normalizeBaseUrl, normalizeAppId, functionUrl, meUrl, signInUrl, authHeaders,
  dashboardPath, parseSignedInForm, sameState, classifyFloorResponse,
  type FloorResult, type LinkStatus
} from '../shared/mdashboard';

const SECRET_REF = 'mdashboard:session';
const REQUEST_TIMEOUT_MS = 20_000;

interface LinkFile {
  baseUrl: string;
  appId: string;
  /** Who signed in, for the title bar. Display only; the token is the secret. */
  name: string;
  email: string;
}

function linkPath(): string {
  return join(app.getPath('userData'), 'mdashboard.json');
}

function readLink(): LinkFile {
  const fallback: LinkFile = { baseUrl: MDASHBOARD_DEFAULT_URL, appId: MDASHBOARD_APP_ID, name: '', email: '' };
  try {
    if (!existsSync(linkPath())) return fallback;
    const raw = JSON.parse(readFileSync(linkPath(), 'utf8')) as Partial<LinkFile>;
    return {
      baseUrl: normalizeBaseUrl(raw.baseUrl) ?? fallback.baseUrl,
      appId: normalizeAppId(raw.appId) ?? fallback.appId,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '',
      email: typeof raw.email === 'string' ? raw.email.slice(0, 200) : ''
    };
  } catch {
    return fallback;
  }
}

function writeLink(next: LinkFile): void {
  mkdirSync(dirname(linkPath()), { recursive: true });
  writeFileSync(linkPath(), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
}

async function call(url: string, init: { method: string; token: string; appId: string; body?: string }): Promise<{ status: number; body: unknown }> {
  const res = await net.fetch(url, {
    method: init.method,
    headers: authHeaders(init.token, init.appId),
    body: init.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, body };
}

const DONE_PAGE = (title: string, line: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font:16px/1.45 -apple-system,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;display:grid;place-items:center;height:100vh;margin:0}` +
  `@media (prefers-color-scheme:dark){body{background:#161617;color:#f5f5f7}}main{max-width:380px;padding:0 16px;text-align:center}</style>` +
  `</head><body><main><h1>${title}</h1><p>${line}</p></main></body></html>`;

export class MDashboardLink {
  private signingIn: { server: Server; timer: NodeJS.Timeout; settle: (r: { ok: boolean; error?: string }) => void } | null = null;

  status(): LinkStatus {
    if (this.signingIn) return { state: 'signing-in' };
    const link = readLink();
    if (!getSecret(SECRET_REF)) return { state: 'signed-out' };
    return { state: 'signed-in', name: link.name, email: link.email, baseUrl: link.baseUrl };
  }

  settings(): { baseUrl: string; appId: string } {
    const { baseUrl, appId } = readLink();
    return { baseUrl, appId };
  }

  /** Point mOffice at another mDashboard (a staging copy). Signs out, because a
   *  token is only good for the dashboard that issued it. */
  setSettings(input: { baseUrl?: unknown; appId?: unknown }): { ok: boolean; error?: string } {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const appId = normalizeAppId(input.appId);
    if (!baseUrl) return { ok: false, error: 'The address must be an https:// origin, with no path.' };
    if (!appId) return { ok: false, error: 'The app id is 24 hexadecimal characters.' };
    const link = readLink();
    if (link.baseUrl !== baseUrl || link.appId !== appId) {
      deleteSecret(SECRET_REF);
      writeLink({ baseUrl, appId, name: '', email: '' });
      this.notify();
    }
    return { ok: true };
  }

  /** Open mDashboard's sign-in page in the browser and wait for it to hand the
   *  account to a one-off server on 127.0.0.1. */
  signIn(): Promise<{ ok: boolean; error?: string }> {
    if (this.signingIn) return Promise.resolve({ ok: false, error: 'Already signing in. Finish in your browser.' });
    const link = readLink();
    const state = randomBytes(24).toString('base64url'); // 32 chars of [A-Za-z0-9_-]

    return new Promise((resolve) => {
      let settled = false;
      const finish = (r: { ok: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        const s = this.signingIn;
        this.signingIn = null;
        if (s) { clearTimeout(s.timer); s.server.close(); }
        this.notify();
        resolve(r);
      };

      const server = createServer((req, res) => {
        const reply = (code: number, title: string, line: string) => {
          res.writeHead(code, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
          });
          res.end(DONE_PAGE(title, line));
        };
        if (req.method !== 'POST' || req.url !== '/signed-in') { reply(404, 'Not here', 'This address is only for signing in to mOffice.'); return; }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c: string) => {
          body += c;
          if (body.length > 16_384) req.destroy();
        });
        req.on('end', () => {
          const form = parseSignedInForm(body);
          if (!form || !sameState(form.state, state)) {
            reply(400, 'That did not work', 'Go back to mOffice and choose Sign in again.');
            return;
          }
          void this.adopt(link, form.token).then((r) => {
            if (r.ok) reply(200, 'Signed in to mOffice', 'You can close this tab. The studio floor is filling in now.');
            else reply(403, 'Not signed in', r.error ?? 'mOffice could not use that account.');
            finish(r);
          });
        });
      });

      server.on('error', (e) => finish({ ok: false, error: `Could not start the sign-in: ${e.message}` }));
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        if (!port) { finish({ ok: false, error: 'Could not start the sign-in.' }); return; }
        const timer = setTimeout(() => finish({ ok: false, error: 'Signing in timed out. Choose Sign in to try again.' }), SIGN_IN_TIMEOUT_MS);
        this.signingIn = { server, timer, settle: finish };
        this.notify();
        void shell.openExternal(signInUrl(link.baseUrl, link.appId, port, state));
      });
    });
  }

  cancelSignIn(): void {
    this.signingIn?.settle({ ok: false, error: 'Sign-in cancelled.' });
  }

  /** Check the token belongs to someone before keeping it. */
  private async adopt(link: LinkFile, token: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const me = await call(meUrl(link.baseUrl, link.appId), { method: 'GET', token, appId: link.appId });
      if (me.status !== 200 || !me.body || typeof me.body !== 'object') return { ok: false, error: 'mDashboard did not recognise that account.' };
      const who = me.body as { full_name?: unknown; email?: unknown };
      const saved = setSecret(SECRET_REF, token);
      if (!saved.ok) return { ok: false, error: saved.error };
      writeLink({
        ...link,
        name: typeof who.full_name === 'string' ? who.full_name.slice(0, 120) : '',
        email: typeof who.email === 'string' ? who.email.slice(0, 200) : ''
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not reach mDashboard to check the account.' };
    }
  }

  signOut(): void {
    deleteSecret(SECRET_REF);
    const link = readLink();
    writeLink({ ...link, name: '', email: '' });
    this.notify();
  }

  async floor(): Promise<FloorResult> {
    const token = getSecret(SECRET_REF);
    if (!token) return { ok: false, reason: 'signed-out', error: 'Sign in with your mDashboard account.' };
    const link = readLink();
    try {
      const res = await call(functionUrl(link.baseUrl, link.appId, 'officeFloor'), { method: 'POST', token, appId: link.appId, body: '{}' });
      const result = classifyFloorResponse(res.status, res.body);
      if (!result.ok && result.reason === 'signed-out') this.signOut();
      return result;
    } catch (e) {
      return { ok: false, reason: 'unreachable', error: `Could not reach mDashboard (${e instanceof Error ? e.message : String(e)}).` };
    }
  }

  /** Open a page of mDashboard in the browser. Paths only, never a full URL, so
   *  a snapshot can only ever open mDashboard itself. */
  open(path: unknown): { ok: boolean } {
    const p = dashboardPath(path ?? '/');
    if (!p) return { ok: false };
    void shell.openExternal(readLink().baseUrl + p);
    return { ok: true };
  }

  /** Every window, since a second floor window shows the same link. */
  private notify(): void {
    const status = this.status();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mdashboard:status', status);
    }
  }

  register(): void {
    ipcMain.handle('mdashboard:status', () => this.status());
    ipcMain.handle('mdashboard:settings', () => this.settings());
    ipcMain.handle('mdashboard:setSettings', (_e, input: unknown) =>
      this.setSettings(input && typeof input === 'object' ? input as { baseUrl?: unknown; appId?: unknown } : {}));
    ipcMain.handle('mdashboard:signIn', () => this.signIn());
    ipcMain.handle('mdashboard:cancelSignIn', () => { this.cancelSignIn(); });
    ipcMain.handle('mdashboard:signOut', () => { this.signOut(); });
    ipcMain.handle('mdashboard:floor', () => this.floor());
    ipcMain.handle('mdashboard:open', (_e, path: unknown) => this.open(path));
  }
}

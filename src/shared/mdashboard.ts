/**
 * mOffice ↔ mDashboard: the studio floor link (pure half).
 *
 * mOffice puts a real team on the office floor: the people in mDashboard (Merit
 * Concept's studio dashboard), at desks, showing what each person is on, what
 * they finished this week, and how every live project is moving. Nothing here
 * writes to mDashboard; the floor is read only.
 *
 * The link is two calls on mDashboard's Base44 backend:
 *   1. Sign in. The browser opens mDashboard's `suiteSignIn` page (the same
 *      hand-over mSuite for Mac uses) with a port on 127.0.0.1 and a one-time
 *      state. When the person presses the button, that page form-posts
 *      `{ state, token }` to `http://127.0.0.1:<port>/signed-in` and nowhere
 *      else. The token is kept encrypted in main (safeStorage) and never crosses
 *      into the renderer.
 *   2. Read the floor. `POST /api/apps/<appId>/functions/officeFloor` with the
 *      token, which returns the snapshot typed below. Admin only on the
 *      mDashboard side (base44/shared/officeFloor.js there).
 *
 * Kept free of electron so every rule is unit-tested under plain node
 * (test/mdashboard.test.cjs). The electron half is src/main/mdashboard.ts.
 */

/** mDashboard's address and its Base44 app id. Both can be overridden from
 *  Settings → mDashboard for a staging copy; these are the studio's own. */
export const MDASHBOARD_DEFAULT_URL = 'https://dashboard.meritconcept.com';
export const MDASHBOARD_APP_ID = '6a7e2b20e9ab5f7b143cd38f';

/** How often the floor re-reads mDashboard. The dashboard's own presence stamps
 *  land once a minute and count as "online" for three, so a minute is as fresh as
 *  the data gets; anything faster only spends the studio's backend credits. */
export const FLOOR_POLL_MS = 60_000;

/** How long the loopback sign-in waits for the browser before giving up. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

// ─── The snapshot officeFloor returns ───────────────────────────────────────

export type FloorState = 'working' | 'reviewing' | 'waiting' | 'free' | 'away' | 'leave';
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'awaiting_client' | 'done';
export type ProjectHealth = 'on_track' | 'at_risk' | 'overdue';

export interface FloorTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  due_date: string;
  overdue: boolean;
  project_id: string;
  project: string;
  client: string;
  /** A path inside mDashboard, e.g. "/tasks/abc". */
  link: string;
  done_at?: string;
}

export interface FloorPerson {
  id: string;
  name: string;
  role: string;
  photo: string;
  online: boolean;
  last_seen_at: string;
  state: FloorState;
  focus: FloorTask | null;
  counts: {
    todo: number; in_progress: number; review: number; awaiting_client: number;
    overdue: number; done_today: number; done_week: number;
  };
  done_recent: FloorTask[];
  /** Minutes with mDashboard open today. Presence, not time worked. */
  minutes_today: number;
  first_seen_at: string;
}

export interface FloorProject {
  id: string;
  title: string;
  client: string;
  status: string;
  end_date: string;
  /** 0..1 */
  progress: number;
  tasks: { total: number; done: number; in_progress: number; review: number; awaiting_client: number; overdue: number };
  milestones: { total: number; done: number; next: { title: string; due_date: string } | null };
  team: Array<{ id: string; name: string }>;
  health: ProjectHealth;
  link: string;
}

export interface FloorFeedEntry {
  at: string;
  kind: string;
  who: string;
  text: string;
  link: string;
}

export interface StudioFloor {
  generated_at: string;
  today: string;
  studio: string;
  totals: {
    people: number; online: number; on_leave: number; live_projects: number; at_risk: number;
    in_progress: number; overdue: number; done_today: number; done_week: number;
  };
  people: FloorPerson[];
  projects: FloorProject[];
  feed: FloorFeedEntry[];
}

/** What the renderer is told about the link. Never the token. */
export type LinkStatus =
  | { state: 'signed-out' }
  | { state: 'signing-in' }
  | { state: 'signed-in'; name: string; email: string; baseUrl: string };

export type FloorResult =
  | { ok: true; floor: StudioFloor }
  | { ok: false; reason: 'signed-out' | 'forbidden' | 'unreachable' | 'bad-response'; error: string };

// ─── URLs ───────────────────────────────────────────────────────────────────

/** An https origin (or http on localhost, for a local `base44 dev`), with no
 *  path, query or credentials. Anything else is refused, so a typo in Settings
 *  can never send the sign-in token somewhere unexpected. */
export function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.username || u.password) return null;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) return null;
  return u.origin;
}

export function normalizeAppId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[a-f0-9]{24}$/i.test(raw.trim()) ? raw.trim() : null;
}

export function functionUrl(baseUrl: string, appId: string, name: string): string {
  return `${baseUrl}/api/apps/${appId}/functions/${encodeURIComponent(name)}`;
}

export function meUrl(baseUrl: string, appId: string): string {
  return `${baseUrl}/api/apps/${appId}/entities/User/me`;
}

/** The page the browser opens to sign in. `app=office` makes it say mOffice. */
export function signInUrl(baseUrl: string, appId: string, port: number, state: string): string {
  const q = new URLSearchParams({ port: String(port), state, app: 'office' });
  return `${functionUrl(baseUrl, appId, 'suiteSignIn')}?${q.toString()}`;
}

/** The headers every call to mDashboard carries, as the Base44 SDK sends them. */
export function authHeaders(token: string, appId: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-App-Id': appId, 'Content-Type': 'application/json' };
}

/** A path inside mDashboard ("/tasks/abc") that may be opened in the browser,
 *  or null. The same rule mDashboard applies to the links it hands out
 *  (noticePath in base44/shared/suiteAccount.js), applied again here so a
 *  snapshot can only ever open mDashboard itself. */
export function dashboardPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || v.length > 300) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(v)) return null;
  return v;
}

// ─── The loopback hand-over ─────────────────────────────────────────────────

/** The state suiteSignIn accepts: 16–64 of [A-Za-z0-9_-]. */
export function isValidState(state: unknown): state is string {
  return typeof state === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(state);
}

/** Read the form suiteSignIn posts. Returns null for anything that is not
 *  exactly a state and a token. */
export function parseSignedInForm(body: string): { state: string; token: string } | null {
  if (typeof body !== 'string' || body.length > 16_384) return null;
  const form = new URLSearchParams(body);
  const state = form.get('state') || '';
  const token = form.get('token') || '';
  if (!isValidState(state)) return null;
  if (!token || token.length > 8192 || /\s/.test(token)) return null;
  return { state, token };
}

/** Constant-time string compare, so a wrong state reveals nothing about the
 *  right one through timing. */
export function sameState(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Reading the answer ─────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether a response body has the shape of a floor. Checked loosely (the
 *  arrays and the totals) so an mDashboard that adds a field does not break an
 *  older mOffice, and strictly enough that an error page never renders as an
 *  empty office. */
export function isStudioFloor(v: unknown): v is StudioFloor {
  return isObj(v)
    && Array.isArray(v.people)
    && Array.isArray(v.projects)
    && Array.isArray(v.feed)
    && isObj(v.totals)
    && typeof v.today === 'string';
}

export function classifyFloorResponse(status: number, body: unknown): FloorResult {
  const said = isObj(body) && typeof body.error === 'string' ? body.error : '';
  if (status === 401) return { ok: false, reason: 'signed-out', error: 'mDashboard signed you out. Sign in again.' };
  if (status === 403) return { ok: false, reason: 'forbidden', error: said || 'Only an mDashboard admin can open the studio floor.' };
  if (status < 200 || status >= 300) return { ok: false, reason: 'unreachable', error: said || `mDashboard answered ${status}.` };
  if (!isStudioFloor(body)) return { ok: false, reason: 'bad-response', error: 'mDashboard sent something that is not a studio floor. Is it up to date?' };
  return { ok: true, floor: body };
}

// ─── Floor helpers the renderer shares ──────────────────────────────────────

/** Who sits at a desk: everyone but those on leave, who are shown in the
 *  roster instead of at an empty chair. */
export function seatedPeople(floor: StudioFloor | null): FloorPerson[] {
  return floor ? floor.people.filter((p) => p.state !== 'leave') : [];
}

/** One line for the thought cloud above a desk. */
export function deskLine(p: FloorPerson): string {
  const f = p.focus;
  const on = f ? (f.project ? `${f.title} · ${f.project}` : f.title) : '';
  switch (p.state) {
    case 'working': return on || 'working';
    case 'reviewing': return on ? `in review: ${on}` : 'reviewing';
    case 'waiting': return on ? `waiting on client: ${on}` : 'waiting on a client';
    case 'free': return p.counts.done_today > 0 ? `done ${p.counts.done_today} today, free` : 'free for work';
    case 'leave': return 'on leave';
    default: return '';
  }
}

export const STATE_LABEL: Record<FloorState, string> = {
  working: 'Working',
  reviewing: 'In review',
  waiting: 'Waiting on client',
  free: 'Free',
  away: 'Away',
  leave: 'On leave',
};

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  overdue: 'Overdue',
};

/** "12m", "3h 20m" — minutes with mDashboard open. */
export function minutesLabel(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

/** "just now", "5 min ago", "2 h ago", "3 days ago". */
export function agoLabel(iso: string, now: number): string {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

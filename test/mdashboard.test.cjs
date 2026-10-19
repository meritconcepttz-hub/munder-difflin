'use strict';

/**
 * mOffice ↔ mDashboard link (src/shared/mdashboard.ts).
 *
 * The sign-in token is the one secret this link holds, so most of these pin the
 * places it could go somewhere it should not: a base URL that is not an https
 * origin, a hand-over form that is not exactly state + token, a state compared
 * any way but exactly, and a link from the snapshot that is not a path inside
 * mDashboard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const md = loadTs('src/shared/mdashboard.ts');

test('accepts an https origin, or http on localhost, and nothing else', () => {
  assert.equal(md.normalizeBaseUrl('https://dashboard.meritconcept.com'), 'https://dashboard.meritconcept.com');
  assert.equal(md.normalizeBaseUrl(' https://dashboard.meritconcept.com/ '), 'https://dashboard.meritconcept.com');
  assert.equal(md.normalizeBaseUrl('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(md.normalizeBaseUrl('http://dashboard.meritconcept.com'), null);
  assert.equal(md.normalizeBaseUrl('https://dashboard.meritconcept.com/api'), null);
  assert.equal(md.normalizeBaseUrl('https://user:pw@dashboard.meritconcept.com'), null);
  assert.equal(md.normalizeBaseUrl('https://dashboard.meritconcept.com?x=1'), null);
  assert.equal(md.normalizeBaseUrl('file:///etc/passwd'), null);
  assert.equal(md.normalizeBaseUrl(''), null);
  assert.equal(md.normalizeBaseUrl(42), null);
});

test('accepts a Base44 app id only', () => {
  assert.equal(md.normalizeAppId(md.MDASHBOARD_APP_ID), md.MDASHBOARD_APP_ID);
  assert.equal(md.normalizeAppId('not-an-id'), null);
  assert.equal(md.normalizeAppId('../../evil'), null);
});

test('builds the URLs the Base44 SDK uses', () => {
  const base = 'https://dashboard.meritconcept.com';
  const id = md.MDASHBOARD_APP_ID;
  assert.equal(md.functionUrl(base, id, 'officeFloor'), `${base}/api/apps/${id}/functions/officeFloor`);
  assert.equal(md.meUrl(base, id), `${base}/api/apps/${id}/entities/User/me`);
  const url = new URL(md.signInUrl(base, id, 51234, 'abcdefghijklmnopqrstuvwxyz012345'));
  assert.equal(url.pathname, `/api/apps/${id}/functions/suiteSignIn`);
  assert.equal(url.searchParams.get('port'), '51234');
  assert.equal(url.searchParams.get('state'), 'abcdefghijklmnopqrstuvwxyz012345');
  assert.equal(url.searchParams.get('app'), 'office');
});

test('sends the token as the SDK does, and the app id with it', () => {
  assert.deepEqual(md.authHeaders('tok', 'app'), {
    Authorization: 'Bearer tok', 'X-App-Id': 'app', 'Content-Type': 'application/json'
  });
});

test('reads the hand-over form: exactly a valid state and a token', () => {
  const state = 'A'.repeat(32);
  assert.deepEqual(md.parseSignedInForm(`state=${state}&token=eyJ.abc.def`), { state, token: 'eyJ.abc.def' });
  assert.equal(md.parseSignedInForm('state=short&token=x'), null);
  assert.equal(md.parseSignedInForm(`state=${state}`), null);
  assert.equal(md.parseSignedInForm(`state=${state}&token=has%20space`), null);
  assert.equal(md.parseSignedInForm('x'.repeat(20000)), null);
});

test('compares the state exactly', () => {
  assert.equal(md.sameState('abc', 'abc'), true);
  assert.equal(md.sameState('abc', 'abd'), false);
  assert.equal(md.sameState('abc', 'abcd'), false);
});

test('opens paths inside mDashboard only', () => {
  assert.equal(md.dashboardPath('/tasks/abc'), '/tasks/abc');
  assert.equal(md.dashboardPath('//evil.example/x'), null);
  assert.equal(md.dashboardPath('https://evil.example'), null);
  assert.equal(md.dashboardPath('/a\\b'), null);
  assert.equal(md.dashboardPath('/a\nb'), null);
  assert.equal(md.dashboardPath(null), null);
});

const floor = () => ({
  generated_at: '2026-10-19T07:00:00.000Z',
  today: '2026-10-19',
  studio: 'Merit Concept',
  totals: { people: 2, online: 1, on_leave: 1, live_projects: 0, at_risk: 0, in_progress: 1, overdue: 0, done_today: 0, done_week: 0 },
  people: [
    { id: 'u1', name: 'Asha', state: 'working', counts: { done_today: 0 }, focus: { title: 'Edit film', project: 'Lodge launch' } },
    { id: 'u2', name: 'Juma', state: 'leave', counts: { done_today: 0 }, focus: null }
  ],
  projects: [],
  feed: []
});

test('classifies what mDashboard answers', () => {
  assert.equal(md.classifyFloorResponse(200, floor()).ok, true);
  assert.equal(md.classifyFloorResponse(401, { error: 'Unauthorized' }).reason, 'signed-out');
  const forbidden = md.classifyFloorResponse(403, { error: 'Only an admin can open the studio floor' });
  assert.equal(forbidden.reason, 'forbidden');
  assert.equal(forbidden.error, 'Only an admin can open the studio floor');
  assert.equal(md.classifyFloorResponse(500, null).reason, 'unreachable');
  // An HTML error page, or an older mDashboard without officeFloor, is not an
  // empty office.
  assert.equal(md.classifyFloorResponse(200, null).reason, 'bad-response');
  assert.equal(md.classifyFloorResponse(200, { people: [] }).reason, 'bad-response');
});

test('seats everyone but those on leave', () => {
  assert.deepEqual(md.seatedPeople(floor()).map((p) => p.id), ['u1']);
  assert.deepEqual(md.seatedPeople(null), []);
});

test('says what a desk is doing in one line', () => {
  const [asha] = floor().people;
  assert.equal(md.deskLine(asha), 'Edit film · Lodge launch');
  assert.equal(md.deskLine({ ...asha, state: 'waiting' }), 'waiting on client: Edit film · Lodge launch');
  assert.equal(md.deskLine({ ...asha, state: 'free', focus: null, counts: { done_today: 3 } }), 'done 3 today, free');
  assert.equal(md.deskLine({ ...asha, state: 'away' }), '');
});

test('labels minutes and ages', () => {
  assert.equal(md.minutesLabel(0), '0m');
  assert.equal(md.minutesLabel(45), '45m');
  assert.equal(md.minutesLabel(120), '2h');
  assert.equal(md.minutesLabel(200), '3h 20m');
  const now = Date.parse('2026-10-19T07:00:00Z');
  assert.equal(md.agoLabel('2026-10-19T06:59:30Z', now), 'just now');
  assert.equal(md.agoLabel('2026-10-19T06:55:00Z', now), '5 min ago');
  assert.equal(md.agoLabel('2026-10-19T04:00:00Z', now), '3 h ago');
  assert.equal(md.agoLabel('2026-10-18T06:00:00Z', now), 'yesterday');
  assert.equal(md.agoLabel('nope', now), '');
});

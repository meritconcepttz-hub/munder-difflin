/** mOffice: the studio floor's side panel.
 *
 *  Signed out, it is the sign-in. Signed in, it is the board: the studio's
 *  totals, then Team (who is on what), Projects (how each live project is
 *  moving) and Activity (what got done). Selecting a person, here or by
 *  clicking them on the floor, opens their card. Everything links back to the
 *  page in mDashboard where the work actually lives; nothing is edited here. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { PixelPanel } from '@/components/PixelPanel';
import { PixelButton } from '@/components/PixelButton';
import {
  FLOOR_POLL_MS, HEALTH_LABEL, STATE_LABEL, agoLabel, minutesLabel,
  type FloorPerson, type FloorProject, type FloorTask, type FloorState, type ProjectHealth
} from '@shared/mdashboard';
import { useStudio, type StudioTab } from './studioStore';

const STATE_COLOR: Record<FloorState, string> = {
  working: 'var(--cth-status-working)',
  reviewing: 'var(--cth-status-thinking)',
  waiting: 'var(--cth-status-waiting)',
  free: 'var(--cth-status-success)',
  away: 'var(--cth-status-idle)',
  leave: 'var(--cth-status-ghost)'
};

const HEALTH_COLOR: Record<ProjectHealth, string> = {
  on_track: 'var(--cth-mint)',
  at_risk: 'var(--cth-lemon)',
  overdue: 'var(--cth-coral)'
};

const label: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '14px',
  color: 'var(--cth-ink-500)', letterSpacing: 0.5, textTransform: 'uppercase'
};
const small: CSSProperties = { fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-500)' };
const body: CSSProperties = { fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-900)' };
const rowButton: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'start', padding: '10px 12px',
  background: 'transparent', border: 'none', borderBottom: '1px solid var(--cth-ink-100)',
  cursor: 'pointer', color: 'inherit', font: 'inherit'
};

const open = (path: string) => { if (path) void window.cth.mdashboardOpen(path); };

/** Keep the floor fresh while it is on screen: on entering the mode, once a
 *  minute after that, and when the window comes back into focus. */
export function useStudioPolling(): void {
  const mode = useStudio((s) => s.mode);
  const link = useStudio((s) => s.link);
  const setLink = useStudio((s) => s.setLink);
  const refresh = useStudio((s) => s.refresh);

  useEffect(() => {
    let alive = true;
    void window.cth.mdashboardStatus().then((s) => { if (alive) setLink(s); });
    const off = window.cth.onMdashboardStatus((s) => setLink(s));
    return () => { alive = false; off(); };
  }, [setLink]);

  const signedIn = link?.state === 'signed-in';
  useEffect(() => {
    if (mode !== 'studio' || !signedIn) return;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, FLOOR_POLL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [mode, signedIn, refresh]);
}

export function StudioPanel() {
  const link = useStudio((s) => s.link);
  const floor = useStudio((s) => s.floor);
  const reason = useStudio((s) => s.reason);
  const error = useStudio((s) => s.error);
  const selectedId = useStudio((s) => s.selectedPersonId);

  if (!link || link.state !== 'signed-in') return <SignInCard signingIn={link?.state === 'signing-in'} />;
  if (!floor && reason === 'forbidden') {
    return (
      <Shell title="STUDIO FLOOR">
        <Pad>
          <p style={body}>{error}</p>
          <p style={small}>Signed in as {link.name || link.email}. Ask the studio admin, or sign in with an admin account.</p>
          <PixelButton variant="secondary" size="md" onClick={() => void window.cth.mdashboardSignOut()}>Sign out</PixelButton>
        </Pad>
      </Shell>
    );
  }
  if (!floor) {
    return (
      <Shell title="STUDIO FLOOR">
        <Pad><p style={body}>{error ?? 'Reading the floor from mDashboard…'}</p></Pad>
      </Shell>
    );
  }

  const person = selectedId ? floor.people.find((p) => p.id === selectedId) : undefined;
  return (
    <Shell title={floor.studio ? floor.studio.toUpperCase() : 'STUDIO FLOOR'}>
      <Header />
      <Totals />
      {person ? <PersonCard person={person} /> : <Tabs />}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PixelPanel variant="default" noPadding title={title} style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>
    </PixelPanel>
  );
}

function Pad({ children }: { children: ReactNode }) {
  return <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>;
}

function SignInCard({ signingIn }: { signingIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [appId, setAppId] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void window.cth.mdashboardSettings().then((s) => { setBaseUrl(s.baseUrl); setAppId(s.appId); });
  }, []);

  const signIn = async () => {
    setBusy(true); setError(null);
    const r = await window.cth.mdashboardSignIn();
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'Signing in did not finish.');
  };

  const input: CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '6px 8px', font: 'inherit', fontSize: 12,
    background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
    border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', borderRadius: 2
  };

  return (
    <Shell title="CONNECT MDASHBOARD">
      <Pad>
        <p style={body}>
          Put your team on the floor. mOffice reads mDashboard to show who is in, what each person is on,
          what they finished this week, and how every live project is moving.
        </p>
        <p style={small}>
          Your browser opens mDashboard to sign in. It is read only: nothing on the floor changes anything in
          mDashboard. The studio floor needs an admin account.
        </p>
        {signingIn || busy ? (
          <>
            <p style={body}>Finish signing in in your browser…</p>
            <PixelButton variant="secondary" size="md" onClick={() => void window.cth.mdashboardCancelSignIn()}>Cancel</PixelButton>
          </>
        ) : (
          <PixelButton variant="primary" size="md" onClick={() => void signIn()}>Sign in with mDashboard</PixelButton>
        )}
        {error && <p style={{ ...small, color: 'var(--cth-coral)' }}>{error}</p>}
        <button type="button" onClick={() => setAdvanced((v) => !v)} style={{ ...small, background: 'none', border: 'none', padding: 0, textAlign: 'start', cursor: 'pointer', textDecoration: 'underline' }}>
          {advanced ? 'Hide' : 'Use a different mDashboard'}
        </button>
        {advanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>Address</span>
            <input style={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://dashboard.meritconcept.com" />
            <span style={label}>Base44 app id</span>
            <input style={input} value={appId} onChange={(e) => setAppId(e.target.value)} />
            <PixelButton variant="secondary" size="sm" onClick={async () => {
              const r = await window.cth.mdashboardSetSettings({ baseUrl, appId });
              setSaved(r.ok ? 'Saved.' : r.error ?? 'Not saved.');
            }}>Save</PixelButton>
            {saved && <span style={small}>{saved}</span>}
          </div>
        )}
      </Pad>
    </Shell>
  );
}

function Header() {
  const link = useStudio((s) => s.link);
  const fetchedAt = useStudio((s) => s.fetchedAt);
  const loading = useStudio((s) => s.loading);
  const error = useStudio((s) => s.error);
  const refresh = useStudio((s) => s.refresh);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 30_000); return () => window.clearInterval(t); }, []);
  const who = link?.state === 'signed-in' ? (link.name || link.email) : '';
  return (
    <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--cth-ink-100)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...small, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {error ? <span style={{ color: 'var(--cth-coral)' }}>{error}</span> : <>Updated {fetchedAt ? agoLabel(new Date(fetchedAt).toISOString(), Date.now()) : '…'}</>}
        </div>
        <div style={{ ...small, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Signed in as {who}</div>
      </div>
      <PixelButton variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>{loading ? '…' : 'Refresh'}</PixelButton>
      <PixelButton variant="ghost" size="sm" onClick={() => open('/')} title="Open mDashboard">mDashboard</PixelButton>
      <PixelButton variant="ghost" size="sm" onClick={() => void window.cth.mdashboardSignOut()}>Sign out</PixelButton>
    </div>
  );
}

function Totals() {
  const floor = useStudio((s) => s.floor)!;
  const t = floor.totals;
  const cells: Array<[string, string, string?]> = [
    ['In now', `${t.online}/${t.people}`],
    ['In progress', String(t.in_progress)],
    ['Done today', String(t.done_today)],
    ['This week', String(t.done_week)],
    ['Overdue', String(t.overdue), t.overdue ? 'var(--cth-coral)' : undefined],
    ['Projects at risk', `${t.at_risk}/${t.live_projects}`, t.at_risk ? 'var(--cth-lemon)' : undefined]
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, background: 'var(--cth-ink-100)', borderBottom: '1px solid var(--cth-ink-100)' }}>
      {cells.map(([k, v, c]) => (
        <div key={k} style={{ background: 'var(--cth-cream-100)', padding: '8px 10px' }}>
          <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 14, lineHeight: '20px', color: c ?? 'var(--cth-ink-900)' }}>{v}</div>
          <div style={label}>{k}</div>
        </div>
      ))}
    </div>
  );
}

function Tabs() {
  const tab = useStudio((s) => s.tab);
  const setTab = useStudio((s) => s.setTab);
  const tabs: Array<[StudioTab, string]> = [['team', 'Team'], ['projects', 'Projects'], ['activity', 'Activity']];
  return (
    <>
      <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid var(--cth-ink-100)' }}>
        {tabs.map(([id, name]) => (
          <button
            key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
            style={{
              flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12,
              background: tab === id ? 'var(--cth-cream-200)' : 'transparent',
              color: tab === id ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)',
              boxShadow: tab === id ? 'inset 0 -2px 0 var(--cth-ink-900)' : 'none'
            }}
          >{name}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'team' && <TeamList />}
        {tab === 'projects' && <ProjectList />}
        {tab === 'activity' && <ActivityList />}
      </div>
    </>
  );
}

function Dot({ state }: { state: FloorState }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 1, background: STATE_COLOR[state], flexShrink: 0 }} />;
}

function Chip({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', fontSize: 11, lineHeight: '16px', borderRadius: 2,
      background: 'var(--cth-paper-200)', color: tone ?? 'var(--cth-ink-700)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
    }}>{children}</span>
  );
}

function TeamList() {
  const floor = useStudio((s) => s.floor)!;
  const select = useStudio((s) => s.selectPerson);
  if (!floor.people.length) return <Pad><p style={small}>Nobody on the team yet.</p></Pad>;
  return (
    <div>
      {floor.people.map((p) => (
        <button key={p.id} type="button" style={rowButton} onClick={() => select(p.id)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dot state={p.state} />
            <span style={{ ...body, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            <span style={small}>{STATE_LABEL[p.state]}</span>
          </div>
          {p.focus && (
            <div style={{ ...small, marginTop: 2, paddingInlineStart: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.focus.title}{p.focus.project ? ` · ${p.focus.project}` : ''}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6, paddingInlineStart: 16 }}>
            <Chip>{p.counts.in_progress} in progress</Chip>
            {p.counts.review > 0 && <Chip>{p.counts.review} in review</Chip>}
            {p.counts.awaiting_client > 0 && <Chip>{p.counts.awaiting_client} with client</Chip>}
            <Chip>{p.counts.done_week} done this week</Chip>
            {p.counts.overdue > 0 && <Chip tone="var(--cth-coral)">{p.counts.overdue} overdue</Chip>}
          </div>
        </button>
      ))}
    </div>
  );
}

function TaskLine({ task, done }: { task: FloorTask; done?: boolean }) {
  return (
    <button type="button" style={{ ...rowButton, padding: '8px 0' }} onClick={() => open(task.link)} title="Open in mDashboard">
      <div style={{ ...body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
      <div style={small}>
        {[task.project, task.client].filter(Boolean).join(' · ')}
        {done && task.done_at ? ` · done ${agoLabel(task.done_at, Date.now())}` : ''}
        {!done && task.due_date ? ` · due ${task.due_date}` : ''}
        {!done && task.overdue ? ' · overdue' : ''}
      </div>
    </button>
  );
}

function PersonCard({ person: p }: { person: FloorPerson }) {
  const select = useStudio((s) => s.selectPerson);
  const facts: Array<[string, string]> = [
    ['To do', String(p.counts.todo)],
    ['In progress', String(p.counts.in_progress)],
    ['In review', String(p.counts.review)],
    ['With client', String(p.counts.awaiting_client)],
    ['Done today', String(p.counts.done_today)],
    ['Done this week', String(p.counts.done_week)]
  ];
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <Pad>
        <button type="button" onClick={() => select(null)} style={{ ...small, background: 'none', border: 'none', padding: 0, textAlign: 'start', cursor: 'pointer' }}>‹ Everyone</button>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* An initial, not the mDashboard photo: the renderer's CSP allows no
              remote images, and opening it to them would let any agent's
              markdown load a tracking pixel too. */}
          <div aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 2, background: 'var(--cth-cream-200)', display: 'grid', placeItems: 'center', fontFamily: 'var(--cth-font-display)', fontSize: 14 }}>{p.name.slice(0, 1)}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...body, fontWeight: 600, fontSize: 15 }}>{p.name}</div>
            <div style={{ ...small, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot state={p.state} /> {STATE_LABEL[p.state]}
              {p.role ? ` · ${p.role}` : ''}
            </div>
          </div>
        </div>
        <div>
          <div style={label}>On now</div>
          {p.focus ? <TaskLine task={p.focus} /> : <p style={small}>Nothing in progress.</p>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {facts.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 13 }}>{v}</div>
              <div style={label}>{k}</div>
            </div>
          ))}
        </div>
        {p.counts.overdue > 0 && <p style={{ ...small, color: 'var(--cth-coral)' }}>{p.counts.overdue} overdue</p>}
        <div>
          <div style={label}>Finished this week</div>
          {p.done_recent.length ? p.done_recent.map((t) => <TaskLine key={t.id} task={t} done />) : <p style={small}>Nothing finished yet this week.</p>}
        </div>
        <p style={small}>
          {p.online ? 'In mDashboard now' : p.last_seen_at ? `Last in mDashboard ${agoLabel(p.last_seen_at, Date.now())}` : 'Not seen in mDashboard yet'}
          {p.minutes_today ? ` · ${minutesLabel(p.minutes_today)} with it open today` : ''}
        </p>
      </Pad>
    </div>
  );
}

function ProjectRow({ project: pr }: { project: FloorProject }) {
  const pct = Math.round(pr.progress * 100);
  return (
    <button type="button" style={rowButton} onClick={() => open(pr.link)} title="Open in mDashboard">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...body, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.title}</span>
        <span style={{ ...small, color: HEALTH_COLOR[pr.health] }}>{HEALTH_LABEL[pr.health]}</span>
      </div>
      {pr.client && <div style={small}>{pr.client}</div>}
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pr.title} progress`}
        style={{ height: 6, marginTop: 6, background: 'var(--cth-paper-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: HEALTH_COLOR[pr.health] }} />
      </div>
      <div style={{ ...small, marginTop: 4 }}>
        {pct}% · {pr.tasks.done}/{pr.tasks.total} tasks done
        {pr.tasks.overdue ? ` · ${pr.tasks.overdue} overdue` : ''}
        {pr.end_date ? ` · ends ${pr.end_date}` : ''}
      </div>
      {pr.milestones.next && (
        <div style={small}>Next: {pr.milestones.next.title}{pr.milestones.next.due_date ? ` (${pr.milestones.next.due_date})` : ''}</div>
      )}
      {pr.team.length > 0 && <div style={small}>On it: {pr.team.map((m) => m.name).join(', ')}</div>}
    </button>
  );
}

function ProjectList() {
  const floor = useStudio((s) => s.floor)!;
  if (!floor.projects.length) return <Pad><p style={small}>No live projects.</p></Pad>;
  return <div>{floor.projects.map((p) => <ProjectRow key={p.id} project={p} />)}</div>;
}

function ActivityList() {
  const floor = useStudio((s) => s.floor)!;
  if (!floor.feed.length) return <Pad><p style={small}>Nothing recorded this week yet.</p></Pad>;
  return (
    <div>
      {floor.feed.map((e, i) => (
        <button key={`${e.at}-${i}`} type="button" style={rowButton} onClick={() => open(e.link)} disabled={!e.link}>
          <div style={body}>{e.text}</div>
          <div style={small}>{[e.who, agoLabel(e.at, Date.now())].filter(Boolean).join(' · ')}</div>
        </button>
      ))}
    </div>
  );
}

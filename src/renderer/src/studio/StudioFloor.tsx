/** mOffice: the studio floor. The real team from mDashboard, at desks.
 *
 *  The same office as the agent floor (map, camera, cast, desk monitors), built
 *  from the same scene parts, but driven by the officeFloor snapshot instead of
 *  agent PTYs. Deliberately a separate, much smaller scene rather than a mode of
 *  OfficeFloor.tsx: that file's director (coffee runs, errands, the boss's aura,
 *  envelopes) reads the agent store everywhere, and teaching it about people
 *  would mean every one of those paths checking which kind of avatar it holds.
 *
 *  What a desk shows, from FloorPerson.state:
 *    working    seated, typing, monitor on, cloud says the task and project
 *    reviewing  seated, monitor on, cloud says it is in review
 *    waiting    seated, monitor off, cloud says it is waiting on the client
 *    free       up and about the office, cloud says what they finished today
 *    away       a faded figure at their own desk, no cloud: the desk is theirs
 *  People on leave get no desk; the panel lists them.
 *
 *  A person who finished a task since the last read cheers. */
import { useEffect, useRef, useState } from 'react';
import { Application, Container, Texture, type Ticker } from 'pixi.js';
// PixiJS uses new Function() internally, blocked by Electron CSP — this patches it.
import 'pixi.js/unsafe-eval';
import { TiledMapRenderer } from '@/scene/office/TiledMapRenderer';
import { Camera } from '@/scene/office/Camera';
import { Character } from '@/scene/office/Character';
import { DeskScreen } from '@/scene/office/DeskScreen';
import { hexToNumber } from '@/scene/office/cast';
import { loadTheme, resolveThemeMap, themeTilesetUrls } from '@/scene/office/themeLoader';
import type { Tile } from '@/scene/office/themeRegistry';
import { colors } from '@/design/tokens';
import { useStore } from '@/store/store';
import { deskLine, seatedPeople, type FloorPerson, type StudioFloor as Floor } from '@shared/mdashboard';
import { useStudio } from './studioStore';

interface Desk {
  character: Character;
  seat: number;
  screen?: DeskScreen;
  state?: FloorPerson['state'];
  line?: string;
  doneToday: number;
}

const AWAY_ALPHA = 0.38;

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = Texture.from(img);
      tex.source.scaleMode = 'nearest';
      resolve(tex);
    };
    img.onerror = () => reject(new Error('failed to load ' + url.slice(0, 40)));
    img.src = url;
  });
}

/** A stable small number from an id, so a person keeps their look across reads. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** First name on the name tag: a desk has room for one word. */
function shortName(name: string): string {
  return (name.trim().split(/\s+/)[0] || name).slice(0, 14);
}

/** Who sits where, and as whom. Seats and looks are handed out in id order, so
 *  the floor does not reshuffle every minute as states change. The corner office
 *  (seat 0) goes to the first admin. */
export function planDesks(people: FloorPerson[], seatCount: number, cast: string[]): Map<string, { seat: number; look: string }> {
  const plan = new Map<string, { seat: number; look: string }>();
  const ordered = [...people].sort((a, b) => a.id.localeCompare(b.id));
  const boss = ordered.find((p) => p.role === 'admin');
  const looks = new Set<string>();
  const pickLook = (id: string): string => {
    if (!cast.length) return '';
    const start = hashOf(id) % cast.length;
    for (let i = 0; i < cast.length; i++) {
      const c = cast[(start + i) % cast.length];
      if (!looks.has(c)) { looks.add(c); return c; }
    }
    return cast[start]; // more people than looks: share
  };
  let next = 1;
  if (boss && seatCount > 0) plan.set(boss.id, { seat: 0, look: pickLook(boss.id) });
  for (const p of ordered) {
    if (plan.has(p.id)) continue;
    if (next >= seatCount) break; // the office is full; the panel still lists them
    plan.set(p.id, { seat: next++, look: pickLook(p.id) });
  }
  return plan;
}

export function StudioFloor() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const mountIdRef = useRef(0);
  const officeTheme = useStore((s) => s.officeTheme);
  const [docHidden, setDocHidden] = useState(() => document.hidden);

  useEffect(() => {
    const onVis = () => setDocHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const pausedRef = useRef(docHidden);
  useEffect(() => {
    pausedRef.current = docHidden;
    const ticker = appRef.current?.ticker;
    if (!ticker) return;
    if (docHidden) ticker.stop(); else ticker.start();
  }, [docHidden]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    const mountId = ++mountIdRef.current;
    const app = new Application();
    appRef.current = app;
    const desks = new Map<string, Desk>();
    const cleanups: Array<() => void> = [];

    const init = async () => {
      const theme = await loadTheme(officeTheme);
      await app.init({
        background: theme.palette.background,
        antialias: false,
        roundPixels: true,
        resolution: Math.max(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        width: host.clientWidth || 800,
        height: host.clientHeight || 600
      });
      if (mountIdRef.current !== mountId) { safeDestroy(app); return; }
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(app.canvas);

      const tilesetTextures = await Promise.all(themeTilesetUrls(theme).map(loadTexture));
      if (mountIdRef.current !== mountId) { safeDestroy(app); return; }

      const world = new Container();
      app.stage.addChild(world);
      const map = new TiledMapRenderer(resolveThemeMap(theme), tilesetTextures);
      world.addChild(map.getContainer());
      const charLayer = map.getCharacterContainer();

      const camera = new Camera(world);
      camera.setMapSize(map.width * map.tileSize, map.height * map.tileSize);
      camera.setViewSize(app.screen.width, app.screen.height);
      camera.fitToScreen();

      // The same desk order as the agent floor: the corner office, the PCs, the
      // named desks, then the boardroom chairs as overflow.
      const seats: Tile[] = [];
      const seen = new Set<string>();
      const addSeat = (t?: Tile) => {
        if (!t) return;
        const k = `${t.x},${t.y}`;
        if (seen.has(k)) return;
        seen.add(k);
        seats.push({ x: t.x, y: t.y });
      };
      for (const name of theme.primarySeatNames) addSeat(map.getSpawnPoint(name));
      const board = map.getZone('boardroom');
      if (board) {
        for (let y = board.y; y < board.y + board.height; y++) {
          for (let x = board.x; x < board.x + board.width; x++) {
            if (map.isWalkable(x, y)) addSeat({ x, y });
          }
        }
      }
      const entrance = map.getSpawnPoint('entrance') ?? { x: Math.floor(map.width / 2), y: map.height - 2 };
      const facing = (t: Tile): 'up' | 'down' | 'left' | 'right' => {
        if (!map.isWalkable(t.x, t.y - 1)) return 'up';
        if (!map.isWalkable(t.x, t.y + 1)) return 'down';
        if (!map.isWalkable(t.x - 1, t.y)) return 'left';
        if (!map.isWalkable(t.x + 1, t.y)) return 'right';
        return 'up';
      };
      const castNames = Object.keys(theme.cast.byName);

      const apply = (p: FloorPerson, d: Desk, first: boolean) => {
        const c = d.character;
        const line = deskLine(p);
        if (!first && d.state === p.state && d.line === line && p.counts.done_today <= d.doneToday) return;
        const finished = !first && p.counts.done_today > d.doneToday;
        d.state = p.state;
        d.line = line;
        d.doneToday = p.counts.done_today;
        c.setName(shortName(p.name));
        c.setBaseAlpha(p.state === 'away' ? AWAY_ALPHA : 1);
        d.screen?.setOn(p.state === 'working' || p.state === 'reviewing');
        switch (p.state) {
          case 'working':
          case 'reviewing':
            c.sitAtDesk(true);
            c.showThought(line);
            break;
          case 'waiting':
            c.sitAtDesk(false);
            c.showThought(line);
            break;
          case 'free':
            c.startWandering();
            c.showThought(line);
            break;
          default:
            c.sitAtDesk(false);
            c.hideThought();
        }
        if (finished && p.state !== 'away') c.cheer();
      };

      const add = async (p: FloorPerson, seat: number, look: string) => {
        const name = theme.cast.byName[look] ? look : theme.cast.defaultCharacter;
        const frames = await theme.cast.getFrames(name);
        if (mountIdRef.current !== mountId || desks.has(p.id)) return;
        const seatTile = seats[seat];
        // Someone already away starts at their desk; someone in walks in the door.
        const character = new Character({
          agentId: p.id,
          displayName: shortName(p.name),
          mapRenderer: map,
          frames,
          seatTile,
          seatDirection: facing(seatTile),
          spawnTile: p.state === 'away' ? seatTile : entrance,
          glowColor: hexToNumber(theme.cast.byName[name].shirt),
          onClick: (id) => useStudio.getState().selectPerson(id)
        });
        character.show(charLayer);
        const desk: Desk = { character, seat, doneToday: p.counts.done_today };
        if (map.gidAt('furniture-above', seatTile.x, seatTile.y - 2) === theme.monitor.offTopLeftGid) {
          desk.screen = new DeskScreen(map, { x: seatTile.x, y: seatTile.y - 2 }, theme.monitor);
          charLayer.addChild(desk.screen.container);
        }
        desks.set(p.id, desk);
        apply(p, desk, true);
      };

      const remove = (id: string) => {
        const d = desks.get(id);
        if (!d) return;
        d.screen?.setOn(false);
        d.screen?.destroy();
        d.character.destroy();
        desks.delete(id);
      };

      const sync = (floor: Floor | null) => {
        const people = seatedPeople(floor);
        const plan = planDesks(people, seats.length, castNames);
        for (const [id, d] of Array.from(desks.entries())) {
          // Gone from the floor, or moved seat because the team changed: rebuild.
          if (!plan.has(id) || plan.get(id)!.seat !== d.seat) remove(id);
        }
        for (const p of people) {
          const spot = plan.get(p.id);
          if (!spot) continue;
          const d = desks.get(p.id);
          if (d) apply(p, d, false);
          else void add(p, spot.seat, spot.look);
        }
      };

      sync(useStudio.getState().floor);
      let lastSelected = useStudio.getState().selectedPersonId;
      cleanups.push(useStudio.subscribe((s, prev) => {
        if (s.floor !== prev.floor) sync(s.floor);
        if (s.selectedPersonId !== lastSelected) {
          lastSelected = s.selectedPersonId;
          const d = s.selectedPersonId ? desks.get(s.selectedPersonId) : undefined;
          if (d) { const pos = d.character.getPixelPosition(); camera.nudgeToward(pos.x, pos.y); }
        }
      }));

      // Two neighbours' clouds would cover each other: stack the overlapping
      // ones upward, as the agent floor does (OfficeFloor's
      // resolveBubbleOverlaps), from each cloud's base rect so it is stable
      // frame to frame.
      const unstackClouds = () => {
        const items: Array<{ d: Desk; x: number; y: number; w: number; h: number }> = [];
        for (const d of desks.values()) {
          const lay = d.character.getThoughtLayout();
          if (lay) items.push({ d, ...lay });
        }
        items.sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x);
        const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
        for (const it of items) {
          let y = it.y;
          let moved = true, guard = 0;
          while (moved && guard++ < 12) {
            moved = false;
            for (const p of placed) {
              if (it.x < p.x + p.w + 2 && it.x + it.w + 2 > p.x && y < p.y + p.h + 2 && y + it.h + 2 > p.y) {
                y = p.y - it.h - 2; moved = true;
              }
            }
          }
          placed.push({ x: it.x, y, w: it.w, h: it.h });
          it.d.character.setThoughtLift(it.y - y);
        }
      };

      const onTick = (ticker: Ticker) => {
        const dt = ticker.deltaMS / 1000;
        camera.update(dt);
        const zoom = world.scale.x;
        for (const d of desks.values()) {
          d.character.setBubbleZoom(zoom);
          d.character.update(dt);
          d.screen?.update(dt);
        }
        unstackClouds();
      };
      app.ticker.add(onTick);
      if (pausedRef.current) app.ticker.stop();

      const resize = new ResizeObserver((entries) => {
        for (const e of entries) {
          const { width, height } = e.contentRect;
          if (width === 0 || height === 0) continue;
          app.renderer?.resize(width, height);
          camera.setViewSize(width, height);
        }
      });
      resize.observe(host);
      cleanups.push(() => resize.disconnect());
      cleanups.push(() => { for (const id of Array.from(desks.keys())) remove(id); });
    };

    init().catch((err) => {
      if (mountIdRef.current !== mountId) return;
      console.error('[StudioFloor] init failed:', err);
      const note = document.createElement('div');
      note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;color:#ffd0b5;font-family:monospace;font-size:13px;text-align:center;white-space:pre-wrap;';
      note.textContent = 'The studio floor could not start.\n' + (err?.message || String(err));
      host.appendChild(note);
    });

    return () => {
      mountIdRef.current++;
      for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* noop */ } }
      const a = appRef.current;
      if (a) safeDestroy(a);
      appRef.current = null;
      while (host.firstChild) host.removeChild(host.firstChild);
    };
  }, [officeTheme]);

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%', height: '100%',
        boxShadow: 'var(--cth-panel-border)',
        overflow: 'hidden',
        imageRendering: 'pixelated',
        background: '#' + colors.ink[900].toString(16).padStart(6, '0')
      }}
    />
  );
}

function safeDestroy(app: Application) {
  try { app.ticker?.stop(); } catch { /* noop */ }
  try { app.destroy(true, { children: true }); } catch { /* noop */ }
}

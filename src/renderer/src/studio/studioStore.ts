/** mOffice: the studio floor's renderer state.
 *
 *  Kept apart from the agent store on purpose. The people on this floor are a
 *  real team read from mDashboard, not agents: they have no PTY, no mailbox and
 *  no roster entry, and nothing that routes, persists or restarts agents may
 *  ever see them. A separate store makes that structural rather than a flag
 *  every agent code path would have to remember to check.
 *
 *  The link itself (sign-in, token, fetch) lives in main; see
 *  src/shared/mdashboard.ts. */
import { create } from 'zustand';
import type { FloorResult, LinkStatus, StudioFloor } from '@shared/mdashboard';

export type FloorMode = 'agents' | 'studio';
export type StudioTab = 'team' | 'projects' | 'activity';

const MODE_KEY = 'mo.floorMode';

function readMode(): FloorMode {
  try { return window.localStorage.getItem(MODE_KEY) === 'studio' ? 'studio' : 'agents'; } catch { return 'agents'; }
}

interface StudioState {
  mode: FloorMode;
  setMode: (mode: FloorMode) => void;

  link: LinkStatus | null;
  setLink: (link: LinkStatus) => void;

  floor: StudioFloor | null;
  /** Why the last read failed, in words for the panel. Cleared on success. */
  error: string | null;
  reason: Extract<FloorResult, { ok: false }>['reason'] | null;
  fetchedAt: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
  clearFloor: () => void;

  selectedPersonId: string | null;
  selectPerson: (id: string | null) => void;

  tab: StudioTab;
  setTab: (tab: StudioTab) => void;
}

export const useStudio = create<StudioState>((set, get) => ({
  mode: readMode(),
  setMode: (mode) => {
    try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* per-viewer nicety only */ }
    set({ mode });
  },

  link: null,
  setLink: (link) => {
    set({ link });
    if (link.state === 'signed-out') get().clearFloor();
  },

  floor: null,
  error: null,
  reason: null,
  fetchedAt: null,
  loading: false,
  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const r = await window.cth.mdashboardFloor();
      if (r.ok) {
        const sel = get().selectedPersonId;
        set({
          floor: r.floor, error: null, reason: null, fetchedAt: Date.now(),
          // Someone who left the team since the last read is not selectable.
          selectedPersonId: sel && r.floor.people.some((p) => p.id === sel) ? sel : null
        });
      } else {
        // Keep the last good floor on a network blip, so a dropped Wi-Fi does
        // not empty the office; drop it when the answer is about the account.
        const keep = r.reason === 'unreachable';
        set({ error: r.error, reason: r.reason, ...(keep ? {} : { floor: null, selectedPersonId: null }) });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), reason: 'unreachable' });
    } finally {
      set({ loading: false });
    }
  },
  clearFloor: () => set({ floor: null, error: null, reason: null, fetchedAt: null, selectedPersonId: null }),

  selectedPersonId: null,
  selectPerson: (id) => set({ selectedPersonId: id }),

  tab: 'team',
  setTab: (tab) => set({ tab })
}));

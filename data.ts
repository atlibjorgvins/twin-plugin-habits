// Habits — data (the `habits` build-time plugin, docs/phase4-plugins.md).
// Relocated from src/lib/data/habits.ts (now a re-export shim). Self-contained:
// Habit/HabitEntry/HabitKind are defined here, no core-entity dependency.
// Daily habits — the first domain module split out of directus.ts.
//
// Chosen to go first because it is a leaf: it needs the client and nothing
// else, no other domain's types, and nothing else in the codebase needs it.
// Person is referenced 116 times inside directus.ts and Organization 59, so
// the core entities have to move last, once the leaves are already out.
//
// Public surface is unchanged: directus.ts re-exports everything here, so all
// existing `from '$lib/directus'` imports keep working.
import { repo } from '$lib/data/repo';
import type { Filter, Query } from '$lib/data/repo';

// ── Habits ────────────────────────────────────────────────────────────────
// Daily habits ("Pushups" 50 reps, "Glass of water" 8×, "Meditate" as a
// plain check). One habit_entry row per habit per day, upserted on
// (habit_id, entry_date). Streaks are derived from entries at read time —
// nothing stored, nothing to drift.

export type HabitKind = 'check' | 'count';

export type Habit = {
  id: number;
  name?: string | null;
  kind?: HabitKind | string | null;
  /** Daily target for count habits; null for checks. */
  target?: number | null;
  /** Amount one tap adds for count habits — a set of 20 pushups is one
   *  tap, water stays 1. Null/absent behaves as 1. */
  step?: number | null;
  unit?: string | null;
  icon?: string | null;
  color?: string | null;
  sort?: number | null;
  scope?: 'work' | 'private' | 'both' | null;
  status?: string;
  date_created?: string | null;
};

export type HabitEntry = {
  id: number;
  habit_id?: number | Habit | null;
  entry_date?: string | null;
  /** Count for the day; 1 = ticked for check habits. */
  value?: number | null;
  /** Snapshot of the habit's target on this day — keeps history
   *  answerable after the habit's target later changes. */
  target?: number | null;
  date_created?: string | null;
};

/** Local YYYY-MM-DD — habit days are local, never UTC-shifted. */
export function habitDayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** How much one tap adds. Checks are always 1; counts use their step. */
export function habitStepOf(h: Habit): number {
  if ((h.kind ?? 'check') === 'count') return Math.max(1, h.step ?? 1);
  return 1;
}

/** A day counts as "done" once the target is met (checks target 1). */
export function habitTargetOf(h: Habit): number {
  if ((h.kind ?? 'check') === 'count') return Math.max(1, h.target ?? 1);
  return 1;
}

export async function listHabits(opts: { includeArchived?: boolean } = {}): Promise<Habit[]> {
  // Omit `where` entirely when unfiltered — the neutral port reads "all" from
  // an absent filter, the same intent the old `limit: -1` carried.
  const query: Query = { fields: ['*'], sort: ['sort', 'id'] };
  if (!opts.includeArchived) query.where = { field: 'status', op: 'neq', value: 'archived' };
  return repo.list<Habit>('habit', query);
}

export async function createHabit(patch: Partial<Habit>): Promise<Habit> {
  return repo.create<Habit>('habit', { status: 'published', scope: 'private', ...patch });
}

export async function updateHabit(id: number, patch: Partial<Habit>): Promise<Habit> {
  return repo.update<Habit>('habit', id, patch as Record<string, unknown>);
}

/** Archive rather than delete, so history survives. */
export async function archiveHabit(id: number): Promise<Habit> {
  return updateHabit(id, { status: 'archived' });
}

/** Entries for a date range (inclusive), oldest first. */
export async function listHabitEntries(fromDay: string, toDay: string): Promise<HabitEntry[]> {
  return repo.list<HabitEntry>('habit_entry', {
    where: {
      and: [
        { field: 'entry_date', op: 'gte', value: fromDay },
        { field: 'entry_date', op: 'lte', value: toDay }
      ]
    },
    fields: ['id', 'habit_id', 'entry_date', 'value', 'target'],
    sort: ['entry_date']
  });
}

/**
 * Set a habit's value for a day — insert or update the single row for
 * (habit_id, entry_date). Clamped at 0. Returns the stored row.
 */
export async function setHabitValue(
  habitId: number,
  day: string,
  value: number,
  /** Target in force on this day — snapshotted on the row so history stays
   *  answerable if the habit's target changes later. */
  target?: number | null
): Promise<HabitEntry> {
  const next = Math.max(0, Math.round(value));
  const existing = await repo.list<{ id: number; target: number | null }>('habit_entry', {
    where: {
      and: [
        { field: 'habit_id', op: 'eq', value: habitId },
        { field: 'entry_date', op: 'eq', value: day }
      ]
    },
    fields: ['id', 'target'],
    limit: 1
  });
  if (existing[0]) {
    // Only fill the snapshot when it's missing — never rewrite history.
    const patch: Record<string, unknown> = { value: next };
    if (existing[0].target == null && target != null) patch.target = target;
    return repo.update<HabitEntry>('habit_entry', existing[0].id, patch);
  }
  return repo.create<HabitEntry>('habit_entry', {
    habit_id: habitId,
    entry_date: day,
    value: next,
    target: target ?? null
  });
}

/** Every entry for one habit, oldest first — the complete dated history.
 *  `sinceDay` trims the window when a full read would be wasteful. */
export async function listHabitHistory(habitId: number, sinceDay?: string): Promise<HabitEntry[]> {
  const and: Filter[] = [{ field: 'habit_id', op: 'eq', value: habitId }];
  if (sinceDay) and.push({ field: 'entry_date', op: 'gte', value: sinceDay });
  return repo.list<HabitEntry>('habit_entry', {
    where: { and },
    fields: ['id', 'entry_date', 'value', 'target'],
    sort: ['entry_date']
  });
}

/** Did this dated entry meet the target that applied on that day? Uses the
 *  entry's own snapshot when present, falling back to the habit's current
 *  target for rows written before snapshots existed. */
export function habitEntryMetTarget(entry: HabitEntry, habit: Habit): boolean {
  const target = entry.target ?? habitTargetOf(habit);
  return (entry.value ?? 0) >= Math.max(1, target);
}

/**
 * Current + best streak from a habit's day→value map.
 *
 * "Partial days count": any progress (value > 0) keeps a streak alive;
 * only an empty day breaks it. Today is never counted as a break — an
 * untouched today just doesn't extend the streak yet.
 */
export function habitStreaks(
  valueByDay: Map<string, number>,
  today: string = habitDayKey()
): { current: number; best: number } {
  const hit = (day: string) => (valueByDay.get(day) ?? 0) > 0;
  const shift = (day: string, days: number) => {
    const [y, m, d] = day.split('-').map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    dt.setDate(dt.getDate() + days);
    return habitDayKey(dt);
  };

  // Current: walk back from today (or yesterday when today is untouched).
  let current = 0;
  let cursor = hit(today) ? today : shift(today, -1);
  while (hit(cursor)) {
    current++;
    cursor = shift(cursor, -1);
  }

  // Best: longest consecutive run across every recorded day.
  const days = [...valueByDay.entries()].filter(([, v]) => v > 0).map(([k]) => k).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of days) {
    run = prev && shift(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  return { current, best: Math.max(best, current) };
}

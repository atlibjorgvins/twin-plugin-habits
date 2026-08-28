<script lang="ts">
  // Habit history + management. The Today card is for logging; this is for
  // looking back and editing.
  //
  // Each habit gets a dot grid of the last 10 weeks — one dot per day,
  // shaded empty / partial / met — plus current and best streak and a
  // total. "Met" uses the entry's own target snapshot, so a day is judged
  // against the target that applied then, not today's.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import {
    listHabits,
    listHabitEntries,
    updateHabit,
    archiveHabit,
    habitDayKey,
    habitTargetOf,
    habitStepOf,
    habitStreaks,
    habitEntryMetTarget,
    formatError,
    type Habit,
    type HabitEntry
  } from '$lib/directus';

  const DAYS = 70; // 10 weeks
  const today = habitDayKey();
  const windowStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - (DAYS - 1));
    return habitDayKey(d);
  })();

  /** Oldest→newest list of the days in the grid. */
  const gridDays = (() => {
    const out: string[] = [];
    const d = new Date();
    d.setDate(d.getDate() - (DAYS - 1));
    for (let i = 0; i < DAYS; i++) {
      out.push(habitDayKey(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  })();

  let habits = $state<Habit[]>([]);
  let entries = $state<HabitEntry[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let showArchived = $state(false);

  const idOf = (v: number | Habit | null | undefined): number | null =>
    v == null ? null : typeof v === 'object' ? (v.id ?? null) : v;

  /** habitId → day → entry */
  const byHabit = $derived.by(() => {
    const m = new Map<number, Map<string, HabitEntry>>();
    for (const e of entries) {
      const hid = idOf(e.habit_id);
      if (hid == null || !e.entry_date) continue;
      (m.get(hid) ?? m.set(hid, new Map()).get(hid)!).set(e.entry_date, e);
    }
    return m;
  });

  const visible = $derived(habits.filter((h) => showArchived || h.status !== 'archived'));

  async function load() {
    try {
      const [hs, es] = await Promise.all([
        listHabits({ includeArchived: true }),
        listHabitEntries(windowStart, today)
      ]);
      habits = hs;
      entries = es;
    } catch (e) {
      error = formatError(e);
    } finally {
      loaded = true;
    }
  }
  onMount(load);

  function valuesOf(h: Habit): Map<string, number> {
    const days = byHabit.get(h.id);
    const m = new Map<string, number>();
    if (days) for (const [day, e] of days) m.set(day, e.value ?? 0);
    return m;
  }
  function statsOf(h: Habit) {
    const days = byHabit.get(h.id) ?? new Map<string, HabitEntry>();
    const { current, best } = habitStreaks(valuesOf(h), today);
    let met = 0;
    let total = 0;
    for (const e of days.values()) {
      if (habitEntryMetTarget(e, h)) met++;
      total += e.value ?? 0;
    }
    return { current, best, met, total };
  }
  /** 0 = no entry, 1 = partial, 2 = met the day's target. */
  function levelOf(h: Habit, day: string): 0 | 1 | 2 {
    const e = byHabit.get(h.id)?.get(day);
    if (!e || (e.value ?? 0) <= 0) return 0;
    return habitEntryMetTarget(e, h) ? 2 : 1;
  }
  function dotTitle(h: Habit, day: string): string {
    const e = byHabit.get(h.id)?.get(day);
    const target = e?.target ?? habitTargetOf(h);
    if (!e || (e.value ?? 0) <= 0) return `${day} — nothing logged`;
    if ((h.kind ?? 'check') === 'count') return `${day} — ${e.value}/${target}${h.unit ? ` ${h.unit}` : ''}`;
    return `${day} — done`;
  }

  // ── Inline edit ─────────────────────────────────────────────────
  let editingId = $state<number | null>(null);
  let editName = $state('');
  let editTarget = $state('');
  let editUnit = $state('');
  let editStep = $state('');
  let saving = $state(false);

  function openEdit(h: Habit) {
    editingId = h.id;
    editName = h.name ?? '';
    editTarget = h.target != null ? String(h.target) : '';
    editUnit = h.unit ?? '';
    editStep = String(habitStepOf(h));
    error = '';
  }
  async function saveEdit(h: Habit) {
    saving = true;
    error = '';
    try {
      const patch: Partial<Habit> = { name: editName.trim() || h.name };
      if ((h.kind ?? 'check') === 'count') {
        patch.target = Math.max(1, Number(editTarget) || habitTargetOf(h));
        patch.step = Math.max(1, Number(editStep) || habitStepOf(h));
        patch.unit = editUnit.trim() || null;
      }
      const updated = await updateHabit(h.id, patch);
      habits = habits.map((x) => (x.id === h.id ? { ...x, ...updated } : x));
      editingId = null;
    } catch (e) {
      error = formatError(e);
    } finally {
      saving = false;
    }
  }
  async function doArchive(h: Habit) {
    if (!confirm(`Archive "${h.name}"? Its history is kept.`)) return;
    try {
      await archiveHabit(h.id);
      habits = habits.map((x) => (x.id === h.id ? { ...x, status: 'archived' } : x));
    } catch (e) {
      error = formatError(e);
    }
  }
  async function unarchive(h: Habit) {
    try {
      await updateHabit(h.id, { status: 'published' });
      habits = habits.map((x) => (x.id === h.id ? { ...x, status: 'published' } : x));
    } catch (e) {
      error = formatError(e);
    }
  }
</script>

<svelte:head><title>Habits · Hub</title></svelte:head>

<section class="space-y-6">
  <header>
    <div class="hero-eyebrow">Tools</div>
    <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">Habits</h1>
    <p class="mt-1 text-sm text-ink-500">
      The last 10 weeks, one dot per day. Log from the Today card; edit and look back here.
    </p>
  </header>

  {#if error}
    <p class="text-xs" style="color: #C0392B;">{error}</p>
  {/if}

  {#if loaded && visible.length === 0}
    <div class="card p-4 text-sm text-ink-400">
      No habits yet. Add one from the Habits card on Today.
    </div>
  {/if}

  {#each visible as h (h.id)}
    {@const s = statsOf(h)}
    {@const archived = h.status === 'archived'}
    <div class="card p-4 space-y-3" style:opacity={archived ? 0.6 : 1}>
      <div class="flex items-start gap-3">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style="background: {h.color ?? 'var(--bg-tertiary)'}; color: {h.color ? '#fff' : 'var(--text-secondary)'};">
          <Icon name={(h.icon as IconName) ?? 'check'} size={16} />
        </span>
        <div class="min-w-0 flex-1">
          {#if editingId === h.id}
            <input class="input w-full text-sm" bind:value={editName}
                   onkeydown={(e) => { if (e.key === 'Enter') saveEdit(h); }} />
            {#if (h.kind ?? 'check') === 'count'}
              <div class="mt-2 flex flex-wrap gap-2">
                <input class="input w-24 text-sm" type="number" min="1" placeholder="Target" bind:value={editTarget} />
                <input class="input w-24 text-sm" type="number" min="1" placeholder="Per tap" title="Amount added per tap" bind:value={editStep} />
                <input class="input flex-1 text-sm" placeholder="Unit" bind:value={editUnit} />
              </div>
              <p class="mt-1 text-[10px] text-ink-400">
                Changing the target only affects future days — past days keep the target they were logged against.
              </p>
            {/if}
            <div class="mt-2 flex items-center gap-2">
              <button class="btn-ghost text-xs" onclick={() => (editingId = null)} disabled={saving}>Cancel</button>
              <button class="btn-primary text-xs" onclick={() => saveEdit(h)} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          {:else}
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-ink-900">{h.name}</span>
              {#if (h.kind ?? 'check') === 'count'}
                <span class="text-xs text-ink-400">
                  {habitTargetOf(h)}{h.unit ? ` ${h.unit}` : ''} / day{habitStepOf(h) > 1 ? ` · +${habitStepOf(h)} per tap` : ''}
                </span>
              {:else}
                <span class="text-xs text-ink-400">daily check</span>
              {/if}
              {#if archived}
                <span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                      style="background: var(--bg-tertiary); color: var(--text-secondary);">archived</span>
              {/if}
            </div>
            <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500 tabular-nums">
              <span><span class="font-medium text-ink-900">{s.current}</span> day streak</span>
              <span>best <span class="font-medium text-ink-900">{s.best}</span></span>
              <span><span class="font-medium text-ink-900">{s.met}</span> days hit</span>
              {#if (h.kind ?? 'check') === 'count'}
                <span>{s.total} {h.unit ?? 'total'}</span>
              {/if}
            </div>
          {/if}
        </div>
        {#if editingId !== h.id}
          <div class="flex shrink-0 items-center gap-1">
            <button class="cursor-pointer rounded-full p-1.5 text-ink-400 transition hover:bg-surface-hover hover:text-ink-900"
                    title="Edit habit" aria-label="Edit {h.name}" onclick={() => openEdit(h)}>
              <Icon name="pencil" size={14} />
            </button>
            {#if archived}
              <button class="cursor-pointer rounded-full p-1.5 text-ink-400 transition hover:bg-surface-hover hover:text-ink-900"
                      title="Restore habit" aria-label="Restore {h.name}" onclick={() => unarchive(h)}>
                <Icon name="arrow-right" size={14} />
              </button>
            {:else}
              <button class="cursor-pointer rounded-full p-1.5 text-ink-400 transition hover:bg-surface-hover hover:text-tag-salesText"
                      title="Archive habit (history kept)" aria-label="Archive {h.name}" onclick={() => doArchive(h)}>
                <Icon name="tag" size={14} />
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Dot grid: 10 columns of 7 days, oldest at the left. -->
      <div class="flex flex-wrap gap-1" role="img" aria-label="Last {DAYS} days of {h.name}">
        {#each gridDays as day (day)}
          {@const lvl = levelOf(h, day)}
          <span
            class="h-3.5 w-3.5 rounded-[3px] border"
            style="
              background: {lvl === 2 ? (h.color ?? 'var(--accent-electric)') : lvl === 1 ? (h.color ?? 'var(--accent-electric)') : 'transparent'};
              opacity: {lvl === 2 ? 1 : lvl === 1 ? 0.4 : 1};
              border-color: {lvl === 0 ? 'var(--border-subtle)' : 'transparent'};
            "
            title={dotTitle(h, day)}
          ></span>
        {/each}
      </div>
      <div class="flex items-center gap-3 text-[10px] text-ink-400">
        <span class="flex items-center gap-1">
          <span class="h-2.5 w-2.5 rounded-[2px] border" style="border-color: var(--border-subtle);"></span> none
        </span>
        <span class="flex items-center gap-1">
          <span class="h-2.5 w-2.5 rounded-[2px]" style="background: {h.color ?? 'var(--accent-electric)'}; opacity: 0.4;"></span> partial
        </span>
        <span class="flex items-center gap-1">
          <span class="h-2.5 w-2.5 rounded-[2px]" style="background: {h.color ?? 'var(--accent-electric)'};"></span> hit target
        </span>
        <span class="ml-auto">{windowStart} → {today}</span>
      </div>
    </div>
  {/each}

  {#if loaded && habits.some((h) => h.status === 'archived')}
    <button class="btn-ghost text-xs" onclick={() => (showArchived = !showArchived)}>
      {showArchived ? 'Hide' : 'Show'} archived
    </button>
  {/if}
</section>

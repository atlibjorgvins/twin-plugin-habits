// Habits — a self-contained public plugin: its own route + data + types, no
// dependency on the contacts core. docs/phase4-plugins.md.
import type { PluginManifest } from '../types';

export const habits: PluginManifest = {
  id: 'habits',
  category: 'Productivity',
  label: 'Habits',
  description: 'Daily habit tracking with streaks. The first route-owning reference plugin.',
  tier: 'public',
  routes: ['/tools/habits'],
  collections: ['habit', 'habit_entry']
};

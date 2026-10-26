/**
 * Fun apps registry (spec §15.4: "build it as a self-contained module so more fun apps can be added").
 * Each entry is a phone app with zero link to gold, the market or scoring. `onLockScreen` apps are
 * also playable on the pause lock screen.
 */
import type { Component } from 'svelte';
import type { PublicState } from '@shared/types';
import Minter from './minter/Minter.svelte';

export interface FunApp {
  id: string;
  icon: string;
  component: Component<{ s: PublicState }>;
  onLockScreen: boolean;
}

export const FUN_APPS: FunApp[] = [{ id: 'minter', icon: '◆', component: Minter, onLockScreen: true }];

<script lang="ts">
  /** The Messages app: player chats and the inbox (tips, gifts, memos, Compliance notes) behind two tabs. */
  import { untrack } from 'svelte';
  import { t } from '@shared/copy';
  import type { PlayerState } from '@shared/types';
  import Chat from './Chat.svelte';
  import Messages from './Messages.svelte';

  let { s, inboxUnread, chatUnread }: { s: PlayerState; inboxUnread: number; chatUnread: number } = $props();

  // Open on the tab that has something new; Chats wins a tie.
  let tab = $state<'chats' | 'inbox'>(untrack(() => (inboxUnread > 0 && chatUnread === 0 ? 'inbox' : 'chats')));
</script>

<div style="display:flex;flex-direction:column;height:100%;min-height:0;gap:0.5rem">
  <div class="row" role="tablist" style="flex:none">
    <button class="chip" class:on={tab === 'chats'} role="tab" aria-selected={tab === 'chats'} onclick={() => (tab = 'chats')}>
      {t('phone.messages_tab_chats')}{#if chatUnread} <span class="badge-count">{chatUnread}</span>{/if}
    </button>
    <button class="chip" class:on={tab === 'inbox'} role="tab" aria-selected={tab === 'inbox'} onclick={() => (tab = 'inbox')}>
      {t('phone.messages_tab_inbox')}{#if inboxUnread} <span class="badge-count">{inboxUnread}</span>{/if}
    </button>
  </div>
  <div style="flex:1;min-height:0;overflow:auto">
    {#if tab === 'chats'}<Chat {s} />{:else}<Messages {s} />{/if}
  </div>
</div>

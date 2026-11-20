// The deny rules for a mail connector in the agent harness (the bridge mail adapter): every tool of
// the connector except its reads. A connector's own tool catalog can include send, reply, forward,
// trash and label tools, so the guard keeps an allow-list of reads and denies the rest: the catalog's
// known write tools, plus every live tool the harness lists that is not a read (a tool added later
// is denied, never kept). Rules go into .claude/settings.local.json `permissions.deny`, where a deny
// beats any allow.

export const CONNECTORS = {
  gmail: {
    // claude.ai connectors appear in Claude Code as mcp__claude_ai_<Name>__<tool>.
    server: 'claude_ai_Gmail',
    read: ['search_threads', 'get_message', 'get_thread'],
    write: [
      'apply_sensitive_message_label', 'apply_sensitive_thread_label', 'create_draft', 'create_filter',
      'create_label', 'delete_label', 'forward', 'label_message', 'label_thread', 'list_drafts',
      'list_filters', 'list_labels', 'mark_message_spam', 'mark_thread_spam', 'reply', 'send_message',
      'trash_message', 'trash_thread', 'unlabel_message', 'unlabel_thread', 'unmark_message_spam',
    ],
  },
};

// { kept, deny, unknown }: full tool names. `tools` is the live list the harness shows (short or full
// names); without it, the catalog alone decides. Throws on an unknown connector, a tool of another
// server, or a live list with none of the read tools (the names changed: nothing is guessed).
export function guardRules({ connector, server, tools = [] }) {
  const c = CONNECTORS[connector];
  if (!c) throw new Error(`unknown connector "${connector}": known ${Object.keys(CONNECTORS).join(', ')}`);
  const prefix = `mcp__${server || c.server}__`;
  const full = (t) => {
    if (t.startsWith('mcp__') && !t.startsWith(prefix)) throw new Error(`${t} belongs to another server than ${prefix}`);
    return t.startsWith(prefix) ? t : `${prefix}${t}`;
  };
  const reads = new Set(c.read.map(full));
  const live = [...new Set(tools.map((t) => full(String(t).trim())).filter((t) => t !== prefix))];
  if (live.length && !live.some((t) => reads.has(t))) throw new Error(`no read tool in the live list (expected ${c.read.join(', ')}): the connector's tool names changed; deny nothing until they are checked`);
  const known = new Set(c.write.map(full));
  const unknown = live.filter((t) => !reads.has(t) && !known.has(t));
  const deny = [...new Set([...known, ...live.filter((t) => !reads.has(t))])];
  const kept = live.length ? live.filter((t) => reads.has(t)) : [...reads];
  return { kept, deny, unknown };
}

// A copy of the settings with the rules added to permissions.deny, each once; nothing else changes.
export function mergeDeny(cfg, rules) {
  const out = structuredClone(cfg || {});
  out.permissions = out.permissions || {};
  out.permissions.deny = [...new Set([...(out.permissions.deny || []), ...rules])];
  return out;
}

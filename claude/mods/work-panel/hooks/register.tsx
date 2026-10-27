import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, FileStat, Note, Todo } from '../types'

const PANE = 'work-panel'
const TITLE = 'Session'
const COLUMNS = 44

const files = atom({ plugin: 'work-panel', key: 'files' } as const, [])
const stats = atom({ plugin: 'work-panel', key: 'stats' } as const, [])
const agents = atom({ plugin: 'work-panel', key: 'agents' } as const, [])
const todos = atom({ plugin: 'work-panel', key: 'todos' } as const, [])
const selected = atom({ plugin: 'work-panel', key: 'selected' } as const, null)
const notes = atom({ plugin: 'work-panel', key: 'notes' } as const, [])
const draft = atom({ plugin: 'work-panel', key: 'draft' } as const, '')
const todoMode = atom({ plugin: 'work-panel', key: 'todoMode' } as const, false)

const NOTES_TOOL = 'notes_done'
const TODO_TOOL = 'todo_write'
const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed'])
const TODO_MODE_PROMPT = [
  '# Todo mode',
  `Todo mode is on: the user follows this session's work in the TODO section of the work panel. Keep it complete with mcp__work-panel__${TODO_TOOL}, which replaces the whole list each call.`,
  '- Before starting any request, write every step you will do as a todo, and add follow-ups and pending work as you find them.',
  '- Keep exactly one todo in_progress while working; mark each completed as soon as it is done, never in a batch.',
  "- Keep earlier requests' todos in the list; drop an item only when it no longer applies.",
].join('\n')

// Persisted across sessions in $.store; the atom is what the pane reads.
async function setTodoMode($: EngineInterface, isOn: boolean) {
  await $.store.set('todoMode', isOn)
  await update($, todoMode, () => isOn)
}
// ponytail: module flag, false after a reload mid-turn; prompt.submit waits for idle anyway.
let isBusy = false

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAX_STEPS = 30

const dirOf = (p: string) => p.slice(0, Math.max(1, p.lastIndexOf('/')))
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function editedPath(input: Record<string, unknown>): string | undefined {
  const p = input.file_path ?? input.notebook_path
  return typeof p === 'string' ? p : undefined
}

function stepLabel(tool: string, input: Record<string, unknown>): string {
  const arg = [input.file_path, input.command, input.pattern, input.description, input.url, input.query, input.prompt]
    .find(v => typeof v === 'string') as string | undefined
  const shown = arg && arg.startsWith('/') ? baseOf(arg) : arg
  return shown ? `${tool} ${clip(shown.replace(/\s+/g, ' '), 60)}` : tool
}

function numstat(out: string): { added: number; removed: number } | undefined {
  const line = out.trim().split('\n')[0]
  if (!line) return undefined
  const [a, r] = line.split('\t')
  // ponytail: binary files report "-"; counted as 0.
  return { added: Number(a) || 0, removed: Number(r) || 0 }
}

// ponytail: one git call per file; batch per repo if sessions edit hundreds of files.
async function statOf($: EngineInterface, path: string): Promise<FileStat | undefined> {
  const cwd = dirOf(path)
  const tracked = await $.process.run(['git', 'diff', '--numstat', 'HEAD', '--', path], { cwd }).catch(() => undefined)
  const t = tracked && tracked.exitCode === 0 ? numstat(tracked.stdout) : undefined
  if (t) return { path, ...t }
  const known = await $.process.run(['git', 'ls-files', '--error-unmatch', '--', path], { cwd }).catch(() => undefined)
  if (known && known.exitCode === 0) return undefined // tracked and unchanged: edits were reverted
  const fresh = await $.process.run(['git', 'diff', '--no-index', '--numstat', '/dev/null', path], { cwd }).catch(() => undefined)
  const f = fresh ? numstat(fresh.stdout) : undefined
  return f ? { path, ...f } : { path, added: 0, removed: 0 }
}

async function refreshStats($: EngineInterface) {
  const list = await read($, files)
  const rows = (await Promise.all(list.map(p => statOf($, p)))).filter((r): r is FileStat => r !== undefined)
  await update($, stats, () => rows)
}

async function refreshAgents($: EngineInterface) {
  const live = await $.agent.list().catch(() => [])
  const byId = new Map(live.map(a => [a.id, a.status as string]))
  await update($, agents, list => list.map(a => (byId.has(a.id) ? { ...a, status: byId.get(a.id)! } : a)))
}

// Hands every note not yet sent to the model as a turn of its own, once the session is idle.
async function deliverNotes($: EngineInterface) {
  const pending = (await read($, notes)).filter(n => !n.isSent)
  if (pending.length === 0) return
  const ids = new Set(pending.map(n => n.id))
  await update($, notes, list => list.map(n => (ids.has(n.id) ? { ...n, isSent: true } : n)))
  void $.prompt.submit({
    text: [
      'Notes the user left for you in the work panel, to handle now that your previous work is finished:',
      ...pending.map(n => `- [${n.id}] ${n.text}`),
      '',
      `Implement each note or take it into account. As soon as a note is handled, call mcp__work-panel__${NOTES_TOOL} with its id to delete it from the panel.`,
    ].join('\n'),
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'work-panel', description: 'Open the session work panel' })
    await $.tool.register({
      name: NOTES_TOOL,
      description: 'Delete notes from the work panel once you have implemented them or taken them into account.',
      inputSchema: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' }, description: 'The note ids, as shown in brackets.' } },
        required: ['ids'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: TODO_TOOL,
      description:
        "Replace the session todo list shown in the work panel's TODO section. Send the full list every call; statuses: pending, in_progress, completed.",
      inputSchema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'todo-mode', description: 'Toggle todo mode: Claude tracks all session work in the work panel' })
    const isTodoMode = (await $.store.get('todoMode')) === true
    await update($, todoMode, () => isTodoMode)
    void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    return r
  })

  on('command.run', { command: 'work-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    return { text: 'Work panel opened.' }
  })

  on('command.run', { command: 'todo-mode' }, async $ => {
    const isOn = !(await read($, todoMode))
    await setTodoMode($, isOn)
    return { text: `Todo mode ${isOn ? 'on' : 'off'}.` }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, todoMode))) return r
    return { sections: [...r.sections, { id: 'work-panel:todo-mode', text: TODO_MODE_PROMPT, scope: 'session' }] }
  })

  on('tool.call', { tool: `mcp__work-panel__${TODO_TOOL}` }, async ($, e) => {
    const raw = (e as unknown as { todos?: unknown }).todos
    if (!Array.isArray(raw)) return { result: 'todos must be an array.', isError: true }
    const list = raw.flatMap((t, i): Todo[] =>
      t && typeof t.content === 'string' && TODO_STATUSES.has(t.status)
        ? [{ id: `m${i}`, content: t.content, status: t.status }]
        : [],
    )
    await update($, todos, () => list)
    const done = list.filter(t => t.status === 'completed').length
    return { result: `Todo list updated: ${done}/${list.length} completed.` }
  })

  on('tool.call', { tool: `mcp__work-panel__${NOTES_TOOL}` }, async ($, e) => {
    const ids = new Set(((e as unknown as { ids?: unknown }).ids as string[] | undefined) ?? [])
    const before = (await read($, notes)).length
    await update($, notes, list => list.filter(n => !ids.has(n.id)))
    const left = (await read($, notes)).length
    return { result: `Deleted ${before - left} note(s); ${left} left.` }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) isBusy = true
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const row: AgentRow = {
        id: r.agentId,
        description: e.description,
        type: e.subagentType,
        prompt: e.prompt,
        status: 'running',
        steps: [],
      }
      await update($, agents, list => [...list.filter(a => a.id !== row.id), row].slice(-50))
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    if (e.agentId) {
      const step = stepLabel(e.tool, input)
      await update($, agents, list =>
        list.map(a => (a.id === e.agentId ? { ...a, steps: [...a.steps, step].slice(-MAX_STEPS) } : a)),
      )
    }

    const ran = await next(e)
    const isOk = ran.deny === undefined && ran.isError !== true

    const path = EDIT_TOOLS.has(e.tool) ? editedPath(input) : undefined
    if (isOk && path) {
      await update($, files, list => (list.includes(path) ? list : [...list, path]))
      await refreshStats($)
    }

    if (isOk && e.tool === 'TodoWrite') {
      const list = (input.todos as { content: string; status: Todo['status'] }[]) ?? []
      await update($, todos, () => list.map((t, i): Todo => ({ id: `w${i}`, content: t.content, status: t.status })))
    }

    if (isOk && e.tool === 'TaskCreate') {
      const task = (ran.result as { task?: { id: string; subject: string } }).task
      if (task) await update($, todos, (list): Todo[] => [...list, { id: task.id, content: task.subject, status: 'pending' }])
    }

    if (isOk && e.tool === 'TaskUpdate') {
      const id = String(input.taskId)
      const status = input.status as Todo['status'] | 'deleted' | undefined
      const subject = input.subject as string | undefined
      await update($, todos, list =>
        status === 'deleted'
          ? list.filter(t => t.id !== id)
          : list.map((t): Todo => (t.id === id ? { ...t, status: status ?? t.status, content: subject ?? t.content } : t)),
      )
    }

    if (e.tool === 'Agent' || e.tool === 'TaskStop') await refreshAgents($)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    await refreshAgents($)
    await refreshStats($)
    const r = await next(e)
    if (!e.agentId) {
      isBusy = false
      // An interrupted turn means the user took over: notes wait for the next answer.
      if (e.reason === 'answer') await deliverNotes($)
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const [rows, list, items, open, memo, typed, isTodoMode] = await Promise.all([
      read($, stats), read($, agents), read($, todos), read($, selected), read($, notes), read($, draft), read($, todoMode),
    ])
    const width = Math.max(24, e.props.bodyColumns ?? COLUMNS)

    // ponytail: the rule is sized by hand; a flex-grown rule squeezes the label until it wraps.
    const inner = width - 2
    const heading = (label: string, count: string) => {
      const rule = Math.max(2, inner - label.length - count.length - (count ? 2 : 1))
      return (
        <Box marginTop={1}>
          <Text wrap="truncate-end">
            <Text color="claude" weight="bold">{label}</Text>
            <Text color="subtle"> {'─'.repeat(rule)}</Text>
            {count ? <Text color="inactive"> {count}</Text> : null}
          </Text>
        </Box>
      )
    }
    const empty = (text: string) => <Text color="inactive" italic>  {text}</Text>

    // Changes: name, then a 5-cell +/- bar scaled to the file with most churn.
    const most = Math.max(1, ...rows.map(r => r.added + r.removed))
    const churnBar = (r: FileStat) => {
      const cells = Math.max(1, Math.round(((r.added + r.removed) / most) * 5))
      const plus = r.added + r.removed === 0 ? 0 : Math.round((r.added / (r.added + r.removed)) * cells)
      return (
        <Text>
          <Text color="success">{'■'.repeat(plus)}</Text>
          <Text color="error">{'■'.repeat(cells - plus)}</Text>
          <Text color="subtle">{'·'.repeat(5 - cells)}</Text>
        </Text>
      )
    }
    const totalAdded = rows.reduce((n, r) => n + r.added, 0)
    const totalRemoved = rows.reduce((n, r) => n + r.removed, 0)

    const agentIcon = (s: string) =>
      s === 'completed' ? <Text color="success">✓</Text>
      : s === 'failed' || s === 'killed' ? <Text color="error">✗</Text>
      : s === 'idle' || s === 'waiting' ? <Text color="inactive">◌</Text>
      : <Text color="warning">●</Text>
    const running = list.filter(a => a.status === 'running' || a.status === 'pending').length

    const done = items.filter(t => t.status === 'completed').length
    const bar = Math.max(4, inner - 2)
    const progress = items.length === 0 ? 0 : Math.round((done / items.length) * bar)
    const todoIcon = (s: Todo['status']) =>
      s === 'completed' ? <Text color="success">✓</Text>
      : s === 'in_progress' ? <Text color="warning">▸</Text>
      : <Text color="inactive">○</Text>

    // Docked, the body is at least the pane's height so the spacer can push NOTES to the bottom.
    const fill = e.props.placement === 'dock' ? e.props.scroll.bodyRows : undefined
    return (
      <Box flexDirection="column" paddingX={1} minHeight={fill}>
        {heading('CHANGES', rows.length === 0 ? '' : `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`)}
        {rows.length === 0 ? empty('No files changed yet') : (
          <Box flexDirection="column">
            {rows.map(r => (
              <Box flexDirection="row" key={r.path}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">
                    <Text color="subtle">{clip(baseOf(dirOf(r.path)), 12)}/</Text>
                    <Text weight="bold">{baseOf(r.path)}</Text>
                  </Text>
                </Box>
                <Text color="success"> {`+${r.added}`.padStart(5)}</Text>
                <Text color="error">{`-${r.removed}`.padStart(5)} </Text>
                {churnBar(r)}
              </Box>
            ))}
            <Box flexDirection="row">
              <Box flexGrow={1}>
                <Text color="inactive">total</Text>
              </Box>
              <Text color="success" weight="bold">{`+${totalAdded}`.padStart(6)}</Text>
              <Text color="error" weight="bold">{`-${totalRemoved}`.padStart(5)}</Text>
              <Text>      </Text>
            </Box>
          </Box>
        )}

        {heading('AGENTS', list.length === 0 ? '' : running > 0 ? `${running} running` : `${list.length} done`)}
        {list.length === 0 ? empty('No agents yet') : (
          <Box flexDirection="column">
            {list.map(a => (
              <Box flexDirection="column" key={`a-${a.id}`}>
                <Button key={`agent-${a.id}`} plain onPress={() => update($, selected, cur => (cur === a.id ? null : a.id))}>
                  <Text color="subtle">{open === a.id ? '▾' : '▸'}</Text> {agentIcon(a.status)}{' '}
                  <Text weight="bold">{clip(a.description, width - 8)}</Text>
                </Button>
                <Text wrap="truncate-end">
                  {'    '}
                  <Text color="suggestion">{a.type}</Text>
                  <Text color="inactive"> · {a.steps.at(-1) ?? 'starting…'}</Text>
                </Text>
                {open === a.id ? (
                  <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginLeft={2}>
                    <Text color="claude">Task</Text>
                    <Text>{clip(a.prompt.replace(/\s+/g, ' '), 300)}</Text>
                    <Box marginTop={1}>
                      <Text color="claude">Steps <Text color="inactive">{a.steps.length}</Text></Text>
                    </Box>
                    {a.steps.length === 0 ? empty('none yet') : null}
                    {a.steps.slice(-10).map((s, i) => (
                      <Text wrap="truncate-end">
                        <Text color="subtle">{String(a.steps.length - Math.min(10, a.steps.length) + i + 1).padStart(2)} </Text>
                        <Text color="inactive">{s}</Text>
                      </Text>
                    ))}
                  </Box>
                ) : null}
              </Box>
            ))}
          </Box>
        )}

        {heading('TODO', items.length === 0 ? '' : `${done}/${items.length}`)}
        <Button key="todo-mode" plain onPress={() => setTodoMode($, !isTodoMode)}>
          {'  '}
          <Text color={isTodoMode ? 'success' : 'inactive'}>{isTodoMode ? '◉' : '○'} todo mode</Text>
          <Text color="inactive">{isTodoMode ? ' · Claude tracks every task' : ' · off'}</Text>
        </Button>
        {items.length === 0 ? empty(isTodoMode ? 'Claude writes the list on the next request' : 'No todo list') : (
          <Box flexDirection="column">
            <Text>
              {'  '}
              <Text color="success">{'━'.repeat(progress)}</Text>
              <Text color="subtle">{'━'.repeat(bar - progress)}</Text>
            </Text>
            {items.map(t => (
              <Text wrap="wrap">
                {'  '}{todoIcon(t.status)}{' '}
                <Text
                  color={t.status === 'in_progress' ? 'warning' : undefined}
                  dimColor={t.status === 'completed'}
                  strikethrough={t.status === 'completed'}
                >
                  {t.content}
                </Text>
              </Text>
            ))}
          </Box>
        )}

        <Box flexGrow={1} />
        {heading('NOTES', memo.length === 0 ? '' : `${memo.length}`)}
        {memo.length === 0 ? empty('Notes for Claude, handled after the current work') : (
          <Box flexDirection="column">
            {memo.map(n => (
              <Box flexDirection="row" key={`n-${n.id}`}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="wrap">
                    {'  '}{n.isSent ? <Text color="warning">▸</Text> : <Text color="inactive">○</Text>}{' '}
                    <Text color={n.isSent ? 'warning' : undefined}>{n.text}</Text>
                  </Text>
                </Box>
                <Button key={`note-del-${n.id}`} plain onPress={() => update($, notes, l => l.filter(x => x.id !== n.id))}>
                  <Text color="error">✗</Text>
                </Button>
              </Box>
            ))}
          </Box>
        )}
        {Input ? (
          <Input
            key="note-input"
            placeholder="Add a note…"
            submitLabel="add"
            value={typed}
            onInput={v => void update($, draft, () => v)}
            onSubmit={async v => {
              const text = v.trim()
              await update($, draft, () => '')
              if (!text) return
              const note: Note = { id: Math.random().toString(36).slice(2, 7), text, isSent: false }
              await update($, notes, l => [...l, note])
              if (!isBusy) await deliverNotes($)
            }}
          />
        ) : null}
      </Box>
    )
  })
}

import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'work-panel',
  component: 'Pane',
  requestId: 'work-panel',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SEED: Record<string, unknown> = {
  stats: [{ path: '/repo/lib/app/user.ex', added: 12, removed: 3 }],
  agents: [
    { id: 'a1', description: 'Map auth flow', type: 'Explore', prompt: 'Find every caller of login', status: 'running', steps: ['Grep login', 'Read user.ex'] },
  ],
  todos: [
    { id: '1', content: 'Write the migration', status: 'completed' },
    { id: '2', content: 'Wire the controller', status: 'in_progress' },
  ],
}

test('the panel draws its three sections and expands an agent on click', async ($, on) => {
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    return { value: { value: SEED[key], version: 1 } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /\+12/ }))?.text?.trim()).toBe('+12')
    expect(await ui.find({ type: 'Text', text: /Map auth flow/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Wire the controller/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Find every caller/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('pressing an agent shows its task and steps', async ($, on) => {
  let selected: string | null = null
  let version = 1
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    return { value: { value: key === 'selected' ? selected : SEED[key], version } }
  })
  on('state.set', (_, e) => {
    const x = e as { key: string; value: unknown }
    if (x.key === 'selected') selected = x.value as string | null
    version += 1
    return { value: { isSet: true, version } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'agent-a1' })
  expect(selected).toBe('a1')
  await ui.unmount()

  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: /Find every caller/ })).toBeDefined()
  expect(await again.find({ type: 'Text', text: /Read user\.ex/ })).toBeDefined()
  await again.unmount()
})

test('a note typed in the panel is listed and deleted by the model tool', async ($, on) => {
  const state: Record<string, unknown> = { ...SEED, notes: [], draft: '' }
  let version = 1
  const submitted: string[] = []
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    return { value: { value: state[key], version } }
  })
  on('state.set', (_, e) => {
    const x = e as { key: string; value: unknown }
    state[x.key] = x.value
    version += 1
    return { value: { isSet: true, version } }
  })
  on('prompt.submit', (_, e) => {
    const text = (e as { text: string }).text
    submitted.push(text)
    return { text }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'note-input', text: 'Rename the helper' })
  await ui.unmount()

  const list = state.notes as { id: string; text: string; isSent: boolean }[]
  expect(list.length).toBe(1)
  expect(list[0].text).toBe('Rename the helper')
  expect(submitted.some(t => t.includes('Rename the helper'))).toBe(true)

  await $.tool.call({ tool: 'mcp__work-panel__notes_done', ids: [list[0].id] } as never)
  expect((state.notes as unknown[]).length).toBe(0)
})

test('todo mode: the toggle adds the prompt section and the model tool fills the TODO list', async ($, on) => {
  const state: Record<string, unknown> = { ...SEED, todos: [], todoMode: false }
  const store: Record<string, unknown> = {}
  let version = 1
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    return { value: { value: state[key], version } }
  })
  on('state.set', (_, e) => {
    const x = e as { key: string; value: unknown }
    state[x.key] = x.value
    version += 1
    return { value: { isSet: true, version } }
  })
  on('store.set', (_, e) => {
    const x = e as { key: string; value: unknown }
    store[x.key] = x.value
    return { value: undefined }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))

  const off = await $.prompt.compose(COMPOSE)
  expect(off.sections.some(s => s.id === 'work-panel:todo-mode')).toBe(false)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'todo-mode' })
  await ui.unmount()
  expect(state.todoMode).toBe(true)
  expect(store.todoMode).toBe(true)

  const on_ = await $.prompt.compose(COMPOSE)
  expect(on_.sections.some(s => s.id === 'work-panel:todo-mode')).toBe(true)

  await $.tool.call({
    tool: 'mcp__work-panel__todo_write',
    todos: [
      { content: 'Read the mod', status: 'completed' },
      { content: 'Add todo mode', status: 'in_progress' },
      { content: 'bogus', status: 'nope' },
    ],
  } as never)
  const list = state.todos as { content: string; status: string }[]
  expect(list.map(t => t.content)).toEqual(['Read the mod', 'Add todo mode'])

  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: /Add todo mode/ })).toBeDefined()
  expect(await again.find({ type: 'Text', text: /tracks every task/ })).toBeDefined()
  await again.unmount()
})

const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as never

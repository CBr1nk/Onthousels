import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useNotes } from '../hooks/useNotes'
import type { Theme } from '../hooks/useTheme'
import { countDone, emptyDoc, isBlank, plainText, toggleTaskAt, withoutDone } from '../lib/doc'
import { pinnedTodoId, uuid } from '../lib/id'
import { clearOffline } from '../lib/offline'
import { supabase } from '../lib/supabase'
import type { NoteDraft, NoteMode } from '../lib/types'
import { ChecklistIcon, CloseIcon, MenuIcon, MoonIcon, NotesIcon, PlusIcon, SearchIcon, SunIcon, TextIcon } from './Icons'
import { NoteCard } from './NoteCard'
import type { CloseInfo } from './NoteEditor'
import { PinnedTodo } from './PinnedTodo'
import { Sidebar } from './Sidebar'
import { Toast, type ToastData } from './Toast'

// The editor carries most of the bundle; the collage can show before it arrives.
const loadEditor = () => import('./NoteEditor')
const NoteEditor = lazy(() => loadEditor().then(m => ({ default: m.NoteEditor })))

interface Editing {
  draft: NoteDraft
  isNew: boolean
}

// Which notes the desk shows: everything, only text, or only checklists.
type Kind = 'all' | NoteMode
const KIND_KEY = 'onthousels-kind'
const KINDS = [
  { id: 'all', name: 'All', Icon: NotesIcon },
  { id: 'text', name: 'Text', Icon: TextIcon },
  { id: 'checklist', name: 'Lists', Icon: ChecklistIcon },
] as const

function savedKind(): Kind {
  try {
    const k = localStorage.getItem(KIND_KEY)
    if (k === 'text' || k === 'checklist') return k
  } catch {
    // Storage can be unavailable (private mode); start from everything.
  }
  return 'all'
}

export function Home({ user, theme, onToggleTheme }: { user: User; theme: Theme; onToggleTheme: () => void }) {
  const [toast, setToast] = useState<ToastData | null>(null)
  const say = useCallback((message: string, action?: ToastData['action']) => setToast({ id: Date.now(), message, action }), [])
  const clearToast = useCallback(() => setToast(null), [])

  const store = useNotes(user.id, say)
  const { notes, labels } = store

  // Online saves land in a blink; only mention syncing when it's taking a while.
  const [slowSync, setSlowSync] = useState(false)
  const syncing = store.pending > 0 && !store.offline
  useEffect(() => {
    if (!syncing) {
      setSlowSync(false)
      return
    }
    const t = window.setTimeout(() => setSlowSync(true), 1500)
    return () => window.clearTimeout(t)
  }, [syncing])

  // A new version waits until asked for, so it never reloads mid-sentence.
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    if (needRefresh) say('A new version is ready.', { label: 'Reload', run: () => updateServiceWorker(true) })
  }, [needRefresh, say, updateServiceWorker])

  const signOut = async () => {
    const n = store.pending
    if (n > 0 && !window.confirm(`${n === 1 ? '1 change hasn’t' : `${n} changes haven’t`} reached the server yet and will be lost. Sign out anyway?`)) return
    const { error } = await supabase.auth.signOut()
    if (error) return say('Couldn’t sign out. Check your connection.')
    clearOffline(user.id).catch(console.error)
  }

  const [query, setQuery] = useState('')
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [kind, setKindState] = useState<Kind>(savedKind)

  const setKind = (next: Kind) => {
    setKindState(next)
    try {
      localStorage.setItem(KIND_KEY, next)
    } catch {
      // The choice just won't persist.
    }
  }

  useEffect(() => {
    loadEditor()
  }, [])

  // The pinned to-do list is a note like any other, kept off the collage and above it.
  const todoId = pinnedTodoId(user.id)
  const todo = notes.find(n => n.id === todoId)
  const todoContent = useMemo(() => todo?.content ?? emptyDoc('checklist'), [todo])
  const desk = useMemo(() => notes.filter(n => n.id !== todoId), [notes, todoId])

  const labelsById = useMemo(() => new Map(labels.map(l => [l.id, l])), [labels])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of desk) for (const id of n.labelIds) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [desk])

  const activeLabel = labelFilter ? labelsById.get(labelFilter) : undefined
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      desk.filter(
        n =>
          (kind === 'all' || n.mode === kind) &&
          (!activeLabel || n.labelIds.includes(activeLabel.id)) &&
          (!q || `${n.title} ${plainText(n.content)}`.toLowerCase().includes(q)),
      ),
    [desk, kind, activeLabel, q],
  )
  const kindWord = kind === 'checklist' ? 'lists' : kind === 'text' ? 'text notes' : 'notes'

  // A note started while viewing a label is filed under that label once it's first saved.
  const pendingLabel = useRef<string | null>(null)

  const startNote = (mode: NoteMode) => {
    pendingLabel.current = activeLabel?.id ?? null
    setEditing({ isNew: true, draft: { id: uuid(), title: '', content: emptyDoc(mode), mode } })
  }

  const openNote = (id: string) => {
    const n = notes.find(x => x.id === id)
    pendingLabel.current = null
    if (n) setEditing({ isNew: false, draft: { id: n.id, title: n.title, content: n.content, mode: n.mode } })
  }

  const openTodo = () => {
    pendingLabel.current = null
    setEditing({ isNew: !todo, draft: { id: todoId, title: '', content: todoContent, mode: 'checklist' } })
  }

  const saveTodo = (content: NoteDraft['content']) => store.saveNote({ id: todoId, title: '', mode: 'checklist', content })

  const clearDone = () => {
    const before = todoContent
    const n = countDone(before)
    saveTodo(withoutDone(before))
    say(`Cleared ${n} done.`, { label: 'Undo', run: () => saveTodo(before) })
  }

  const saveFromEditor = (draft: NoteDraft) => {
    store.saveNote(draft)
    if (pendingLabel.current) {
      store.toggleNoteLabel(draft.id, pendingLabel.current, true)
      pendingLabel.current = null
    }
  }

  const removeNote = (id: string) => {
    const undo = store.deleteNote(id)
    say('Note deleted.', { label: 'Undo', run: undo })
  }

  const finishEditing = ({ draft, dirty, persisted }: CloseInfo) => {
    setEditing(null)
    // The pinned list stays even when it's empty.
    if (draft.id === todoId) {
      if (dirty) saveFromEditor(draft)
      return
    }
    if (isBlank(draft.title, draft.content)) {
      if (persisted) {
        store.deleteNote(draft.id)
        say('Empty note discarded.')
      }
      return
    }
    if (dirty) saveFromEditor(draft)
  }

  const editingNote = editing ? notes.find(n => n.id === editing.draft.id) : undefined

  const toggleLabelInEditor = (labelId: string, on: boolean) => {
    if (editing) store.toggleNoteLabel(editing.draft.id, labelId, on)
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-btn only-sm" aria-label="Open labels" onClick={() => setDrawerOpen(true)}>
          <MenuIcon size={22} />
        </button>
        <h1 className="brand">
          <button type="button" onClick={() => setLabelFilter(null)}>
            Onthousels
          </button>
        </h1>
        <label className="search">
          <SearchIcon size={18} />
          <input type="search" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
          {query && (
            <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
              <CloseIcon size={16} />
            </button>
          )}
        </label>
        {(store.offline || slowSync) && (
          <span
            className={`sync${store.offline ? '' : ' syncing'}`}
            role="status"
            title={store.offline ? 'No connection. Your changes are kept on this device and will sync when you’re back online.' : undefined}
          >
            <span className="sync-dot" aria-hidden="true" />
            {store.offline ? (
              <>
                Offline<span className="hide-sm"> · kept on this device</span>
              </>
            ) : (
              'Syncing…'
            )}
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          title={theme === 'dark' ? 'Daylight' : 'Lamplight'}
        >
          {theme === 'dark' ? <SunIcon size={21} /> : <MoonIcon size={20} />}
        </button>
      </header>

      <Sidebar
        user={user}
        labels={labels}
        counts={counts}
        total={desk.length}
        selected={activeLabel?.id ?? null}
        open={drawerOpen}
        onSelect={setLabelFilter}
        onCreate={name => store.createLabel(name)}
        onRename={store.renameLabel}
        onDelete={store.deleteLabel}
        onSignOut={signOut}
        onClose={() => setDrawerOpen(false)}
      />

      <main className="desk">
        <div className="composer paper tone-0">
          <button type="button" className="composer-main" onClick={() => startNote('text')}>
            Write something…
          </button>
          <button type="button" className="icon-btn" title="New checklist" aria-label="New checklist" onClick={() => startNote('checklist')}>
            <ChecklistIcon size={20} />
          </button>
        </div>

        {!store.loading && (
          <PinnedTodo
            content={todoContent}
            onOpen={openTodo}
            onToggleTask={i => saveTodo(toggleTaskAt(todoContent, i))}
            onClearDone={clearDone}
          />
        )}

        {(activeLabel || (!store.loading && desk.length > 0)) && (
          <div className="shelf">
            {activeLabel && <h2 className="shelf-title">{activeLabel.name}</h2>}
            {!store.loading && desk.length > 0 && (
              <div className="segmented" role="radiogroup" aria-label="Show">
                {KINDS.map(({ id, name, Icon }) => (
                  <button key={id} type="button" role="radio" aria-checked={kind === id} onClick={() => setKind(id)}>
                    <Icon size={17} />
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {store.loading ? (
          <p className="quiet">Gathering your pages…</p>
        ) : shown.length === 0 ? (
          <div className="quiet">
            {q ? (
              <p>
                No {kindWord} hold “{query.trim()}”.
              </p>
            ) : activeLabel ? (
              <p>
                No {kindWord} filed under {activeLabel.name} yet.
              </p>
            ) : desk.length > 0 ? (
              <p>No {kindWord} yet.</p>
            ) : (
              <>
                <p className="quiet-big">A blank page, waiting.</p>
                <p>Your notes will gather here like pages on a desk.</p>
              </>
            )}
          </div>
        ) : (
          <section className="collage" aria-label="Notes">
            {shown.map(n => (
              <NoteCard
                key={n.id}
                note={n}
                labelsById={labelsById}
                onOpen={() => openNote(n.id)}
                onToggleTask={i => store.saveNote({ id: n.id, title: n.title, mode: n.mode, content: toggleTaskAt(n.content, i) })}
                onDelete={() => removeNote(n.id)}
              />
            ))}
          </section>
        )}
      </main>

      <button type="button" className="fab only-sm" aria-label="New note" onClick={() => startNote('text')}>
        <PlusIcon size={26} />
      </button>

      <Suspense fallback={null}>
        {editing && (
          <NoteEditor
            key={editing.draft.id}
            initial={editing.draft}
            isNew={editing.isNew}
            pinned={editing.draft.id === todoId}
            editedAt={editing.isNew ? undefined : editingNote?.updated_at}
            labelIds={editingNote?.labelIds ?? []}
            labels={labels}
            onSave={saveFromEditor}
            onToggleLabel={toggleLabelInEditor}
            onCreateLabel={store.createLabel}
            onDelete={() => {
              const id = editing.draft.id
              setEditing(null)
              if (editingNote) removeNote(id)
            }}
            onClose={finishEditing}
          />
        )}
      </Suspense>

      <Toast toast={toast} onDone={clearToast} />
    </div>
  )
}

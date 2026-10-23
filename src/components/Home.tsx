import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useNotes } from '../hooks/useNotes'
import type { Theme } from '../hooks/useTheme'
import type { Person } from '../lib/collab'
import { countDone, emptyDoc, isBlank, plainText, toggleTaskAt, withoutDone } from '../lib/doc'
import { uuid } from '../lib/id'
import { clearOffline } from '../lib/offline'
import { supabase } from '../lib/supabase'
import type { Note, NoteDraft, NoteMode, Space } from '../lib/types'
import { FriendsDialog } from './FriendsDialog'
import {
  BriefcaseIcon,
  ChecklistIcon,
  CloseIcon,
  HomeIcon,
  MenuIcon,
  MoonIcon,
  NotesIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  TextIcon,
} from './Icons'
import { NoteCard } from './NoteCard'
import type { CloseInfo } from './NoteEditor'
import { PinnedTabs, type PinnedPage, type TabView } from './PinnedTabs'
import type { ShareInfo } from './SharePicker'
import { Sidebar } from './Sidebar'
import { Toast, type ToastData } from './Toast'

// The editor carries most of the bundle; the collage can show before it arrives.
const loadEditor = () => import('./NoteEditor')
const NoteEditor = lazy(() => loadEditor().then(m => ({ default: m.NoteEditor })))

interface Editing {
  draft: NoteDraft
  isNew: boolean
  /** Whose note it is, remembered in case it stops being shared while open. */
  owner?: string
}

// Which notes the desk shows: everything, only text, or only checklists.
type Kind = 'all' | NoteMode
const KIND_KEY = 'onthousels-kind'
const KINDS = [
  { id: 'all', name: 'All', Icon: NotesIcon },
  { id: 'text', name: 'Text', Icon: TextIcon },
  { id: 'checklist', name: 'Lists', Icon: ChecklistIcon },
] as const

// Pinned tabs: which one was open, and whether the private or the shared ones were showing.
const PINNED_KEY = 'onthousels-pinned'
const TAB_VIEW_KEY = 'onthousels-tab-view'

// Personal and Work are two desks: their own notes, labels and pinned tabs.
const SPACE_KEY = 'onthousels-space'
const SPACES = [
  { id: 'personal', name: 'Personal', Icon: HomeIcon },
  { id: 'work', name: 'Work', Icon: BriefcaseIcon },
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

/** Pages and tabs, in the order they were arranged (oldest first where they never were). */
const inOrder = (a: Note, b: Note) => a.position - b.position || a.created_at.localeCompare(b.created_at)

function saved(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Storage can be unavailable (private mode).
    return null
  }
}

function savedSpace(): Space {
  try {
    if (localStorage.getItem(SPACE_KEY) === 'work') return 'work'
  } catch {
    // Storage can be unavailable (private mode); start at home.
  }
  return 'personal'
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice just won't persist.
  }
}

export function Home({ user, theme, onToggleTheme }: { user: User; theme: Theme; onToggleTheme: () => void }) {
  const [toast, setToast] = useState<ToastData | null>(null)
  const say = useCallback((message: string, action?: ToastData['action']) => setToast({ id: Date.now(), message, action }), [])
  const clearToast = useCallback(() => setToast(null), [])

  const store = useNotes(user.id, say)
  const { notes, labels, friends } = store

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
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [kind, setKindState] = useState<Kind>(savedKind)
  const [space, setSpaceState] = useState<Space>(savedSpace)
  const [pinnedId, setPinnedId] = useState(() => saved(PINNED_KEY))
  const [tabView, setTabViewState] = useState<TabView>(() => (saved(TAB_VIEW_KEY) === 'shared' ? 'shared' : 'mine'))

  const setKind = (next: Kind) => {
    setKindState(next)
    remember(KIND_KEY, next)
  }

  const setSpace = (next: Space) => {
    setSpaceState(next)
    remember(SPACE_KEY, next)
    // Labels belong to one space, so a label filter doesn't carry over.
    setLabelFilter(null)
  }

  useEffect(() => {
    loadEditor()
  }, [])

  // Friends, by the names this person gave them.
  const me = useMemo<Person>(
    () => ({ userId: user.id, name: (user.user_metadata.full_name as string | undefined) ?? user.email ?? 'A friend' }),
    [user],
  )
  const accepted = useMemo(
    () =>
      friends
        .filter(f => f.status === 'accepted' && f.userId)
        .map(f => ({ userId: f.userId!, name: f.name || f.email }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [friends],
  )
  const nameOf = useCallback((userId: string) => accepted.find(f => f.userId === userId)?.name ?? '', [accepted])
  const requests = useMemo(() => friends.filter(f => f.incoming && f.status === 'pending'), [friends])
  const closeFriends = useCallback(() => setFriendsOpen(false), [])

  // Mention a friend request that arrives while the app is open.
  const seenRequests = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (store.loading) return
    const ids = new Set(requests.map(r => r.id))
    const fresh = seenRequests.current ? requests.filter(r => !seenRequests.current!.has(r.id)) : []
    seenRequests.current = ids
    if (fresh.length) say(`${fresh[0].email} would like to share notes.`, { label: 'See', run: () => setFriendsOpen(true) })
  }, [requests, store.loading, say])

  const isMine = (n: Note) => n.user_id === user.id
  const sharing = (n: Note) => {
    if (!isMine(n)) return `from ${nameOf(n.user_id) || 'a friend'}`
    if (n.shares.length) return `with ${n.shares.map(id => nameOf(id) || 'a friend').join(', ')}`
    return undefined
  }

  // A note's pages, in order. They live inside their note, never on the desk themselves.
  const pagesOf = useMemo(() => {
    const m = new Map<string, Note[]>()
    for (const n of notes) if (n.parent_id) m.set(n.parent_id, [...(m.get(n.parent_id) ?? []), n])
    for (const list of m.values()) list.sort(inOrder)
    return m
  }, [notes])

  // Pinned notes are notes like any other, kept off the collage and above it as tabs, in the order
  // this person arranged them. They're split into their own and the ones shared with friends.
  const isShared = (n: Note) => !isMine(n) || n.shares.length > 0
  const tabs = useMemo(() => notes.filter(n => n.space === space && n.pinned && !n.parent_id).sort(inOrder), [notes, space])
  const viewTabs = tabs.filter(n => isShared(n) === (tabView === 'shared'))
  const activeTab = viewTabs.find(n => n.id === pinnedId) ?? viewTabs[0]

  const selectTab = (id: string) => {
    setPinnedId(id)
    remember(PINNED_KEY, id)
  }

  const setTabView = (next: TabView) => {
    setTabViewState(next)
    remember(TAB_VIEW_KEY, next)
  }

  const desk = useMemo(() => notes.filter(n => n.space === space && !n.pinned && !n.parent_id), [notes, space])
  const spaceLabels = useMemo(() => labels.filter(l => l.space === space), [labels, space])

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
          (!q || searchText(n).toLowerCase().includes(q)),
      ),
    [desk, kind, activeLabel, q, pagesOf],
  )
  // A note's pages count towards finding it.
  function searchText(n: Note) {
    return [n, ...(pagesOf.get(n.id) ?? [])].map(p => `${p.title} ${plainText(p.content)}`).join(' ')
  }
  const kindWord = kind === 'checklist' ? 'lists' : kind === 'text' ? 'text notes' : 'notes'

  // A note started while viewing a label is filed under that label once it's first saved.
  const pendingLabel = useRef<string | null>(null)

  const startNote = (mode: NoteMode) => {
    pendingLabel.current = activeLabel?.id ?? null
    setEditing({ isNew: true, draft: { id: uuid(), title: '', content: emptyDoc(mode), mode, space, pinned: false } })
  }

  const openNote = (id: string) => {
    const n = notes.find(x => x.id === id)
    pendingLabel.current = null
    if (n) {
      const { id, title, content, mode, space, pinned } = n
      setEditing({ isNew: false, owner: n.user_id, draft: { id, title, content, mode, space, pinned } })
    }
  }

  /** A new tab, straight onto the desk; with friends ticked it's shared from the start. */
  const addTab = (name: string, mode: NoteMode, friendIds: string[]) => {
    const id = uuid()
    store.saveNote({ id, title: name, content: emptyDoc(mode), mode, space, pinned: true })
    // At the end of this person's own tabs.
    store.reorder([...tabs.filter(isMine).map(t => t.id), id])
    for (const friendId of friendIds) store.shareNote(id, space, true, friendId, true)
    setTabView(friendIds.length ? 'shared' : 'mine')
    selectTab(id)
  }

  const saveContent = (n: Note, content: NoteDraft['content']) => {
    const { id, title, mode, space, pinned } = n
    store.saveNote({ id, title, mode, space, pinned, content })
  }

  const clearDone = () => {
    if (!activeTab) return
    const before = activeTab.content
    const n = countDone(before)
    saveContent(activeTab, withoutDone(before))
    say(`Cleared ${n} done.`, { label: 'Undo', run: () => saveContent(activeTab, before) })
  }

  const saveFromEditor = (draft: NoteDraft) => {
    store.saveNote(draft)
    if (pendingLabel.current) {
      store.toggleNoteLabel(draft.id, pendingLabel.current, true)
      pendingLabel.current = null
    }
  }

  /**
   * Deletes a note, or for one a friend shared, takes it off this desk (asking first, unless that's
   * been `confirmed` already). Returns false if called off.
   */
  const removeNote = (id: string, name?: string, confirmed = false) => {
    const note = notes.find(n => n.id === id)
    if (note && !isMine(note)) {
      const owner = nameOf(note.user_id) || 'Your friend'
      const what = name || note.title
      const ok =
        confirmed ||
        window.confirm(`Remove ${what ? `“${what}”` : 'this note'} from your notes? ${owner} keeps it, and can share it with you again.`)
      if (!ok) return false
      store.deleteNote(id)
      say('Removed from your notes.')
      return true
    }
    if (note && !confirmed) {
      const what = name || note.title.trim()
      const pages = pagesOf.get(id)?.length ?? 0
      const withPages = pages ? ` and its ${pages === 1 ? 'page' : `${pages} pages`}` : ''
      const friends = note.shares.map(f => nameOf(f) || 'a friend')
      const shared = friends.length ? ` It’s shared with ${friends.join(', ')}, so it goes for them too.` : ''
      const thing = note.pinned ? 'this tab' : 'this note'
      if (!window.confirm(`Delete ${what ? `“${what}”` : thing}${withPages}?${shared}`)) return false
    }
    const undo = store.deleteNote(id)
    say(note?.pinned ? 'Tab deleted.' : 'Note deleted.', undo ? { label: 'Undo', run: undo } : undefined)
    return true
  }

  const finishEditing = ({ draft, dirty, persisted }: CloseInfo) => {
    setEditing(null)
    // Tabs stay even when they're empty (deleting one is deliberate), so does a note with pages,
    // and so does a friend's note (it's theirs to throw away).
    const note = notes.find(n => n.id === draft.id)
    if (draft.pinned || pagesOf.has(draft.id) || (note && !isMine(note))) {
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
  const borrowed = Boolean(editing?.owner && editing.owner !== user.id)

  // The friend stopped sharing the open note, or deleted it.
  const lost = borrowed && !editingNote ? editing!.owner! : null
  useEffect(() => {
    if (!lost) return
    setEditing(null)
    say(`${nameOf(lost) || 'Your friend'} stopped sharing that note.`)
  }, [lost, nameOf, say])

  const toggleLabelInEditor = (labelId: string, on: boolean) => {
    if (editing) store.toggleNoteLabel(editing.draft.id, labelId, on)
  }

  /** Sharing for a note, from this person's side. */
  const shareFor = (n: Pick<Note, 'id' | 'user_id' | 'space' | 'pinned' | 'title'>): ShareInfo => {
    if (n.user_id !== user.id) {
      return {
        ownerName: nameOf(n.user_id) || 'A friend',
        friends: [],
        selected: [],
        onToggle: () => {},
        onLeave: () => {
          if (removeNote(n.id, n.title)) setEditing(e => (e?.draft.id === n.id ? null : e))
        },
      }
    }
    return {
      friends: accepted,
      selected: notes.find(x => x.id === n.id)?.shares ?? [],
      onToggle: (friendId, on) => store.shareNote(n.id, n.space, n.pinned, friendId, on),
      onLeave: () => {},
    }
  }

  const share = editing ? shareFor({ ...editing.draft, user_id: editing.owner ?? user.id }) : undefined

  const pages: PinnedPage[] = viewTabs.map(n => {
    const base = shareFor(n)
    return {
      id: n.id,
      name: n.title.trim() || 'Untitled',
      owner: isMine(n) ? undefined : nameOf(n.user_id) || 'a friend',
      mode: n.mode,
      content: n.content,
      shared: isShared(n),
      share: isMine(n)
        ? {
            ...base,
            // Sharing a tab (or stopping) moves it between Mine and Shared; follow it there.
            onToggle: (friendId, on) => {
              base.onToggle(friendId, on)
              setTabView(on || n.shares.some(id => id !== friendId) ? 'shared' : 'mine')
            },
          }
        : base,
    }
  })
  const activePage = pages.find(p => p.id === activeTab?.id)

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-btn only-sm menu-btn" aria-label="Open labels" onClick={() => setDrawerOpen(true)}>
          <MenuIcon size={22} />
          {requests.length > 0 && <span className="menu-dot" aria-label="Friend request waiting" />}
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
        <div className="segmented space-switch" role="radiogroup" aria-label="Space">
          {SPACES.map(({ id, name, Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={space === id} title={name} onClick={() => setSpace(id)}>
              <Icon size={17} />
              <span className="hide-sm">{name}</span>
            </button>
          ))}
        </div>
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
        labels={spaceLabels}
        counts={counts}
        total={desk.length}
        selected={activeLabel?.id ?? null}
        open={drawerOpen}
        requests={requests.length}
        onOpenFriends={() => setFriendsOpen(true)}
        onSelect={setLabelFilter}
        onCreate={name => store.createLabel(name, space)}
        onRename={store.renameLabel}
        onDelete={store.deleteLabel}
        onSignOut={signOut}
        onClose={() => setDrawerOpen(false)}
      />

      <main className="desk">
        <div className="composer paper tone-0">
          <button type="button" className="composer-main" onClick={() => startNote('text')}>
            {space === 'work' ? 'Write something for work…' : 'Write something…'}
          </button>
          <button type="button" className="icon-btn" title="New checklist" aria-label="New checklist" onClick={() => startNote('checklist')}>
            <ChecklistIcon size={20} />
          </button>
        </div>

        {!store.loading && (
          <PinnedTabs
            view={tabView}
            onView={setTabView}
            pages={pages}
            active={activePage}
            friends={accepted}
            onSelect={selectTab}
            onOpen={() => activeTab && openNote(activeTab.id)}
            onAdd={addTab}
            onRename={store.renameNote}
            onReorder={store.reorder}
            onDelete={item => removeNote(item.id, item.name, true)}
            onToggleTask={i => activeTab && saveContent(activeTab, toggleTaskAt(activeTab.content, i))}
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
            ) : space === 'work' ? (
              <>
                <p className="quiet-big">A clean desk for work.</p>
                <p>Work notes and their own to-do list stay here, apart from your personal ones.</p>
              </>
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
                sharing={sharing(n)}
                pages={pagesOf.get(n.id)?.length}
                borrowed={!isMine(n)}
                onOpen={() => openNote(n.id)}
                onToggleTask={i => saveContent(n, toggleTaskAt(n.content, i))}
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
            saved={editingNote}
            pinned={editing.draft.pinned}
            shared={Boolean(editingNote && (borrowed || editingNote.shares.length > 0))}
            me={me}
            nameOf={nameOf}
            editedAt={editing.isNew ? undefined : editingNote?.updated_at}
            labelIds={editingNote?.labelIds ?? []}
            labels={spaceLabels}
            share={share}
            onSave={saveFromEditor}
            pages={pagesOf.get(editing.draft.id) ?? []}
            onSavePage={store.saveNote}
            onAddPage={(name, mode) =>
              store.addPage({ id: editing.draft.id, user_id: editing.owner ?? user.id, space: editing.draft.space }, name, mode, emptyDoc(mode))
            }
            onRenamePage={store.renameNote}
            onReorderPages={store.reorder}
            onDeletePage={id => {
              const undo = store.deleteNote(id)
              say('Page deleted.', undo ? { label: 'Undo', run: undo } : undefined)
            }}
            onToggleLabel={toggleLabelInEditor}
            onCreateLabel={name => store.createLabel(name, editing.draft.space)}
            onDelete={() => {
              // A note that was never saved just goes; anything else is asked about first.
              if (!editingNote || removeNote(editing.draft.id)) setEditing(null)
            }}
            onClose={finishEditing}
          />
        )}
      </Suspense>

      {friendsOpen && (
        <FriendsDialog
          friends={friends}
          myEmail={user.email ?? ''}
          onAdd={store.addFriend}
          onAnswer={store.answerFriend}
          onRename={store.renameFriend}
          onRemove={store.removeFriend}
          onClose={closeFriends}
        />
      )}

      <Toast toast={toast} onDone={clearToast} />
    </div>
  )
}

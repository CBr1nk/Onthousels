import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { EditorContent, Node, useEditor, useEditorState, type Editor, type Extensions, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { joinNote, meta, seed, SEED, setText, titleText, writeBody, type Person } from '../lib/collab'
import { hashId, isBlank, toChecklist, toText } from '../lib/doc'
import { Hashtags, takeTagBeforeCursor } from '../lib/hashtags'
import type { Label, NoteDraft, NoteMode } from '../lib/types'
import { ChecklistIcon, PagesIcon, PencilIcon, PeopleIcon, PlusIcon, TagIcon, TextIcon, TrashIcon } from './Icons'
import { LabelPicker } from './LabelPicker'
import { SharePicker, type ShareInfo } from './SharePicker'
import { ArrangeTabs, NewTabForm } from './TabTools'

// In checklist mode the whole note is a single task list.
const ChecklistDoc = Node.create({ name: 'doc', topNode: true, content: 'taskList' })

const sharedKit = { heading: false, code: false, codeBlock: false, blockquote: false, horizontalRule: false, link: false } as const

interface Together {
  doc: Y.Doc
  awareness: Awareness
  me: Person & { color: string }
  /** Draws a friend's caret, labelled with the name this person knows them by. */
  caret: (user: Record<string, string>) => HTMLElement
}

function extensionsFor(mode: NoteMode, onTag: (name: string) => void, together?: Together): Extensions {
  const placeholder = Placeholder.configure({
    placeholder: mode === 'text' ? 'Begin anywhere…' : 'List item',
    includeChildren: true,
  })
  const hashtags = Hashtags.configure({ onTag })
  // Edits go through the shared document, which keeps its own undo history.
  const collab = together
    ? [
        Collaboration.configure({ document: together.doc, field: mode }),
        CollaborationCaret.configure({
          provider: { awareness: together.awareness },
          user: { id: together.me.userId, name: together.me.name, color: together.me.color },
          render: together.caret,
        }),
      ]
    : []
  const kit = { ...sharedKit, ...(together && { undoRedo: false as const }) }
  if (mode === 'text') return [StarterKit.configure(kit), placeholder, hashtags, ...collab]
  return [
    StarterKit.configure({
      ...kit,
      document: false,
      trailingNode: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
    }),
    ChecklistDoc,
    TaskList,
    TaskItem.configure({ nested: true }),
    placeholder,
    hashtags,
    ...collab,
  ]
}

const noTag = () => {}

// Pencil colours for friends' carets.
const CARET_COLORS = ['#2f6690', '#b0563d', '#3f7d5a', '#8a5aa8', '#a07a1f', '#2c7c86']
export const caretColor = (userId: string) => CARET_COLORS[hashId(userId) % CARET_COLORS.length]

export interface CloseInfo {
  draft: NoteDraft
  dirty: boolean
  persisted: boolean
}

/** One of a note's pages, as saved. */
export interface PageInfo {
  id: string
  title: string
  content: JSONContent
  mode: NoteMode
  updated_at: string
}

interface Props {
  initial: NoteDraft
  isNew: boolean
  /** The note as saved now, for coming back to it from one of its pages. */
  saved?: Pick<NoteDraft, 'title' | 'content' | 'mode'>
  /** A pinned tab rather than a note on the desk: its title is the tab's name, and it isn't labelled. */
  pinned?: boolean
  /** Shared with a friend, so they may have it (or one of its pages) open too. */
  shared: boolean
  me: Person
  nameOf: (userId: string) => string
  editedAt?: string
  labelIds: string[]
  labels: Label[]
  share?: ShareInfo
  /** The note's pages, in order. */
  pages: PageInfo[]
  onSave: (draft: NoteDraft) => void
  onSavePage: (draft: NoteDraft) => void
  /** Adds a page and returns its id. */
  onAddPage: (name: string, mode: NoteMode) => string
  onRenamePage: (id: string, name: string) => void
  onReorderPages: (ids: string[]) => void
  onDeletePage: (id: string) => void
  onToggleLabel: (labelId: string, on: boolean) => void
  onCreateLabel: (name: string) => Promise<Label | null>
  onDelete: () => void
  onClose: (info: CloseInfo) => void
}

const editedFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * The editor sheet: a note, and when it has pages, a row of them under its title. One page is
 * open at a time, each with its own editing session; the toolbar works on whichever is open.
 */
export function NoteEditor(props: Props) {
  const { initial, isNew, pinned, shared, labelIds, labels, share, pages } = props
  const cb = useRef(props)
  cb.current = props

  const [activeId, setActiveId] = useState(initial.id)
  const [view, setView] = useState<PageView>({ editor: null, mode: initial.mode, ready: false, peers: [] })
  const [rootTitle, setRootTitle] = useState(initial.title)
  const [picking, setPicking] = useState<'labels' | 'share' | 'page' | 'arrange' | null>(null)
  const pageRef = useRef<PageHandle>(null)
  // Where the note itself stood when one of its pages was opened.
  const rootLeft = useRef<CloseInfo | null>(null)
  // A page just added, to open ready to write in.
  const fresh = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const onRoot = activeId === initial.id
  const activePage = pages.find(p => p.id === activeId)

  // The open page was deleted (here, or by a friend): back to the note.
  useEffect(() => {
    if (!onRoot && !activePage) setActiveId(initial.id)
  }, [onRoot, activePage, initial.id])

  /** Leaves the open page (saving what it holds) for another. */
  const open = (id: string) => {
    if (id === activeId) return
    const info = pageRef.current?.finish()
    if (info?.dirty) (onRoot ? cb.current.onSave : cb.current.onSavePage)(info.draft)
    if (onRoot && info) rootLeft.current = { draft: info.draft, dirty: false, persisted: info.persisted || info.dirty }
    setPicking(null)
    setActiveId(id)
  }

  const close = () => {
    const info = pageRef.current?.finish()
    if (onRoot && info) {
      cb.current.onClose(info)
      // A tag typed just before Done still counts, unless it was all the note held.
      if (info.tag && !isBlank(info.draft.title, info.draft.content)) addTag(info.tag)
      return
    }
    if (info?.dirty) cb.current.onSavePage(info.draft)
    cb.current.onClose(rootLeft.current ?? { draft: initial, dirty: false, persisted: !isNew })
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // "#ideas" in the body files the note under that label, making the label if needed.
  const addTag = async (name: string) => {
    if (cb.current.pinned) return
    const label = await cb.current.onCreateLabel(name)
    if (label && !cb.current.labelIds.includes(label.id)) toggleLabel(label.id, true)
  }

  // Labels, shares and pages need a saved note to hang on.
  const toggleLabel = (labelId: string, on: boolean) => {
    pageRef.current?.ensureSaved()
    cb.current.onToggleLabel(labelId, on)
  }

  const toggleShare = (userId: string, on: boolean) => {
    pageRef.current?.ensureSaved()
    cb.current.share?.onToggle(userId, on)
  }

  const addPage = (name: string, mode: NoteMode) => {
    if (onRoot) pageRef.current?.ensureSaved()
    const id = cb.current.onAddPage(name, mode)
    fresh.current = id
    open(id)
  }

  const deletePage = (id: string) => {
    if (id === activeId) open(initial.id)
    cb.current.onDeletePage(id)
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    // Reading an existing note shouldn't summon the on-screen keyboard.
    if (!isNew) sheetRef.current?.focus()
    const onCancel = (e: Event) => {
      e.preventDefault()
      closeRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [])

  const { editor, mode, ready, peers } = view
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      italic: editor?.isActive('italic') ?? false,
    }),
  })

  const closePicker = useCallback(() => setPicking(null), [])

  const selectedLabels = labels.filter(l => labelIds.includes(l.id))
  const here = peers.map(p => cb.current.nameOf(p.userId) || p.name)
  const editedAt = onRoot ? props.editedAt : activePage?.updated_at

  const newPage = picking === 'page' && <NewTabForm noun="page" onAdd={addPage} onClose={closePicker} />

  const strip = pages.length > 0 && (
    <div className="sheet-pages">
      <div className="pinned-tabs" role="tablist" aria-label="Pages">
        <button type="button" role="tab" className="pinned-tab" aria-selected={onRoot} onClick={() => open(initial.id)}>
          Overview
        </button>
        {pages.map(p => (
          <button key={p.id} type="button" role="tab" className="pinned-tab" aria-selected={p.id === activeId} onClick={() => open(p.id)}>
            {p.title.trim() || 'Untitled'}
          </button>
        ))}
      </div>
      <div className="anchor">
        <button
          type="button"
          className={`pinned-tab pinned-add${picking === 'page' ? ' on' : ''}`}
          aria-label="New page"
          title="New page"
          aria-expanded={picking === 'page'}
          onClick={() => setPicking(p => (p === 'page' ? null : 'page'))}
        >
          <PlusIcon size={16} />
        </button>
        {newPage}
      </div>
      <div className="anchor">
        <button
          type="button"
          className={`icon-btn${picking === 'arrange' ? ' on' : ''}`}
          title="Arrange pages"
          aria-label="Arrange pages"
          aria-expanded={picking === 'arrange'}
          onClick={() => setPicking(p => (p === 'arrange' ? null : 'arrange'))}
        >
          <PencilIcon size={16} />
        </button>
        {picking === 'arrange' && (
          <ArrangeTabs
            heading="Pages"
            items={pages.map(p => ({ id: p.id, name: p.title.trim() || 'Untitled' }))}
            onRename={cb.current.onRenamePage}
            onReorder={cb.current.onReorderPages}
            onDelete={item => deletePage(item.id)}
            onClose={closePicker}
          />
        )}
      </div>
    </div>
  )

  // Without pages yet, a quiet button beside the title starts the first one.
  const titleAction = pages.length === 0 && (
    <div className="anchor">
      <button
        type="button"
        className={`icon-btn${picking === 'page' ? ' on' : ''}`}
        title="Add a page"
        aria-label="Add a page"
        aria-expanded={picking === 'page'}
        onClick={() => setPicking(p => (p === 'page' ? null : 'page'))}
      >
        <PagesIcon size={19} />
      </button>
      {newPage}
    </div>
  )

  const { saved } = props
  const savedRoot = saved ? { ...initial, title: saved.title, content: saved.content, mode: saved.mode } : initial

  return (
    <dialog
      ref={dialogRef}
      className="editor-dialog"
      aria-label={rootTitle || 'Note'}
      onClick={e => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="sheet paper tone-0" ref={sheetRef} tabIndex={-1}>
        <div
          className="sheet-scroll"
          onClick={e => {
            if (!editor || !ready || (e.target as HTMLElement).closest('button, input, a, form, .popover, .ProseMirror')) return
            // A selection dragged out past the text ends here too; leave it be.
            if (!window.getSelection()?.isCollapsed) return
            editor.commands.focus('end')
          }}
        >
          {onRoot ? (
            <Page
              key={initial.id}
              ref={pageRef}
              // Coming back from a page, start from what's saved since.
              initial={rootLeft.current ? savedRoot : initial}
              isNew={isNew && !rootLeft.current}
              root
              titleLabel={pinned ? 'Tab name' : 'Title'}
              titleMax={pinned ? 40 : 200}
              titleAction={titleAction}
              strip={strip}
              shared={shared}
              autoFocus={false}
              me={props.me}
              nameOf={props.nameOf}
              onSave={draft => cb.current.onSave(draft)}
              onTag={name => addTag(name)}
              onView={setView}
              onTitle={setRootTitle}
            />
          ) : (
            activePage && (
              <Page
                key={activePage.id}
                ref={pageRef}
                initial={{ ...activePage, space: initial.space, pinned: false }}
                isNew={false}
                root={false}
                name={activePage.title}
                heading={
                  <button type="button" className="sheet-title sheet-title-link" title="Back to the overview" onClick={() => open(initial.id)}>
                    {rootTitle.trim() || 'Untitled'}
                  </button>
                }
                strip={strip}
                shared={shared}
                autoFocus={fresh.current === activePage.id}
                me={props.me}
                nameOf={props.nameOf}
                onSave={draft => cb.current.onSavePage(draft)}
                onView={setView}
              />
            )
          )}
          {((onRoot && selectedLabels.length > 0) || editedAt || here.length > 0) && (
            <div className="sheet-meta">
              <div className="chips">
                {onRoot &&
                  selectedLabels.map(l => (
                    <button key={l.id} type="button" className="chip chip-btn" title="Remove label" onClick={() => toggleLabel(l.id, false)}>
                      {l.name} <span aria-hidden="true">×</span>
                    </button>
                  ))}
              </div>
              {here.length > 0 && (
                <span className="here" role="status">
                  <span className="here-dot" aria-hidden="true" />
                  {here.join(', ')} {here.length === 1 ? 'is' : 'are'} here
                </span>
              )}
              {editedAt && <span className="edited">Edited {editedFormat.format(new Date(editedAt))}</span>}
            </div>
          )}
        </div>

        <div className="sheet-tools" role="toolbar" aria-label="Note tools">
          <div className="segmented" role="radiogroup" aria-label="Note type">
            <button type="button" role="radio" aria-checked={mode === 'text'} title="Text" onClick={() => pageRef.current?.switchMode('text')}>
              <TextIcon size={18} />
              <span className="hide-sm">Text</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'checklist'}
              title="Checkboxes"
              onClick={() => pageRef.current?.switchMode('checklist')}
            >
              <ChecklistIcon size={18} />
              <span className="hide-sm">List</span>
            </button>
          </div>

          <span className="tool-sep" aria-hidden="true" />

          <button
            type="button"
            className={`icon-btn fmt${active?.bold ? ' on' : ''}`}
            title="Bold (Ctrl+B)"
            aria-label="Bold"
            aria-pressed={active?.bold}
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <b>B</b>
          </button>
          <button
            type="button"
            className={`icon-btn fmt${active?.italic ? ' on' : ''}`}
            title="Italic (Ctrl+I)"
            aria-label="Italic"
            aria-pressed={active?.italic}
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <i>I</i>
          </button>

          {!pinned && (
            <div className="anchor">
              <button
                type="button"
                className={`icon-btn${picking === 'labels' ? ' on' : ''}`}
                title="Labels"
                aria-label="Labels"
                aria-expanded={picking === 'labels'}
                onClick={() => setPicking(p => (p === 'labels' ? null : 'labels'))}
              >
                <TagIcon size={19} />
              </button>
              {picking === 'labels' && (
                <LabelPicker
                  labels={labels}
                  selected={labelIds}
                  onToggle={toggleLabel}
                  onCreate={name => cb.current.onCreateLabel(name)}
                  onClose={closePicker}
                />
              )}
            </div>
          )}

          {share && (
            <div className="anchor">
              <button
                type="button"
                className={`icon-btn${picking === 'share' || shared ? ' on' : ''}`}
                title="Share"
                aria-label="Share"
                aria-expanded={picking === 'share'}
                onClick={() => setPicking(p => (p === 'share' ? null : 'share'))}
              >
                <PeopleIcon size={20} />
              </button>
              {picking === 'share' && (
                <SharePicker
                  ownerName={share.ownerName}
                  friends={share.friends}
                  selected={share.selected}
                  onToggle={toggleShare}
                  onLeave={share.onLeave}
                  onClose={closePicker}
                />
              )}
            </div>
          )}

          {share?.ownerName === undefined && (
            <button
              type="button"
              className="icon-btn"
              title={pinned ? 'Delete tab' : 'Delete'}
              aria-label={pinned ? 'Delete tab' : 'Delete note'}
              onClick={() => cb.current.onDelete()}
            >
              <TrashIcon size={19} />
            </button>
          )}

          <button type="button" className="btn-done" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}

/** What the sheet's toolbar needs from the open page. */
interface PageView {
  editor: Editor | null
  mode: NoteMode
  ready: boolean
  peers: Person[]
}

interface PageHandle {
  /** Stops autosaving and says where things stand; whoever closes it decides about saving. */
  finish: () => CloseInfo & { tag: string | null }
  switchMode: (mode: NoteMode) => void
  /** Saves now if it never has been. */
  ensureSaved: () => void
}

interface PageProps {
  ref: Ref<PageHandle>
  initial: NoteDraft
  isNew: boolean
  /** The note itself, rather than one of its pages: its title is typed here, and it takes #tags. */
  root: boolean
  /** For a page: its name, which is kept by the page list rather than typed here. */
  name?: string
  titleLabel?: string
  titleMax?: number
  /** Shown in place of the title box (on a page: the note's title). */
  heading?: ReactNode
  /** Beside the title. */
  titleAction?: ReactNode
  /** Between the title and the text. */
  strip?: ReactNode
  shared: boolean
  autoFocus: boolean
  me: Person
  nameOf: (userId: string) => string
  onSave: (draft: NoteDraft) => void
  onTag?: (name: string) => void
  onView: (view: PageView) => void
  onTitle?: (title: string) => void
}

/** One note or page being edited, as a shared document so friends can write in it at the same time. */
function Page(props: PageProps) {
  const { ref, initial, isNew, root, shared } = props
  const cb = useRef(props)
  cb.current = props

  // A note nobody else has is built from what's saved straight away; a shared one waits to hear
  // whether a friend already has it open.
  const [{ doc, awareness }] = useState(() => {
    const doc = new Y.Doc()
    if (!shared) seed(doc, initial, extensionsFor(initial.mode, noTag))
    return { doc, awareness: new Awareness(doc) }
  })
  const [ready, setReady] = useState(!shared)
  const readyRef = useRef(ready)
  const [peers, setPeers] = useState<Person[]>([])

  const [title, setTitle] = useState(initial.title)
  const [mode, setMode] = useState<NoteMode>(initial.mode)

  const titleRef = useRef(initial.title)
  const modeRef = useRef(initial.mode)
  const contentRef = useRef(initial.content)
  const dirty = useRef(false)
  const persisted = useRef(!isNew)
  const timer = useRef<number | undefined>(undefined)
  const focusBody = useRef(isNew || props.autoFocus)

  const draft = (): NoteDraft => ({
    id: initial.id,
    title: root ? titleRef.current : (cb.current.name ?? titleRef.current),
    content: contentRef.current,
    mode: modeRef.current,
    space: initial.space,
    pinned: initial.pinned,
  })

  const save = () => {
    window.clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    persisted.current = true
    cb.current.onSave(draft())
  }
  // Autosave shortly after a pause, whoever was writing.
  const touch = () => {
    dirty.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 700)
  }
  const touchRef = useRef(touch)
  touchRef.current = touch

  // Title and mode live in the shared document too, so a friend's changes show up here.
  useEffect(() => {
    const m = meta(doc)
    const t = titleText(doc)
    const onMeta = () => {
      const next = m.get('mode')
      if (!next || next === modeRef.current) return
      modeRef.current = next
      setMode(next)
    }
    const onTitle = () => {
      titleRef.current = t.toString()
      setTitle(titleRef.current)
      if (cb.current.root) cb.current.onTitle?.(titleRef.current)
    }
    const onUpdate = (_: Uint8Array, origin: unknown) => {
      if (origin !== SEED && readyRef.current) touchRef.current()
    }
    m.observe(onMeta)
    t.observe(onTitle)
    doc.on('update', onUpdate)
    return () => {
      m.unobserve(onMeta)
      t.unobserve(onTitle)
      doc.off('update', onUpdate)
    }
  }, [doc])

  // Friends' names on their carets, as this person knows them.
  const caret = useCallback((user: Record<string, string>) => {
    const el = document.createElement('span')
    el.className = 'collab-caret'
    el.style.borderColor = user.color
    const label = document.createElement('span')
    label.className = 'collab-caret-label'
    label.style.backgroundColor = user.color
    label.textContent = cb.current.nameOf(user.id) || user.name
    el.append(label)
    return el
  }, [])

  const editor = useEditor(
    {
      // Until the shared document is in hand, show what's saved without letting it be edited.
      extensions: extensionsFor(
        mode,
        name => cb.current.onTag?.(name),
        ready ? { doc, awareness, me: { ...props.me, color: caretColor(props.me.userId) }, caret } : undefined,
      ),
      content: ready ? undefined : initial.content,
      editable: ready,
      editorProps: { attributes: { class: 'prose editor-prose', 'aria-label': root ? 'Note' : `Page: ${props.name ?? ''}` } },
      onCreate: ({ editor }) => {
        if (readyRef.current) contentRef.current = editor.getJSON()
      },
      onUpdate: ({ editor }) => {
        if (readyRef.current) contentRef.current = editor.getJSON()
      },
    },
    [mode, ready],
  )

  // A shared note (and each of its pages) is edited together over its own channel.
  useEffect(() => {
    if (!shared) return
    const markReady = () => {
      readyRef.current = true
      setReady(true)
    }
    return joinNote({
      noteId: initial.id,
      doc,
      awareness,
      me: cb.current.me,
      isReady: () => readyRef.current,
      onAlone: () => {
        seed(doc, cb.current.initial, extensionsFor(cb.current.initial.mode, noTag))
        markReady()
      },
      onSynced: markReady,
      onPeers: setPeers,
    })
  }, [shared, initial.id, doc, awareness])

  // Stop renewing this person's caret once the page is closed. (Saving on the way out is up to
  // the sheet, which knows whether the note is being kept or was just deleted.)
  useEffect(() => () => awareness.destroy(), [awareness])

  useEffect(() => {
    cb.current.onView({ editor, mode, ready, peers })
  }, [editor, mode, ready, peers])

  useEffect(() => {
    if (!editor || !ready || !focusBody.current) return
    // The editor may be torn down (mode switch, StrictMode remount) before the frame fires.
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus('end')
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, ready])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // When a phone's keyboard opens, the sheet shrinks to the space above it (see viewport.ts);
  // keep the line being written on in sight.
  useEffect(() => {
    const vv = window.visualViewport
    if (!editor || !vv) return
    const onResize = () => {
      if (!editor.isDestroyed && editor.isFocused) editor.commands.scrollIntoView()
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [editor])

  useImperativeHandle(ref, () => ({
    finish: () => {
      const tag = root && editor ? takeTagBeforeCursor(editor) : null
      window.clearTimeout(timer.current)
      const info = { draft: draft(), dirty: dirty.current, persisted: persisted.current, tag }
      // Whoever finished it saves it now, so leaving doesn't save it again.
      dirty.current = false
      return info
    },
    switchMode: next => {
      if (next === modeRef.current || !readyRef.current) return
      const content = next === 'checklist' ? toChecklist(contentRef.current) : toText(contentRef.current)
      contentRef.current = content
      focusBody.current = true
      // Everyone with it open switches with it.
      writeBody(doc, next, content, extensionsFor(next, noTag))
    },
    ensureSaved: () => {
      if (persisted.current) return
      dirty.current = true
      save()
    },
  }))

  return (
    <>
      <div className="sheet-title-row">
        {root ? (
          <input
            className="sheet-title"
            placeholder={props.titleLabel}
            value={title}
            maxLength={props.titleMax}
            readOnly={!ready}
            onChange={e => setText(titleText(doc), e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
          />
        ) : (
          props.heading
        )}
        {props.titleAction}
      </div>
      {props.strip}
      <EditorContent editor={editor} className={`sheet-body mode-${mode}${ready ? '' : ' joining'}`} />
    </>
  )
}

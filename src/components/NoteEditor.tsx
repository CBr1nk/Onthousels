import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, Node, useEditor, useEditorState, type Extensions } from '@tiptap/react'
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
import { ChecklistIcon, PeopleIcon, TagIcon, TextIcon, TrashIcon } from './Icons'
import { LabelPicker } from './LabelPicker'
import { SharePicker } from './SharePicker'

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

export interface ShareInfo {
  /** Set when a friend shared this note: their name. */
  ownerName?: string
  friends: Person[]
  selected: string[]
  onToggle: (userId: string, on: boolean) => void
  onLeave: () => void
}

interface Props {
  initial: NoteDraft
  isNew: boolean
  /** The pinned to-do list: always a checklist, never deleted, labelled or shared. */
  pinned?: boolean
  /** Shared with a friend, so they may have it open too. */
  shared: boolean
  me: Person
  nameOf: (userId: string) => string
  editedAt?: string
  labelIds: string[]
  labels: Label[]
  share?: ShareInfo
  onSave: (draft: NoteDraft) => void
  onToggleLabel: (labelId: string, on: boolean) => void
  onCreateLabel: (name: string) => Promise<Label | null>
  onDelete: () => void
  onClose: (info: CloseInfo) => void
}

const editedFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function NoteEditor(props: Props) {
  const { initial, isNew, pinned, shared, editedAt, labelIds, labels, share } = props
  const cb = useRef(props)
  cb.current = props

  // The note as a shared document. A note nobody else has is built from what's saved straight
  // away; a shared one waits to hear whether a friend already has it open.
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
  const [picking, setPicking] = useState<'labels' | 'share' | null>(null)

  const titleRef = useRef(initial.title)
  const modeRef = useRef(initial.mode)
  const contentRef = useRef(initial.content)
  const dirty = useRef(false)
  const persisted = useRef(!isNew)
  const timer = useRef<number | undefined>(undefined)
  const focusBody = useRef(isNew)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const draft = (): NoteDraft => ({
    id: initial.id,
    title: titleRef.current,
    content: contentRef.current,
    mode: modeRef.current,
    space: initial.space,
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

  const close = () => {
    // A tag typed just before Done still counts, unless it was all the note held.
    const tag = editor && takeTagBeforeCursor(editor)
    window.clearTimeout(timer.current)
    const d = draft()
    cb.current.onClose({ draft: d, dirty: dirty.current, persisted: persisted.current })
    if (tag && !isBlank(d.title, d.content)) {
      persisted.current = true // onClose just saved it
      addTag(tag)
    }
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // "#ideas" in the body files the note under that label, making the label if needed.
  const addTag = async (name: string) => {
    if (cb.current.pinned) return
    const label = await cb.current.onCreateLabel(name)
    if (label && !cb.current.labelIds.includes(label.id)) toggleLabel(label.id, true)
  }
  const addTagRef = useRef(addTag)
  addTagRef.current = addTag

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
      // Until the shared document is in hand, show the saved note without letting it be edited.
      extensions: extensionsFor(
        mode,
        name => addTagRef.current(name),
        ready ? { doc, awareness, me: { ...props.me, color: caretColor(props.me.userId) }, caret } : undefined,
      ),
      content: ready ? undefined : initial.content,
      editable: ready,
      editorProps: { attributes: { class: 'prose editor-prose', 'aria-label': 'Note' } },
      onCreate: ({ editor }) => {
        if (readyRef.current) contentRef.current = editor.getJSON()
      },
      onUpdate: ({ editor }) => {
        if (readyRef.current) contentRef.current = editor.getJSON()
      },
    },
    [mode, ready],
  )

  // A shared note is edited together over its own channel.
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

  // Stop renewing this person's caret once the note is closed.
  useEffect(() => () => awareness.destroy(), [awareness])

  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      italic: editor?.isActive('italic') ?? false,
    }),
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    // Reading an existing note shouldn't summon the on-screen keyboard.
    if (!focusBody.current) sheetRef.current?.focus()
    const onCancel = (e: Event) => {
      e.preventDefault()
      closeRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [])

  useEffect(() => {
    if (!editor || !ready || !focusBody.current) return
    // The editor may be torn down (mode switch, StrictMode remount) before the frame fires.
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus('end')
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, ready])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const switchMode = (next: NoteMode) => {
    if (next === modeRef.current || !ready) return
    const content = next === 'checklist' ? toChecklist(contentRef.current) : toText(contentRef.current)
    contentRef.current = content
    focusBody.current = true
    // Everyone with the note open switches with it.
    writeBody(doc, next, content, extensionsFor(next, noTag))
  }

  // Labels and shares need a saved note to hang on.
  const ensureSaved = () => {
    if (persisted.current) return
    dirty.current = true
    save()
  }

  const toggleLabel = (labelId: string, on: boolean) => {
    ensureSaved()
    cb.current.onToggleLabel(labelId, on)
  }

  const toggleShare = (userId: string, on: boolean) => {
    ensureSaved()
    cb.current.share?.onToggle(userId, on)
  }

  const closePicker = useCallback(() => setPicking(null), [])

  const selectedLabels = labels.filter(l => labelIds.includes(l.id))
  const here = peers.map(p => cb.current.nameOf(p.userId) || p.name)

  return (
    <dialog
      ref={dialogRef}
      className="editor-dialog"
      aria-label={title || 'Note'}
      onClick={e => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="sheet paper tone-0" ref={sheetRef} tabIndex={-1}>
        <div className="sheet-scroll">
          {pinned ? (
            <h2 className="sheet-title">To do</h2>
          ) : (
            <input
              className="sheet-title"
              placeholder="Title"
              value={title}
              maxLength={200}
              readOnly={!ready}
              onChange={e => setText(titleText(doc), e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
                  e.preventDefault()
                  editor?.commands.focus('start')
                }
              }}
            />
          )}
          <EditorContent editor={editor} className={`sheet-body mode-${mode}${ready ? '' : ' joining'}`} />
          {(selectedLabels.length > 0 || editedAt || here.length > 0) && (
            <div className="sheet-meta">
              <div className="chips">
                {selectedLabels.map(l => (
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
          {!pinned && (
            <>
              <div className="segmented" role="radiogroup" aria-label="Note type">
                <button type="button" role="radio" aria-checked={mode === 'text'} title="Text" onClick={() => switchMode('text')}>
                  <TextIcon size={18} />
                  <span className="hide-sm">Text</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'checklist'}
                  title="Checkboxes"
                  onClick={() => switchMode('checklist')}
                >
                  <ChecklistIcon size={18} />
                  <span className="hide-sm">List</span>
                </button>
              </div>

              <span className="tool-sep" aria-hidden="true" />
            </>
          )}

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
            <>
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
                <button type="button" className="icon-btn" title="Delete" aria-label="Delete note" onClick={() => cb.current.onDelete()}>
                  <TrashIcon size={19} />
                </button>
              )}
            </>
          )}

          <button type="button" className="btn-done" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}

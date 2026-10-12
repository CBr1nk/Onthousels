import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, Node, useEditor, useEditorState, type Extensions } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { isBlank, toChecklist, toText } from '../lib/doc'
import { Hashtags, takeTagBeforeCursor } from '../lib/hashtags'
import type { Label, NoteDraft, NoteMode } from '../lib/types'
import { ChecklistIcon, TagIcon, TextIcon, TrashIcon } from './Icons'
import { LabelPicker } from './LabelPicker'

// In checklist mode the whole note is a single task list.
const ChecklistDoc = Node.create({ name: 'doc', topNode: true, content: 'taskList' })

const sharedKit = { heading: false, code: false, codeBlock: false, blockquote: false, horizontalRule: false, link: false } as const

function extensionsFor(mode: NoteMode, onTag: (name: string) => void): Extensions {
  const placeholder = Placeholder.configure({
    placeholder: mode === 'text' ? 'Begin anywhere…' : 'List item',
    includeChildren: true,
  })
  const hashtags = Hashtags.configure({ onTag })
  if (mode === 'text') return [StarterKit.configure(sharedKit), placeholder, hashtags]
  return [
    StarterKit.configure({
      ...sharedKit,
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
  ]
}

export interface CloseInfo {
  draft: NoteDraft
  dirty: boolean
  persisted: boolean
}

interface Props {
  initial: NoteDraft
  isNew: boolean
  editedAt?: string
  labelIds: string[]
  labels: Label[]
  onSave: (draft: NoteDraft) => void
  onToggleLabel: (labelId: string, on: boolean) => void
  onCreateLabel: (name: string) => Promise<Label | null>
  onDelete: () => void
  onClose: (info: CloseInfo) => void
}

const editedFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function NoteEditor(props: Props) {
  const { initial, isNew, editedAt, labelIds, labels } = props
  const cb = useRef(props)
  cb.current = props

  const [title, setTitle] = useState(initial.title)
  const [mode, setMode] = useState<NoteMode>(initial.mode)
  const [picking, setPicking] = useState(false)

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
  })

  const save = () => {
    window.clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    persisted.current = true
    cb.current.onSave(draft())
  }

  // Autosave shortly after the writer pauses.
  const touch = () => {
    dirty.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 700)
  }

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
    const label = await cb.current.onCreateLabel(name)
    if (label && !cb.current.labelIds.includes(label.id)) toggleLabel(label.id, true)
  }
  const addTagRef = useRef(addTag)
  addTagRef.current = addTag

  const editor = useEditor(
    {
      extensions: extensionsFor(mode, name => addTagRef.current(name)),
      content: contentRef.current,
      editorProps: { attributes: { class: 'prose editor-prose', 'aria-label': 'Note' } },
      onUpdate: ({ editor }) => {
        contentRef.current = editor.getJSON()
        touch()
      },
    },
    [mode],
  )

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
    if (!editor || !focusBody.current) return
    // The editor may be torn down (mode switch, StrictMode remount) before the frame fires.
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus('end')
    })
    return () => cancelAnimationFrame(frame)
  }, [editor])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const switchMode = (next: NoteMode) => {
    if (next === modeRef.current) return
    contentRef.current = next === 'checklist' ? toChecklist(contentRef.current) : toText(contentRef.current)
    modeRef.current = next
    focusBody.current = true
    setMode(next)
    touch()
  }

  const toggleLabel = (labelId: string, on: boolean) => {
    // A label needs a saved note to hang on.
    if (!persisted.current) {
      dirty.current = true
      save()
    }
    cb.current.onToggleLabel(labelId, on)
  }

  const closePicker = useCallback(() => setPicking(false), [])

  const selectedLabels = labels.filter(l => labelIds.includes(l.id))

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
          <input
            className="sheet-title"
            placeholder="Title"
            value={title}
            maxLength={200}
            onChange={e => {
              setTitle(e.target.value)
              titleRef.current = e.target.value
              touch()
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
          />
          <EditorContent editor={editor} className={`sheet-body mode-${mode}`} />
          {(selectedLabels.length > 0 || editedAt) && (
            <div className="sheet-meta">
              <div className="chips">
                {selectedLabels.map(l => (
                  <button key={l.id} type="button" className="chip chip-btn" title="Remove label" onClick={() => toggleLabel(l.id, false)}>
                    {l.name} <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
              {editedAt && <span className="edited">Edited {editedFormat.format(new Date(editedAt))}</span>}
            </div>
          )}
        </div>

        <div className="sheet-tools" role="toolbar" aria-label="Note tools">
          <div className="segmented" role="radiogroup" aria-label="Note type">
            <button type="button" role="radio" aria-checked={mode === 'text'} title="Text" onClick={() => switchMode('text')}>
              <TextIcon size={18} />
              <span className="hide-sm">Text</span>
            </button>
            <button type="button" role="radio" aria-checked={mode === 'checklist'} title="Checkboxes" onClick={() => switchMode('checklist')}>
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

          <div className="anchor">
            <button
              type="button"
              className={`icon-btn${picking ? ' on' : ''}`}
              title="Labels"
              aria-label="Labels"
              aria-expanded={picking}
              onClick={() => setPicking(p => !p)}
            >
              <TagIcon size={19} />
            </button>
            {picking && (
              <LabelPicker
                labels={labels}
                selected={labelIds}
                onToggle={toggleLabel}
                onCreate={name => cb.current.onCreateLabel(name)}
                onClose={closePicker}
              />
            )}
          </div>

          <button type="button" className="icon-btn" title="Delete" aria-label="Delete note" onClick={() => cb.current.onDelete()}>
            <TrashIcon size={19} />
          </button>

          <button type="button" className="btn-done" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}

import { Extension, type Editor, type JSONContent } from '@tiptap/react'
import { TaskItem } from '@tiptap/extension-list'
import { buildTasks, flattenTasks, type FlatTask } from './doc'

/** A checklist item with a grip on its left for dragging it about (see attachTaskDrag). */
export const DraggableTaskItem = TaskItem.extend({
  addOptions() {
    // Marked, so the drag can find the items on screen (the plain node view leaves them unmarked).
    return { ...this.parent!(), HTMLAttributes: { 'data-type': 'taskItem' } }
  },
  addNodeView() {
    const make = this.parent?.()
    if (!make) return null
    return props => {
      const view = make(props)
      const grip = document.createElement('span')
      grip.className = 'task-grip'
      grip.contentEditable = 'false'
      grip.setAttribute('aria-hidden', 'true')
      ;(view.dom as HTMLElement).prepend(grip)
      return {
        ...view,
        // The drag marks the item it's moving with a class. Left to itself, ProseMirror would take
        // that for an edit and redraw the item, replacing the grip mid-drag and losing the pointer.
        ignoreMutation: (m: { type: string; target?: Node; attributeName?: string | null }) =>
          m.type === 'attributes' && m.target === view.dom && m.attributeName === 'class',
      }
    }
  },
})

/** Tab and Shift+Tab nest and un-nest items, and never send the cursor out of the note. */
export const TaskKeys = Extension.create({
  name: 'taskKeys',
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.sinkListItem('taskItem') || true,
      'Shift-Tab': () => this.editor.commands.liftListItem('taskItem') || true,
    }
  },
})

/** Adds an empty item at the end of the list, unless the last one is empty already. */
export function appendBlankItem(editor: Editor) {
  const list = editor.state.doc.firstChild
  if (!list || list.type.name !== 'taskList') return
  const last = list.lastChild
  if (last && last.childCount === 1 && last.textContent.trim() === '') return
  const { taskItem, paragraph } = editor.schema.nodes
  editor.view.dispatch(editor.state.tr.insert(list.nodeSize - 1, taskItem.create({ checked: false }, paragraph.create())))
}

/** Replaces the whole checklist (e.g. after a drag). */
export function setTasks(editor: Editor, doc: JSONContent) {
  const node = editor.schema.nodeFromJSON(doc)
  editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content))
}

/** The row an item's checkbox sits on, without the items nested under it. */
const rowOf = (li: HTMLElement) => (li.querySelector(':scope > label') ?? li).getBoundingClientRect()

/**
 * The editor's element on screen, or null while it isn't mounted. (The editor is put on screen by
 * <EditorContent> after it's created, and taken off and put back during React's StrictMode checks;
 * until then, reaching for its view throws.)
 */
export function editorDom(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) return null
  try {
    return editor.view.dom as HTMLElement
  } catch {
    return null
  }
}

/** Runs `fn` with the editor's element once it's on screen (straight away if it already is). Returns a cancel function. */
export function whenMounted(editor: Editor, fn: (dom: HTMLElement) => void) {
  const dom = editorDom(editor)
  if (dom) {
    fn(dom)
    return () => {}
  }
  const onMount = () => {
    const el = editorDom(editor)
    if (el) fn(el)
  }
  editor.once('mount', onMount)
  return () => editor.off('mount', onMount)
}

/**
 * Dragging an item by its grip moves it, with the items nested under it: up and down to reorder,
 * left and right to un-nest and nest. A line shows where it will land. Works with a mouse, a pen
 * or a finger. Listens whenever the editor is on screen; returns a function that stops listening.
 */
export function attachTaskDrag(editor: Editor) {
  let attached: HTMLElement | null = null
  const attach = () => {
    detach()
    attached = editorDom(editor)
    attached?.addEventListener('pointerdown', onDown)
  }
  const detach = () => {
    attached?.removeEventListener('pointerdown', onDown)
    attached = null
  }

  const onDown = (e: PointerEvent) => {
    const dom = e.currentTarget as HTMLElement
    const grip = (e.target as HTMLElement).closest?.('.task-grip') as HTMLElement | null
    if (!grip || !editor.isEditable || e.button > 0) return
    const li = grip.closest('li[data-type="taskItem"]') as HTMLElement | null
    const els = [...dom.querySelectorAll<HTMLElement>('li[data-type="taskItem"]')]
    const flat = flattenTasks(editor.getJSON())
    const from = li ? els.indexOf(li) : -1
    // The screen and the document should list the same items; if not, leave well alone.
    if (from < 0 || flat.length !== els.length) return
    e.preventDefault()

    let end = from + 1
    while (end < flat.length && flat[end].depth > flat[from].depth) end++
    const moving = flat.slice(from, end)
    const rest = [...flat.slice(0, from), ...flat.slice(end)]
    const restEls = [...els.slice(0, from), ...els.slice(end)]
    const baseDepth = flat[from].depth

    const body = dom.parentElement!
    const scroller = dom.closest('.sheet-scroll') as HTMLElement | null
    const top = dom.querySelector<HTMLElement>(':scope > ul[data-type="taskList"]')!
    // How far one level of nesting sits in from the last.
    const indent = parseFloat(getComputedStyle(dom).fontSize) * 1.6
    const startX = e.clientX
    const line = document.createElement('div')
    line.className = 'task-drop'
    body.append(line)
    li!.classList.add('task-dragging')
    try {
      grip.setPointerCapture(e.pointerId)
    } catch {
      // The pointer is already gone (released before this ran); the drag simply won't follow it.
    }

    let target: { index: number; depth: number } | null = null

    const onMove = (ev: PointerEvent) => {
      // Near the top or bottom of the sheet, scroll it along.
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        if (ev.clientY < r.top + 40) scroller.scrollTop -= 10
        else if (ev.clientY > r.bottom - 40) scroller.scrollTop += 10
      }
      let index = restEls.findIndex(el => {
        const r = rowOf(el)
        return ev.clientY < r.top + r.height / 2
      })
      if (index < 0) index = rest.length
      const prev = rest[index - 1]
      const next = rest[index]
      // As deep as one more than the item above, and no shallower than the one below needs.
      const max = prev ? prev.depth + 1 : 0
      const min = next ? Math.max(0, next.depth - 1) : 0
      const depth = Math.min(max, Math.max(min, baseDepth + Math.round((ev.clientX - startX) / indent)))
      target = { index, depth }

      const b = body.getBoundingClientRect()
      const y = next ? rowOf(restEls[index]).top : top.getBoundingClientRect().bottom
      const left = top.getBoundingClientRect().left - b.left + depth * indent
      line.style.top = `${y - b.top - 1}px`
      line.style.left = `${left}px`
      line.style.width = `${Math.max(40, b.width - left)}px`
    }

    const finish = (drop: boolean) => {
      grip.removeEventListener('pointermove', onMove)
      grip.removeEventListener('pointerup', onUp)
      grip.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      line.remove()
      li!.classList.remove('task-dragging')
      if (!drop || !target) return
      const delta = target.depth - baseDepth
      const moved: FlatTask[] = moving.map(m => ({ ...m, depth: m.depth + delta }))
      const next = [...rest.slice(0, target.index), ...moved, ...rest.slice(target.index)]
      if (target.index === from && delta === 0) return
      setTasks(editor, buildTasks(next))
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(false)

    grip.addEventListener('pointermove', onMove)
    grip.addEventListener('pointerup', onUp)
    grip.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
  }

  attach()
  editor.on('mount', attach)
  editor.on('unmount', detach)
  return () => {
    editor.off('mount', attach)
    editor.off('unmount', detach)
    detach()
  }
}

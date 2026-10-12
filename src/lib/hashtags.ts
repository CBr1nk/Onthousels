import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension, InputRule, type Editor } from '@tiptap/react'

// "#ideas" counts as a tag when it starts a line or follows whitespace (so "C#" or
// "page#3" are left alone) and begins with a letter (so "#1 priority" is too).
const NAME = String.raw`#(\p{L}[\p{L}\p{N}_-]{0,49})`
const TAG_TYPED = new RegExp(String.raw`(^|\s)${NAME}\s$`, 'u')
const TAG_AT_END = new RegExp(String.raw`(^|\s)${NAME}$`, 'u')
const NAME_REST = /^[\p{L}\p{N}_-]*/u

/** The tag being typed right before the cursor, if any. */
function tagAtCursor(state: EditorState) {
  const $cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null
  if (!$cursor) return null
  const before = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, '\n')
  const m = TAG_AT_END.exec(before)
  if (!m) return null
  return { name: m[2], from: $cursor.pos - m[2].length - 1, lead: m[1].length, cursor: $cursor }
}

/**
 * Typing "#ideas" followed by a space or Enter lifts the tag out of the text and
 * hands its name to `onTag`, which files the note under that label. Until then the
 * tag shows in bold so it's clear it will become a label.
 */
export const Hashtags = Extension.create<{ onTag: (name: string) => void }>({
  name: 'hashtags',
  // Run ahead of the list keymaps so Enter after a tag is ours, not a new item.
  priority: 1000,

  addOptions() {
    return { onTag: () => {} }
  },

  addInputRules() {
    return [
      new InputRule({
        find: TAG_TYPED,
        handler: ({ state, range, match }) => {
          // Keep the whitespace before the tag; drop the tag and the key that ended it.
          state.tr.delete(range.from + match[1].length, range.to)
          this.options.onTag(match[2])
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('hashtagTyping'),
        props: {
          // A decoration, not a mark: the bold is only on screen and never saved.
          decorations: state => {
            const tag = tagAtCursor(state)
            if (!tag) return null
            const { parent, parentOffset, pos } = tag.cursor
            const after = parent.textBetween(parentOffset, parent.content.size, undefined, '\n')
            const to = pos + NAME_REST.exec(after)![0].length
            return DecorationSet.create(state.doc, [Decoration.inline(tag.from, to, { class: 'tag-typing' })])
          },
        },
      }),
    ]
  },
})

/** Removes a tag sitting right before the cursor (one never finished with space or Enter) and returns its name. */
export function takeTagBeforeCursor(editor: Editor): string | null {
  const tag = tagAtCursor(editor.state)
  if (!tag) return null
  editor.view.dispatch(editor.state.tr.delete(tag.from - tag.lead, tag.cursor.pos))
  return tag.name
}

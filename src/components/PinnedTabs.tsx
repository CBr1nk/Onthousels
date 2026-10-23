import { useCallback, useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import type { Person } from '../lib/collab'
import { countDone, plainText } from '../lib/doc'
import type { NoteMode } from '../lib/types'
import { PencilIcon, PeopleIcon, PersonIcon, PlusIcon } from './Icons'
import { NoteRenderer } from './NoteRenderer'
import { SharePicker, type ShareInfo } from './SharePicker'
import { ArrangeTabs, NewTabForm, type ArrangeItem } from './TabTools'

/** Mine: tabs only this person sees. Shared: tabs shared with friends, either way. */
export type TabView = 'mine' | 'shared'

export interface PinnedPage {
  id: string
  name: string
  /** For a friend's tab: their name. */
  owner?: string
  mode: NoteMode
  content: JSONContent
  shared: boolean
  share: ShareInfo
}

interface Props {
  view: TabView
  onView: (view: TabView) => void
  /** The tabs in this view. */
  pages: PinnedPage[]
  active?: PinnedPage
  friends: Person[]
  onSelect: (id: string) => void
  onOpen: () => void
  onAdd: (name: string, mode: NoteMode, friendIds: string[]) => void
  onRename: (id: string, name: string) => void
  onReorder: (ids: string[]) => void
  onDelete: (item: ArrangeItem) => void
  onToggleTask: (index: number) => void
  onClearDone: () => void
}

/**
 * Notes pinned above the desk as tabs: lists and pages this person keeps coming back to.
 * They're split into their own and the ones shared with friends, so family things and
 * private things don't crowd each other.
 */
export function PinnedTabs(props: Props) {
  const { view, pages, active, friends } = props
  const [picking, setPicking] = useState<'share' | 'add' | 'arrange' | null>(null)
  const closePicker = useCallback(() => setPicking(null), [])

  const done = active?.mode === 'checklist' ? countDone(active.content) : 0
  const empty = active && plainText(active.content).trim() === ''

  const open = () => active && props.onOpen()

  return (
    <section
      className="card paper pinned"
      tabIndex={0}
      aria-label="Pinned"
      onClick={open}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }}
    >
      {/* The header's own controls never open the page beneath them. */}
      <header className="pinned-head" onClick={e => e.stopPropagation()}>
        <div className="segmented pinned-view" role="radiogroup" aria-label="Which tabs">
          <button
            type="button"
            role="radio"
            aria-checked={view === 'mine'}
            onClick={() => {
              setPicking(null)
              props.onView('mine')
            }}
          >
            <PersonIcon size={16} />
            Mine
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === 'shared'}
            onClick={() => {
              setPicking(null)
              props.onView('shared')
            }}
          >
            <PeopleIcon size={16} />
            Shared
          </button>
        </div>
        <div className="pinned-actions">
          {done > 0 && (
            <button type="button" className="link-btn" onClick={props.onClearDone}>
              Clear {done}
              <span className="hide-sm"> done</span>
            </button>
          )}
          {pages.length > 0 && (
            <div className="anchor">
              <button
                type="button"
                className={`icon-btn${picking === 'arrange' ? ' on' : ''}`}
                title="Arrange tabs"
                aria-label="Arrange tabs"
                aria-expanded={picking === 'arrange'}
                onClick={() => setPicking(p => (p === 'arrange' ? null : 'arrange'))}
              >
                <PencilIcon size={17} />
              </button>
              {picking === 'arrange' && (
                <ArrangeTabs
                  heading={view === 'shared' ? 'Shared tabs' : 'My tabs'}
                  items={pages.map(p => ({ id: p.id, name: p.name, removeOnly: Boolean(p.owner) }))}
                  onRename={props.onRename}
                  onReorder={props.onReorder}
                  onDelete={props.onDelete}
                  onClose={closePicker}
                />
              )}
            </div>
          )}
          {active && (
            <div className="anchor">
              <button
                type="button"
                className={`icon-btn${picking === 'share' || active.shared ? ' on' : ''}`}
                title="Share"
                aria-label={`Share ${active.name}`}
                aria-expanded={picking === 'share'}
                onClick={() => setPicking(p => (p === 'share' ? null : 'share'))}
              >
                <PeopleIcon size={19} />
              </button>
              {picking === 'share' && <SharePicker {...active.share} below onClose={closePicker} />}
            </div>
          )}
        </div>
      </header>

      <div className="pinned-row" onClick={e => e.stopPropagation()}>
        {pages.length > 0 && (
          <div className="pinned-tabs" role="tablist" aria-label={view === 'shared' ? 'Shared tabs' : 'My tabs'}>
            {pages.map(p => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === active?.id}
                className="pinned-tab"
                title={p.owner ? `Shared by ${p.owner}` : undefined}
                onClick={() => {
                  setPicking(null)
                  props.onSelect(p.id)
                }}
              >
                {p.name}
                {p.owner && <span className="pinned-owner">· {p.owner}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="anchor">
          <button
            type="button"
            className={`pinned-tab pinned-add${picking === 'add' ? ' on' : ''}`}
            aria-label="New tab"
            title="New tab"
            aria-expanded={picking === 'add'}
            onClick={() => setPicking(p => (p === 'add' ? null : 'add'))}
          >
            <PlusIcon size={16} />
            {pages.length === 0 && 'New tab'}
          </button>
          {picking === 'add' && (
            <NewTabForm
              noun="tab"
              friends={friends}
              shareByDefault={view === 'shared'}
              onAdd={(name, mode, ids) => {
                setPicking(null)
                props.onAdd(name, mode, ids)
              }}
              onClose={closePicker}
            />
          )}
        </div>
      </div>

      {!active ? (
        <p className="pinned-empty">
          {view === 'mine'
            ? 'Pin the lists and pages you keep coming back to. Tap + to add a tab.'
            : friends.length
              ? 'Tabs you share with family and friends, and ones they share with you, gather here.'
              : 'Add friends from the menu, then share tabs with them here.'}
        </p>
      ) : empty ? (
        <p className="pinned-empty">{active.mode === 'checklist' ? 'Nothing on the list. Tap to add something.' : 'Nothing here yet. Tap to write.'}</p>
      ) : (
        <div className="card-body">
          <NoteRenderer doc={active.content} onToggleTask={props.onToggleTask} />
        </div>
      )}
    </section>
  )
}

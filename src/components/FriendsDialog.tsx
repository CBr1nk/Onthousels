import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Friend } from '../lib/types'
import { CloseIcon, PencilIcon, TrashIcon } from './Icons'

interface Props {
  friends: Friend[]
  myEmail: string
  onAdd: (email: string, name: string) => Promise<boolean>
  onAnswer: (id: string, accept: boolean, name?: string) => Promise<boolean>
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Friends are people notes can be shared with. Each side names the other however they like. */
export function FriendsDialog({ friends, myEmail, onAdd, onAnswer, onRename, onRemove, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  // Names typed against incoming requests, ready for Accept.
  const [answers, setAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const onCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [onClose])

  const asking = friends.filter(f => f.incoming && f.status === 'pending')
  const current = friends.filter(f => f.status === 'accepted')
  // Requests this person sent that haven't been accepted. Ones they turned down themselves stay out of sight.
  const waiting = friends.filter(f => !f.incoming && f.status !== 'accepted')

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!EMAIL.test(address)) return setProblem('That doesn’t look like an email address.')
    if (address === myEmail.toLowerCase()) return setProblem('That’s your own address.')
    setProblem('')
    setBusy(true)
    const ok = await onAdd(address, name)
    setBusy(false)
    if (!ok) return
    setSent(name.trim() || address)
    setName('')
    setEmail('')
  }

  const label = (f: Friend) => f.name || f.email

  return (
    <dialog
      ref={dialogRef}
      className="editor-dialog"
      aria-label="Friends"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet paper tone-0 friends">
        <div className="sheet-scroll">
          <header className="friends-head">
            <h2 className="sheet-title">Friends</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          </header>
          <p className="friends-lede">Share a note with a friend and you can both write in it at the same time.</p>

          <form className="friend-add" onSubmit={add}>
            <label className="field">
              <span>Name</span>
              <input value={name} maxLength={60} placeholder="Lisa" onChange={e => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                value={email}
                placeholder="lisa@example.com"
                autoComplete="off"
                onChange={e => {
                  setEmail(e.target.value)
                  setProblem('')
                  setSent('')
                }}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            {problem ? (
              <p className="welcome-error">{problem}</p>
            ) : sent ? (
              <p className="friends-hint">Asked {sent}. They’ll see it when they sign in to Onthousels with that address.</p>
            ) : null}
          </form>

          {asking.length > 0 && (
            <section className="friend-group" aria-label="Asking you">
              <h3 className="nav-heading">Asking you</h3>
              {asking.map(f => (
                <div key={f.id} className="friend-request">
                  <p className="friend-email">
                    <strong>{f.email}</strong> would like to share notes.
                  </p>
                  <div className="friend-answer">
                    <input
                      className="friend-name-input"
                      placeholder="Their name"
                      maxLength={60}
                      aria-label={`Name for ${f.email}`}
                      value={answers[f.id] ?? ''}
                      onChange={e => setAnswers(a => ({ ...a, [f.id]: e.target.value }))}
                    />
                    <button type="button" className="link-btn" onClick={() => onAnswer(f.id, true, answers[f.id])}>
                      Accept
                    </button>
                    <button type="button" className="link-btn muted" onClick={() => onAnswer(f.id, false)}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {current.length > 0 && (
            <section className="friend-group" aria-label="Friends">
              <h3 className="nav-heading">Friends</h3>
              {current.map(f => (
                <div key={f.id} className="label-edit friend-row">
                  <PencilIcon size={16} />
                  <div className="friend-who">
                    <input
                      defaultValue={f.name}
                      placeholder={f.email}
                      maxLength={60}
                      aria-label={`Rename ${label(f)}`}
                      onBlur={e => e.target.value.trim() !== f.name && onRename(f.id, e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                    {f.name && <span className="friend-email">{f.email}</span>}
                  </div>
                  {confirming === f.id ? (
                    <button type="button" className="link-btn danger" onClick={() => onRemove(f.id)}>
                      Remove?
                    </button>
                  ) : (
                    <button type="button" className="icon-btn" aria-label={`Remove ${label(f)}`} onClick={() => setConfirming(f.id)}>
                      <TrashIcon size={16} />
                    </button>
                  )}
                </div>
              ))}
              <p className="nav-hint">Removing a friend stops sharing notes between you.</p>
            </section>
          )}

          {waiting.length > 0 && (
            <section className="friend-group" aria-label="Waiting">
              <h3 className="nav-heading">Waiting</h3>
              {waiting.map(f => (
                <div key={f.id} className="friend-row friend-waiting">
                  <div className="friend-who">
                    <span>{label(f)}</span>
                    {f.name && <span className="friend-email">{f.email}</span>}
                  </div>
                  <span className="friend-status">{f.status === 'declined' ? 'Declined' : 'Not yet answered'}</span>
                  <button type="button" className="link-btn" onClick={() => onRemove(f.id)}>
                    {f.status === 'declined' ? 'Clear' : 'Cancel'}
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </dialog>
  )
}

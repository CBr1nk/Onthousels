import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup'

export function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) setError(error.message === 'User already registered' ? 'There’s already an account with that email.' : error.message)
      // With email confirmation on, Supabase returns no session until the link is followed.
      else if (!data.session) setNotice('Check your inbox for a link to confirm your email, then sign in.')
    }
    setBusy(false)
  }

  const switchMode = () => {
    setMode(m => (m === 'signin' ? 'signup' : 'signin'))
    setError(null)
    setNotice(null)
  }

  return (
    <main className="welcome">
      <div className="welcome-card paper tone-0">
        <h1 className="brand-big">Onthousels</h1>
        <p className="welcome-line">A quiet place for the things you want to keep.</p>

        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {error && (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="welcome-notice" role="status">
            {notice}
          </p>
        )}

        <p className="welcome-switch">
          {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
          <button type="button" className="link-btn" onClick={switchMode}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </main>
  )
}

export function SetupNeeded() {
  return (
    <main className="welcome">
      <div className="welcome-card paper tone-0">
        <h1 className="brand-big">Almost there</h1>
        <p className="welcome-line">
          Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase URL and anon key, then restart the dev server.
        </p>
      </div>
    </main>
  )
}

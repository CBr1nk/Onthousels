import { useEffect, useState } from 'react'
import { isAuthRetryableFetchError, type Session, type User } from '@supabase/supabase-js'
import { Home } from './components/Home'
import { Login, SetupNeeded } from './components/Login'
import { useTheme } from './hooks/useTheme'
import { recallUser, rememberUser } from './lib/offline'
import { isConfigured, supabase } from './lib/supabase'

export default function App() {
  const { theme, toggle } = useTheme()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  // Who was signed in last, while their session can't be refreshed for want of a connection.
  const [offlineUser, setOfflineUser] = useState<User | null>(null)

  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data, error }) => {
      if (!data.session && ((error && isAuthRetryableFetchError(error)) || !navigator.onLine)) setOfflineUser(recallUser())
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s) {
        rememberUser(s.user)
        setOfflineUser(null)
      } else if (event === 'SIGNED_OUT') {
        setOfflineUser(null)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!isConfigured) return <SetupNeeded />
  const user = session?.user ?? offlineUser
  if (session === undefined && !user) return null // brief: restoring the session from storage
  if (!user) return <Login />
  // Keyed by user so signing in as someone else starts from a clean slate.
  return <Home key={user.id} user={user} theme={theme} onToggleTheme={toggle} />
}

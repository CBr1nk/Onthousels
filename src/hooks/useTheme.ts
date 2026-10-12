import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'onthousels-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function initialTheme(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'light' || set === 'dark') return set
  return media().matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  // Follow the system until the person picks a theme themselves.
  useEffect(() => {
    const mq = media()
    const onChange = () => {
      if (!document.documentElement.dataset.theme) setTheme(mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can be unavailable (private mode); the choice just won't persist.
    }
    setTheme(next)
  }

  return { theme, toggle }
}

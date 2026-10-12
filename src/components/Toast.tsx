import { useEffect } from 'react'

export interface ToastData {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(onDone, 6000)
    return () => window.clearTimeout(t)
  }, [toast, onDone])

  if (!toast) return null
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            toast.action!.run()
            onDone()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

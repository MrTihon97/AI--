import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  tone = 'default',
  onConfirm,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const confirmClass =
    tone === 'danger'
      ? 'rounded-full bg-rose-500 px-5 py-2.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(244,63,94,0.35)] transition hover:brightness-105'
      : 'btn-glow rounded-full px-5 py-2.5 text-sm font-bold'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={onClose}
    >
      <div
        className="soft-card w-full max-w-md rounded-[22px] p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                tone === 'danger'
                  ? 'bg-rose-50 text-rose-500'
                  : 'bg-blue-50 text-brand'
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="confirm-modal-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={confirmClass}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { DailyTask } from '../types'

interface Props {
  tasks: DailyTask[]
  busyId?: string | null
  onToggle: (taskId: string) => void
}

export function DailyPlanChecklist({ tasks, busyId, onToggle }: Props) {
  const doneCount = tasks.filter((t) => t.done).length
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0

  return (
    <section className="soft-card flex h-full flex-col rounded-[22px] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            План на сегодня
          </h2>
          <p className="text-xs text-slate-500">Нажмите задачу, чтобы отметить</p>
        </div>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold tabular-nums text-brand ring-1 ring-blue-100">
          {doneCount}/{tasks.length}
        </span>
      </div>

      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ul className="space-y-2.5">
        {tasks.map((task) => {
          const busy = busyId === task.id
          return (
            <li key={task.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onToggle(task.id)}
                className={`flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left transition hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)] disabled:opacity-70 ${
                  task.done
                    ? 'bg-emerald-50/80 ring-1 ring-emerald-100'
                    : 'bg-white ring-1 ring-slate-100 hover:ring-blue-100'
                }`}
              >
                {busy ? (
                  <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-brand" />
                ) : task.done ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
                )}
                <span
                  className={`text-sm leading-snug ${
                    task.done ? 'text-slate-500 line-through' : 'text-slate-700'
                  }`}
                >
                  {task.title}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

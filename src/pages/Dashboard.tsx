import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, Play, RotateCcw } from 'lucide-react'
import {
  getDashboardData,
  getHistoryFeedback,
  resetProgress,
  toggleDailyTask,
} from '../services/api'
import type { DashboardData, RoleplayHistoryItem } from '../types'
import { DashboardSkeleton, Skeleton } from '../components/Skeleton'
import { ManagerHeader } from '../components/ManagerHeader'
import { SkillCards } from '../components/SkillCards'
import { DailyPlanChecklist } from '../components/DailyPlanChecklist'
import { RoleplayHistoryList } from '../components/RoleplayHistoryList'

const ScoreChart = lazy(() =>
  import('../components/ScoreChart').then((m) => ({ default: m.ScoreChart })),
)

export function Dashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [openingHistory, setOpeningHistory] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getDashboardData())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleToggleTask = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      setData(await toggleDailyTask(taskId))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось обновить задачу')
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleOpenHistory = async (item: RoleplayHistoryItem) => {
    setOpeningHistory(true)
    try {
      const session = await getHistoryFeedback(item.id)
      navigate('/feedback', {
        state: { ...session, fromHistory: true },
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось открыть разбор')
    } finally {
      setOpeningHistory(false)
    }
  }

  if (loading) return <DashboardSkeleton />

  if (error || !data) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
          <AlertCircle className="h-6 w-6" />
        </div>
        <p className="font-display font-semibold text-slate-900">
          Не удалось загрузить дашборд
        </p>
        <p className="mt-1 text-sm text-slate-500">{error ?? 'Нет данных'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-glow mt-5 rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          Повторить
        </button>
      </div>
    )
  }

  const { manager, history, product } = data

  return (
    <div className="relative mx-auto max-w-6xl space-y-5 px-4 py-6 pb-24 sm:py-8 sm:pb-8">
      {openingHistory && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/50 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
        </div>
      )}

      <ManagerHeader manager={manager} product={product} />
      <SkillCards stages={manager.stages} />
      <Suspense fallback={<Skeleton className="h-72 rounded-[22px]" />}>
        <ScoreChart history={history} />
      </Suspense>

      <div className="animate-fade-up stagger-3 grid gap-4 lg:grid-cols-2">
        <DailyPlanChecklist
          tasks={manager.dailyPlan}
          busyId={busyTaskId}
          onToggle={(id) => void handleToggleTask(id)}
        />
        <RoleplayHistoryList
          history={history}
          onOpen={(item) => void handleOpenHistory(item)}
        />
      </div>

      <div className="sticky bottom-4 z-10 sm:hidden">
        <Link
          to="/roleplay"
          className="btn-glow flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-base font-bold"
        >
          <Play className="h-5 w-5 fill-white" />
          Начать новую ролёвку
        </Link>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (confirm('Сбросить прогресс к исходным мокам?')) {
              resetProgress()
              void load()
            }
          }}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-600"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Сбросить прогресс к мокам
        </button>
      </div>
    </div>
  )
}

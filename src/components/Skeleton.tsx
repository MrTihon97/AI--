export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[20px] bg-slate-200/70 ${className}`}
      aria-hidden
    />
  )
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8" aria-busy="true">
      <Skeleton className="h-[88px] w-full rounded-[22px]" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-[22px]" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-[22px]" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64 rounded-[22px]" />
        <Skeleton className="h-64 rounded-[22px]" />
      </div>
    </div>
  )
}

export function RoleplaySkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-[22px]" />
        <Skeleton className="h-44 rounded-[22px]" />
      </div>
    </div>
  )
}

/** Полный скелетон экрана выбора клиента (для early return). */
export function RoleplayPageSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8" aria-busy="true">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <RoleplaySkeleton />
    </div>
  )
}

export function FeedbackSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8" aria-busy="true">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-48 w-full rounded-[22px]" />
      <Skeleton className="h-64 w-full rounded-[22px]" />
      <Skeleton className="h-52 w-full rounded-[22px]" />
      <Skeleton className="h-14 w-full rounded-full" />
    </div>
  )
}

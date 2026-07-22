export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-[20px] bg-slate-200/70 ${className}`} aria-hidden />
  )
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <Skeleton className="h-[88px] w-full rounded-[22px]" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  )
}

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`bg-gradient-to-r from-line via-app to-line bg-[length:400px_100%] animate-shimmer rounded-md ${className}`}
      style={style}
    />
  )
}

export function PageSkeleton({ title }: { title: string }) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">{title}</h1>
          <Skeleton className="h-4 w-48 mt-2" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <Skeleton className="h-14 w-full rounded-2xl mb-5" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

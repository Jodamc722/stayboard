import { Shell } from '@/components/Shell'
import { Skeleton } from '@/components/Skeleton'

export default function Loading() {
  return (
    <Shell>
      <div className="animate-fade-in">
        <div className="mb-8">
          <Skeleton className="h-3 w-32 mb-2" />
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-7">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    </Shell>
  )
}

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-[32rem]" />
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
      <Skeleton className="h-40" />
    </div>
  );
}

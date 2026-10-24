import { Skeleton } from "@/components/ui/primitives";
export default function Loading() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[228px] border-r bg-card p-6 md:block">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="mt-10 h-14 w-full" />
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton className="mt-4 h-8 w-full" key={i} />
        ))}
      </aside>
      <main className="flex-1 space-y-7 p-8">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton className="h-28" key={i} />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </main>
    </div>
  );
}

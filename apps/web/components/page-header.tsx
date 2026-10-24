import { Badge } from "./ui/primitives";
export function PageHeader({
  title,
  description,
  children,
  badge,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-.9px]">
            {title}
          </h1>
          {badge && <Badge tone="purple">{badge}</Badge>}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

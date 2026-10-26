"use client";
import {
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  MoreHorizontal,
  Settings2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Checkbox } from "./ui/checkbox";
import { EmptyState, ErrorState, FormSelect } from "./ui/primitives";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from "./ui/table";

/**
 * The dashboard's table foundation (TanStack Table, headless).
 *
 * Every history-sized dataset in Orbit is fetched from the API a page at a time,
 * and the API owns ordering and filtering (`GET /api/guilds/:id/history`). The
 * table therefore runs TanStack in **manual** modes: it renders the rows it is
 * given, reports sort/page intent, and never sorts or slices a page in the
 * browser — sorting one page of 7 results and calling it "sorted by date" would
 * misrepresent the 900 rows the reader cannot see.
 *
 * One table component, no option soup: the capabilities enabled here are the
 * ones every history screen needs. A screen that needs something else composes
 * its own toolbar (as the resource lists do) instead of growing this signature.
 */
const features = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
});
type TableFeatures = typeof features;

export type DataColumn<T> = {
  /** Stable column id; also the key for the visibility menu. */
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  /** Server field name. Present only when the API can sort by it. */
  sortKey?: string;
  /**
   * Sort value for a fully-loaded client list. Only used when the table has no
   * server `sort` prop, so a server-paginated table can never pretend to sort
   * rows it has not fetched.
   */
  sortValue?: (row: T) => string | number;
  /** Listed in the columns menu but hidden until the reader enables it. */
  defaultHidden?: boolean;
  /** Columns that carry the row's identity stay visible. */
  canHide?: boolean;
  header?: React.ReactNode;
};

export type DataTableSort = {
  field: string;
  dir: "asc" | "desc";
  onChange: (field: string) => void;
};

export type DataTableProps<T extends { id: string }> = {
  rows: T[];
  columns: DataColumn<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
  /** Rows per page. Server default is 7; a caller may align with the API. */
  pageSize?: number;
  /** Server pagination. Omit for a small, fully-loaded list. */
  pagination?: {
    page: number;
    total: number;
    onPage: (page: number) => void;
    onPageSize?: (size: number) => void;
  };
  /** Server sorting. Changing it must reset the page in the same update. */
  sort?: DataTableSort;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** Accessible name for the scrollable region around the table. */
  label?: string;
  /** Optional row-selection state, only for tables with a real bulk action. */
  selection?: {
    selected: string[];
    onChange: (ids: string[]) => void;
    /** Accessible name of the leading checkbox. */
    label?: string;
  };
  /** Per-row overflow menu rendered in a trailing cell. */
  rowActions?: {
    label: (row: T) => string;
    items: (
      row: T
    ) => { label: string; icon?: React.ReactNode; onSelect: () => void }[];
  };
  /** Extra toolbar content rendered above the table, inside its card. */
  toolbar?: React.ReactNode;
};

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  emptyTitle = "Nothing here just yet",
  emptyDescription = "New activity will appear here as your community gets going.",
  pageSize = 7,
  pagination,
  sort,
  loading = false,
  error = "",
  onRetry,
  label,
  selection,
  rowActions,
  toolbar,
}: DataTableProps<T>) {
  const [hidden, setHidden] = useState<string[]>(() =>
    columns.filter((c) => c.defaultHidden).map((c) => c.key)
  );

  // Every column is a display column: the server owns ordering, so no accessor
  // is needed and the definition type stays uniform.
  const columnDefs = useMemo<ColumnDef<TableFeatures, T>[]>(() => {
    const defs: ColumnDef<TableFeatures, T>[] = columns.map((column) => ({
      id: column.key,
      header: () => column.header ?? column.label,
      cell: ({ row }) => column.render(row.original),
      enableSorting: false,
      enableHiding: column.canHide !== false,
    }));
    if (rowActions) {
      defs.push({
        id: "__actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <RowActions
            label={rowActions.label(row.original)}
            items={rowActions.items(row.original)}
          />
        ),
        enableHiding: false,
        enableSorting: false,
      });
    }
    if (selection) {
      defs.unshift({
        id: "__select",
        header: () => (
          <SelectCheckbox
            label={selection.label ?? "Select every row on this page"}
            checked={
              rows.length > 0 &&
              rows.every((row) => selection.selected.includes(row.id))
            }
            onChange={(checked) =>
              selection.onChange(
                checked
                  ? Array.from(
                      new Set([...selection.selected, ...rows.map((r) => r.id)])
                    )
                  : selection.selected.filter(
                      (id) => !rows.some((r) => r.id === id)
                    )
              )
            }
          />
        ),
        cell: ({ row }) => (
          <SelectCheckbox
            label={`Select row ${row.original.id}`}
            checked={selection.selected.includes(row.original.id)}
            onChange={(checked) =>
              selection.onChange(
                checked
                  ? [...selection.selected, row.original.id]
                  : selection.selected.filter((id) => id !== row.original.id)
              )
            }
          />
        ),
        enableHiding: false,
        enableSorting: false,
      });
    }
    return defs;
  }, [columns, rowActions, selection, rows]);

  // Client lists (news sources, role panels, channels…) arrive complete, so
  // ordering them in the browser is honest. Server-paginated tables never are.
  const [clientSort, setClientSort] = useState<{
    key: string;
    dir: "asc" | "desc";
  } | null>(null);
  const canClientSort = !sort && columns.some((column) => column.sortValue);
  const orderedRows = useMemo(() => {
    if (!clientSort) return rows;
    const column = columns.find((item) => item.key === clientSort.key);
    if (!column?.sortValue) return rows;
    const factor = clientSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (typeof left === "number" && typeof right === "number")
        return (left - right) * factor;
      return (
        String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * factor
      );
    });
  }, [clientSort, columns, rows]);
  const toggleClientSort = (key: string) =>
    setClientSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );

  const totalItems = pagination?.total ?? rows.length;
  const [internalPage, setInternalPage] = useState(0);
  const pageIndex = pagination
    ? Math.max(0, pagination.page - 1)
    : internalPage;
  const paginationState = useMemo<PaginationState>(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize]
  );
  const sorting = useMemo<SortingState>(
    () => (sort ? [{ id: sort.field, desc: sort.dir === "desc" }] : []),
    [sort]
  );

  const table = useTable({
    features,
    data: orderedRows,
    columns: columnDefs,
    state: {
      sorting,
      pagination: paginationState,
      columnVisibility: Object.fromEntries(
        hidden.map((key) => [key, false])
      ) as ColumnVisibilityState,
    },
    manualSorting: true,
    manualPagination: true,
    rowCount: totalItems,
    enableSorting: !!sort,
    enableSortingRemoval: false,
    onSortingChange: () => undefined,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(paginationState) : updater;
      if (pagination) pagination.onPage(next.pageIndex + 1);
      else setInternalPage(next.pageIndex);
    },
    onColumnVisibilityChange: (updater) => {
      const current = Object.fromEntries(hidden.map((key) => [key, false]));
      const next =
        typeof updater === "function" ? updater(current as never) : updater;
      setHidden(
        Object.entries(next)
          .filter(([, visible]) => !visible)
          .map(([key]) => key)
      );
    },
  });

  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  // A filter or a mutation can strand the reader past the last page.
  useEffect(() => {
    if (pagination && pagination.page > pageCount) pagination.onPage(pageCount);
  }, [pagination, pageCount]);

  const hideable = columns.filter((c) => c.canHide !== false);

  // A failed fetch is not an empty result: never show "nothing here" for it.
  if (error) return <ErrorState detail={error} onRetry={onRetry} />;

  return (
    <div>
      {toolbar}
      <TableToolbar
        totalItems={totalItems}
        sort={
          sort ??
          (clientSort
            ? {
                field:
                  columns.find((c) => c.key === clientSort.key)?.label ??
                  clientSort.key,
                dir: clientSort.dir,
                onChange: () => undefined,
              }
            : undefined)
        }
        columns={columns}
        hidden={hidden}
        onToggleColumn={(key) =>
          setHidden((current) =>
            current.includes(key)
              ? current.filter((item) => item !== key)
              : [...current, key]
          )
        }
        hideable={hideable}
        visibleCount={table.getVisibleLeafColumns().length}
        selection={
          selection
            ? {
                count: selection.selected.length,
                onClear: () => selection.onChange([]),
              }
            : undefined
        }
      />
      {!rows.length ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div
          aria-busy={loading}
          className={cn("transition-opacity", loading && "opacity-60")}
        >
          <TableWrap label={label ?? "Records"}>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => {
                      const column = columns.find((c) => c.key === header.id);
                      const serverSortable = !!sort && !!column?.sortKey;
                      const clientSortable =
                        canClientSort && !!column?.sortValue;
                      const sortable = serverSortable || clientSortable;
                      const active = serverSortable
                        ? sort!.field === column!.sortKey
                        : clientSort?.key === header.id;
                      const dir = serverSortable
                        ? sort!.dir
                        : clientSort?.key === header.id
                          ? clientSort.dir
                          : undefined;
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            active
                              ? dir === "asc"
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                          className={cn(
                            header.id === "__select" && "w-10 pr-0",
                            header.id === "__actions" && "w-10 text-right",
                            column?.className
                          )}
                        >
                          {sortable ? (
                            <SortButton
                              label={column!.label}
                              active={active}
                              dir={active ? dir : undefined}
                              onClick={() =>
                                serverSortable
                                  ? sort!.onChange(column!.sortKey!)
                                  : toggleClientSort(header.id)
                              }
                            />
                          ) : header.isPlaceholder ? null : (
                            <table.FlexRender header={header} />
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={
                      selection?.selected.includes(row.original.id)
                        ? "selected"
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => {
                      const column = columns.find(
                        (c) => c.key === cell.column.id
                      );
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            cell.column.id === "__select" && "w-10 pr-0",
                            cell.column.id === "__actions" && "text-right",
                            column?.className
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
          {pageCount > 1 || totalItems > pageSize ? (
            <TablePagination
              page={pageIndex + 1}
              pageCount={pageCount}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageSize={pagination?.onPageSize}
              onPage={(next) => {
                const target = Math.min(Math.max(1, next), pageCount);
                if (pagination) pagination.onPage(target);
                else setInternalPage(target - 1);
              }}
            />
          ) : (
            <p className="border-t px-4 py-2.5 text-[10px] text-muted-foreground">
              {totalItems} {totalItems === 1 ? "record" : "records"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SelectCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      aria-label={label}
      checked={checked}
      onCheckedChange={(value) => onChange(value === true)}
    />
  );
}

function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir?: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm uppercase tracking-wide underline-offset-2 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
        active && "text-foreground"
      )}
    >
      {label}
      <Icon size={11} aria-hidden className={cn(!active && "opacity-50")} />
      <span className="sr-only">
        {active
          ? dir === "asc"
            ? ", sorted ascending, activate to reverse"
            : ", sorted descending, activate to reverse"
          : ", activate to sort descending"}
      </span>
    </button>
  );
}

function TableToolbar({
  totalItems,
  sort,
  hidden,
  onToggleColumn,
  hideable,
  visibleCount,
  selection,
}: {
  totalItems: number;
  sort?: DataTableSort;
  columns: DataColumn<never>[];
  hidden: string[];
  onToggleColumn: (key: string) => void;
  hideable: { key: string; label: string }[];
  visibleCount: number;
  selection?: { count: number; onClear: () => void };
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
      <p className="text-[10px] text-muted-foreground" aria-live="polite">
        {selection && selection.count > 0 ? (
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {selection.count} selected
            </span>
            <button
              type="button"
              onClick={selection.onClear}
              className="rounded underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              Clear selection
            </button>
          </span>
        ) : totalItems === 0 ? (
          "No matching records"
        ) : (
          <>
            {totalItems} {totalItems === 1 ? "row" : "rows"}
            {sort
              ? ` · sorted by ${sort.field} (${sort.dir === "asc" ? "ascending" : "descending"})`
              : ""}
          </>
        )}
      </p>
      {hideable.length > 2 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-[10px]">
              <Settings2 size={12} aria-hidden />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide">
              Show columns
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hideable.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.key}
                checked={!hidden.includes(column.key)}
                // The last visible column stays visible: an empty table with no
                // header cannot be told apart from a failed load.
                disabled={!hidden.includes(column.key) && visibleCount <= 1}
                onCheckedChange={() => onToggleColumn(column.key)}
                onSelect={(event) => event.preventDefault()}
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/**
 * Footer shared by every paginated table: range, page count and navigation.
 *
 * Orbit has server-paginated data, so page jumps to "page 14 of 900" are not
 * offered — but first/previous/next/last are, which is what actually helps when
 * you are paging through an audit log.
 */
export function TablePagination({
  page,
  pageCount,
  totalItems,
  pageSize,
  onPage,
  onPageSize,
  pageSizes = [7, 15, 25, 50],
  className,
}: {
  page: number;
  pageCount: number;
  totalItems: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** Omit where the API has a single fixed page size. */
  onPageSize?: (size: number) => void;
  pageSizes?: number[];
  className?: string;
}) {
  const first = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5",
        className
      )}
    >
      <p className="text-[10px] text-muted-foreground">
        Showing{" "}
        <span className="font-medium text-foreground">
          {first}–{last}
        </span>{" "}
        of {totalItems} matching rows
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSize ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Rows</span>
            <FormSelect
              aria-label="Rows per page"
              value={String(pageSize)}
              onValueChange={(next) => onPageSize(Number(next))}
              options={pageSizes.map((size) => ({
                value: String(size),
                label: String(size),
              }))}
              className="h-7 w-16 text-[10px]"
            />
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page <= 1}
            onClick={() => onPage(1)}
            aria-label="First page"
          >
            <span className="sr-only">Go to first page</span>
            <ChevronLeft size={13} aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={13} aria-hidden />
          </Button>
          <span className="px-2 text-[10px] text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={13} aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page >= pageCount}
            onClick={() => onPage(pageCount)}
            aria-label="Last page"
          >
            <ChevronRight size={13} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function RowActions({
  label,
  items,
}: {
  label: string;
  items: { label: string; icon?: React.ReactNode; onSelect: () => void }[];
}) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={label}
        >
          <MoreHorizontal size={14} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type Column<T> = DataColumn<T>;
export type TableSort = DataTableSort;
export type { RowData };

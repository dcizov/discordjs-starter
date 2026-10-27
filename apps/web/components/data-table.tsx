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
  type Updater,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  MoreHorizontal,
  Search,
  Settings2,
  X,
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
import { EmptyState, ErrorState, FormSelect, Input } from "./ui/primitives";
import { FacetFilterButton, type FacetFilter } from "./table-facet";
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
 * Two honest modes, chosen by the data the caller actually has:
 *
 * - **Server** (`pagination` supplied): the API owns ordering, filtering and
 *   slicing (`GET /api/guilds/:id/history`). TanStack runs in manual modes, so
 *   it reports intent and never sorts or slices a page in the browser — sorting
 *   one page of 7 results and calling it "sorted by date" would misrepresent the
 *   900 rows the reader cannot see.
 * - **Client** (`pageSize` supplied, `pagination` absent): the list arrived
 *   complete, so TanStack owns sorting and paging through its own row models.
 *   The leaderboard and the channel/role lists are this case.
 *
 * Composition follows the shadcn tasks table: one toolbar with search and
 * faceted filters on the left, view/column controls and real actions on the
 * right, and one footer that states a single accurate range plus page controls.
 * There is no second "N rows" line above the table, and the page controls are
 * present (disabled) rather than missing when everything fits on one page.
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
  /** Header alignment for numeric columns. */
  align?: "left" | "right";
};

export type DataTableSort = {
  field: string;
  dir: "asc" | "desc";
  onChange: (field: string) => void;
};

export type DataTableSearch = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name; the placeholder is not a label. */
  label: string;
};

export type DataTableProps<T extends { id: string }> = {
  rows: T[];
  columns: DataColumn<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Client pagination: the list is complete, so TanStack pages it. Omit for a
   * short list that should simply render all of its rows.
   */
  pageSize?: number;
  /** Server pagination. Omit for a client dataset. */
  pagination?: {
    page: number;
    total: number;
    onPage: (page: number) => void;
    onPageSize?: (size: number) => void;
    pageSizes?: number[];
  };
  /** Server sorting. Changing it must reset the page in the same update. */
  sort?: DataTableSort;
  /** Toolbar search. Debounced here; the caller owns the query state. */
  search?: DataTableSearch;
  /** Toolbar facets, each a single-choice filter owned by the caller. */
  filters?: FacetFilter[];
  /** Real actions for this dataset, right-aligned next to the view menu. */
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** Accessible name for the scrollable region around the table. */
  label?: string;
  /** Optional row-selection state, only for tables with a real bulk action. */
  selection?: {
    selected: string[];
    onChange: (ids: string[]) => void;
    label?: string;
  };
  /** Per-row overflow menu rendered in a trailing cell. */
  rowActions?: {
    label: (row: T) => string;
    items: (
      row: T
    ) => { label: string; icon?: React.ReactNode; onSelect: () => void }[];
  };
  /** Extra toolbar content (segments, banners) rendered above the controls. */
  toolbar?: React.ReactNode;
  /** Quiet clause appended to the footer range, e.g. a dataset caveat. */
  footerNote?: React.ReactNode;
};

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  emptyTitle = "Nothing here just yet",
  emptyDescription = "New activity will appear here as your community gets going.",
  pageSize,
  pagination,
  sort,
  search,
  filters = [],
  actions,
  loading = false,
  error = "",
  onRetry,
  label,
  selection,
  rowActions,
  toolbar,
  footerNote,
}: DataTableProps<T>) {
  const [hidden, setHidden] = useState<string[]>(() =>
    columns.filter((c) => c.defaultHidden).map((c) => c.key)
  );
  const server = !!pagination;
  const [clientPage, setClientPage] = useState(0);
  // A client list pages when the caller asked for a size; otherwise it is a
  // complete reference list (channels, roles) and every row renders. A paged
  // client list keeps its own page size, so "Rows per page" is a real control
  // rather than a fixed number dressed up as one.
  const pagedClient = !server && pageSize !== undefined;
  const [clientSize, setClientSize] = useState(pageSize ?? 7);
  const size = server
    ? (pageSize ?? 7)
    : pagedClient
      ? clientSize
      : Math.max(rows.length, 1);
  const [clientSort, setClientSort] = useState<SortingState>([]);
  const [draft, setDraft] = useState(search?.value ?? "");
  const [pendingQuery, setPendingQuery] = useState(search?.value ?? "");

  const searchValue = search?.value ?? "";
  const searchChange = search?.onChange;
  const facetValues = filters.map((facet) => facet.value).join("\u0000");
  // Committed query only changes after the reader stops typing, so a server
  // table issues one request per pause instead of one per keystroke.
  useEffect(() => {
    if (!searchChange) return;
    setDraft(searchValue);
    setPendingQuery(searchValue);
  }, [searchValue, searchChange]);
  useEffect(() => {
    if (!searchChange || pendingQuery === searchValue) return;
    const timer = setTimeout(() => searchChange(pendingQuery), 250);
    return () => clearTimeout(timer);
  }, [pendingQuery, searchValue, searchChange]);
  // A new query or facet means page 1 of the *new* result set, always.
  useEffect(() => {
    setClientPage(0);
  }, [searchValue, facetValues]);

  const columnDefs = useMemo<ColumnDef<TableFeatures, T>[]>(() => {
    const defs: ColumnDef<TableFeatures, T>[] = columns.map((column) => ({
      id: column.key,
      header: () => column.header ?? column.label,
      cell: ({ row }) => column.render(row.original),
      // A client list sorts through TanStack's row model; a server list passes
      // its field to the API and leaves the page untouched.
      enableSorting: server ? false : column.sortValue ? true : false,
      accessorFn: column.sortValue
        ? (row: T) => column.sortValue!(row)
        : undefined,
      enableHiding: column.canHide !== false,
      meta: { align: column.align },
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
  }, [columns, rowActions, selection, rows, server]);

  const totalItems = pagination?.total ?? rows.length;
  const pageIndex = server ? Math.max(0, pagination!.page - 1) : clientPage;
  const paginationState = useMemo<PaginationState>(
    () => ({ pageIndex, pageSize: size }),
    [pageIndex, size]
  );
  const sorting = useMemo<SortingState>(
    () =>
      server
        ? sort
          ? [{ id: sort.field, desc: sort.dir === "desc" }]
          : []
        : clientSort,
    [server, sort, clientSort]
  );

  const table = useTable({
    features,
    data: rows,
    columns: columnDefs,
    // Rows are keyed by their own id, not their position. An index key makes a
    // re-ordered or refetched list reuse a `<tr>` for a different record, which
    // closes an open row menu and drops focus.
    getRowId: (row) => row.id,
    state: {
      sorting,
      pagination: paginationState,
      columnVisibility: Object.fromEntries(
        hidden.map((key) => [key, false])
      ) as ColumnVisibilityState,
    },
    manualSorting: server,
    manualPagination: server,
    rowCount: server ? totalItems : undefined,
    enableSortingRemoval: false,
    autoResetPageIndex: false,
    onSortingChange: (updater: Updater<SortingState>) => {
      if (server) return;
      setClientSort((current) =>
        typeof updater === "function" ? updater(current) : updater
      );
      setClientPage(0);
    },
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next =
        typeof updater === "function" ? updater(paginationState) : updater;
      if (server) pagination!.onPage(next.pageIndex + 1);
      else setClientPage(next.pageIndex);
    },
    onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) => {
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

  const pageCount = Math.max(1, Math.ceil(totalItems / size));
  // A filter or a mutation can strand the reader past the last page.
  useEffect(() => {
    if (server && pagination!.page > pageCount) pagination!.onPage(pageCount);
    if (!server && clientPage > pageCount - 1) setClientPage(pageCount - 1);
  }, [server, pagination, pageCount, clientPage]);

  const hideable = columns.filter((c) => c.canHide !== false);
  const activeFilters = filters.filter(
    (facet) => facet.value !== facet.allValue
  );
  // A failed fetch is not an empty result: never show "nothing here" for it.
  if (error) return <ErrorState detail={error} onRetry={onRetry} />;

  const rowsOnPage = table.getRowModel().rows.length;

  return (
    // The region covers the toolbar, the table and the footer: a reader who
    // lands on "Contributors by balance" reaches its search and paging too, and
    // the range sentence belongs to the thing it counts.
    <div className="min-w-0" role="region" aria-label={label ?? "Records"}>
      {toolbar}
      <div className="flex flex-col gap-2 border-b px-3 py-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {search && (
            <div className="relative w-full min-w-0 sm:max-w-[260px]">
              <Search
                size={13}
                aria-hidden
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={draft}
                aria-label={search.label}
                placeholder={search.placeholder}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setPendingQuery(event.target.value);
                }}
                className="h-8 rounded-lg pl-8 text-[11.5px]"
              />
            </div>
          )}
          {filters.map((facet) => (
            <FacetFilterButton key={facet.key} facet={facet} />
          ))}
          {activeFilters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[11.5px] text-muted-foreground"
              onClick={() => {
                activeFilters.forEach((facet) =>
                  facet.onChange(facet.allValue)
                );
                if (search) search.onChange("");
              }}
            >
              Reset
              <X size={12} aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {actions}
          {hideable.length > 1 && (
            <ColumnMenu
              hideable={hideable}
              hidden={hidden}
              visibleCount={table.getVisibleLeafColumns().length}
              onToggle={(key) =>
                setHidden((current) =>
                  current.includes(key)
                    ? current.filter((item) => item !== key)
                    : [...current, key]
                )
              }
            />
          )}
        </div>
      </div>
      {!rows.length ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={
            activeFilters.length ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  activeFilters.forEach((facet) =>
                    facet.onChange(facet.allValue)
                  );
                  if (search) search.onChange("");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          aria-busy={loading}
          className={cn("transition-opacity", loading && "opacity-60")}
        >
          <TableWrap>
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
                      const clientSortable = !server && !!column?.sortValue;
                      const sortable = serverSortable || clientSortable;
                      const clientEntry = clientSort.find(
                        (entry) => entry.id === header.id
                      );
                      const active = serverSortable
                        ? sort!.field === column!.sortKey
                        : !!clientEntry;
                      const dir = serverSortable
                        ? sort!.dir
                        : clientEntry
                          ? clientEntry.desc
                            ? "desc"
                            : "asc"
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
                            column?.align === "right" && "text-right",
                            column?.className
                          )}
                        >
                          {sortable ? (
                            <SortButton
                              label={column!.label}
                              active={!!active}
                              dir={active ? dir : undefined}
                              align={column?.align}
                              onClick={() =>
                                serverSortable
                                  ? sort!.onChange(column!.sortKey!)
                                  : table.setSorting((current) => {
                                      const existing = current.find(
                                        (entry) => entry.id === header.id
                                      );
                                      return [
                                        {
                                          id: header.id,
                                          desc: existing
                                            ? !existing.desc
                                            : false,
                                        },
                                      ];
                                    })
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
                            column?.align === "right" &&
                              "text-right tabular-nums",
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
          <TableFooter
            page={pageIndex + 1}
            pageCount={pageCount}
            pageSize={size}
            totalItems={totalItems}
            rangeStart={
              totalItems === 0 || rowsOnPage === 0 ? 0 : pageIndex * size + 1
            }
            rangeEnd={Math.min(pageIndex * size + rowsOnPage, totalItems)}
            pageSizes={pagination?.pageSizes}
            onPageSize={
              pagination?.onPageSize ??
              // A paged client list changes its own page size; a complete
              // reference list that renders every row has nothing to change.
              (pagedClient
                ? (next) => {
                    setClientSize(next);
                    setClientPage(0);
                  }
                : undefined)
            }
            onPage={(next) => {
              const target = Math.min(Math.max(1, next), pageCount);
              if (server) pagination!.onPage(target);
              else setClientPage(target - 1);
            }}
            note={footerNote}
          />
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
  align,
  onClick,
}: {
  label: string;
  active: boolean;
  dir?: string;
  align?: "left" | "right";
  onClick: () => void;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
        active && "text-foreground",
        align === "right" && "flex-row-reverse"
      )}
    >
      {label}
      <Icon
        size={12}
        aria-hidden
        className={cn(!active && "opacity-40", active && "text-primary")}
      />
      <span className="sr-only">
        {active
          ? dir === "asc"
            ? ", sorted ascending, activate to reverse"
            : ", sorted descending, activate to reverse"
          : ", activate to sort ascending"}
      </span>
    </button>
  );
}

function ColumnMenu({
  hideable,
  hidden,
  visibleCount,
  onToggle,
}: {
  hideable: { key: string; label: string }[];
  hidden: string[];
  visibleCount: number;
  onToggle: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[11.5px]"
        >
          <Settings2 size={12} aria-hidden />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
            onCheckedChange={() => onToggle(column.key)}
            onSelect={(event) => event.preventDefault()}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One footer for every table: a single accurate range, then page size and
 * navigation. The controls stay present and disabled when everything fits on
 * one page, so nothing disappears at exactly the moment a second page appears.
 */
function TableFooter({
  page,
  pageCount,
  pageSize,
  totalItems,
  rangeStart,
  rangeEnd,
  pageSizes = [7, 15, 25, 50],
  onPageSize,
  onPage,
  note,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  totalItems: number;
  rangeStart: number;
  rangeEnd: number;
  pageSizes?: number[];
  onPageSize?: (size: number) => void;
  onPage: (page: number) => void;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-3 py-2">
      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        {totalItems === 0 ? (
          "No matching rows"
        ) : (
          <>
            Showing{" "}
            <span className="font-medium tabular-nums text-foreground">
              {rangeStart}–{rangeEnd}
            </span>{" "}
            of <span className="tabular-nums">{totalItems}</span>
            {note ? <> {note}</> : null}
          </>
        )}
      </p>
      {/*
        The page controls are always present. A filtered list that fits on one
        page still shows "Page 1 of 1" with the arrows disabled: the controls do
        not vanish and reappear depending on how many rows are left.
      */}
      <div className="flex flex-wrap items-center gap-3">
        {onPageSize ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Rows</span>
            <FormSelect
              aria-label="Rows per page"
              value={String(pageSize)}
              onValueChange={(next) => onPageSize(Number(next))}
              options={[...new Set([pageSize, ...pageSizes])]
                .sort((a, b) => a - b)
                .map((option) => ({
                  value: String(option),
                  label: String(option),
                }))}
              className="h-7 w-[68px] text-[11px]"
            />
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <PageButton
            label="Go to first page"
            disabled={page <= 1}
            onClick={() => onPage(1)}
          >
            <ChevronsLeft size={13} aria-hidden />
          </PageButton>
          <PageButton
            label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft size={13} aria-hidden />
          </PageButton>
          <span className="px-1.5 text-[11px] tabular-nums text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <PageButton
            label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight size={13} aria-hidden />
          </PageButton>
          <PageButton
            label="Go to last page"
            disabled={page >= pageCount}
            onClick={() => onPage(pageCount)}
          >
            <ChevronsRight size={13} aria-hidden />
          </PageButton>
        </div>
      </div>
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-7"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </Button>
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

/**
 * Standalone footer for callers that own their own markup (the personal
 * transaction history predates the table foundation and keeps its own rows).
 */
export type Column<T> = DataColumn<T>;
export type TableSort = DataTableSort;
export type { RowData };

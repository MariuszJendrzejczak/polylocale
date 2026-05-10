import { useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type OnChangeFn,
  type Row,
  type SortingFn,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import styles from './Table.module.css';

export interface TableColumn<TRow> {
  readonly id: string;
  readonly header: ReactNode;
  readonly width?: number;
  readonly minWidth?: number;
  readonly cell: (row: TRow) => ReactNode;
  readonly sortBy?: (row: TRow) => string | number;
}

export interface TableProps<TRow> {
  readonly rows: readonly TRow[];
  readonly columns: readonly TableColumn<TRow>[];
  readonly rowKey: (row: TRow) => string;
  readonly rowHeight?: number;
  readonly emptyState?: ReactNode;
  readonly globalFilter?: string;
  readonly globalFilterFn?: (row: TRow, value: string) => boolean;
  readonly sorting?: SortingState;
  readonly onSortingChange?: OnChangeFn<SortingState>;
}

const HEADER_HEIGHT = 36;
const DEFAULT_ROW_HEIGHT = 36;

export function Table<TRow>(props: TableProps<TRow>): ReactElement {
  const {
    rows,
    columns,
    rowKey,
    rowHeight = DEFAULT_ROW_HEIGHT,
    emptyState,
    globalFilter,
    globalFilterFn,
    sorting,
    onSortingChange,
  } = props;
  const parentRef = useRef<HTMLDivElement>(null);

  const sortingEnabled = sorting !== undefined && onSortingChange !== undefined;
  const filteringEnabled = globalFilter !== undefined && globalFilterFn !== undefined;

  const tanColumns = useMemo<ColumnDef<TRow>[]>(
    () =>
      columns.map((c, idx) => {
        const def: ColumnDef<TRow> = {
          id: c.id,
          accessorFn: (row) => (c.sortBy !== undefined ? c.sortBy(row) : `__row-${idx}`),
          header: () => <>{c.header}</>,
          enableSorting: c.sortBy !== undefined,
          enableGlobalFilter: filteringEnabled && idx === 0,
        };
        if (c.sortBy !== undefined) {
          const sortBy = c.sortBy;
          const sortFn: SortingFn<TRow> = (a, b) => {
            const av = sortBy(a.original);
            const bv = sortBy(b.original);
            if (typeof av === 'number' && typeof bv === 'number') return av - bv;
            return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
          };
          def.sortingFn = sortFn;
        }
        return def;
      }),
    [columns, filteringEnabled],
  );

  const filterFn = useMemo<FilterFn<TRow>>(() => {
    return (row: Row<TRow>, _columnId: string, value: unknown): boolean => {
      const text = typeof value === 'string' ? value : '';
      if (text === '') return true;
      if (globalFilterFn === undefined) return true;
      return globalFilterFn(row.original, text);
    };
  }, [globalFilterFn]);

  const table = useReactTable<TRow>({
    data: rows as TRow[],
    columns: tanColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: filterFn,
    state: {
      sorting: sortingEnabled ? sorting : [],
      globalFilter: filteringEnabled ? globalFilter : '',
    },
    ...(sortingEnabled ? { onSortingChange } : {}),
  });

  const processedRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: processedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    getItemKey: (index) => rowKey(processedRows[index]!.original),
  });

  const gridTemplate = columns
    .map((c) => (c.width !== undefined ? `${c.width}px` : `minmax(${c.minWidth ?? 200}px, 1fr)`))
    .join(' ');

  if (rows.length === 0) {
    return (
      <div className={styles.scroll}>
        <div className={styles.empty}>{emptyState ?? 'No rows.'}</div>
      </div>
    );
  }

  if (processedRows.length === 0) {
    return (
      <div className={styles.scroll}>
        <div className={styles.empty}>No rows match the current filter.</div>
      </div>
    );
  }

  const headerGroup = table.getHeaderGroups()[0];
  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();

  return (
    <div ref={parentRef} className={styles.scroll}>
      <div
        className={styles.headerRow}
        style={{ gridTemplateColumns: gridTemplate, height: HEADER_HEIGHT }}
      >
        {headerGroup?.headers.map((header) => {
          const canSort = header.column.getCanSort();
          const sortDir = header.column.getIsSorted();
          const indicator = sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : '';
          if (canSort) {
            return (
              <button
                key={header.id}
                type="button"
                className={`${styles.headerCell} ${styles.headerSortable}`}
                onClick={header.column.getToggleSortingHandler()}
                aria-sort={
                  sortDir === 'asc'
                    ? 'ascending'
                    : sortDir === 'desc'
                      ? 'descending'
                      : 'none'
                }
              >
                <span className={styles.headerLabel}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </span>
                <span className={styles.headerSortIndicator} aria-hidden="true">
                  {indicator}
                </span>
              </button>
            );
          }
          return (
            <div key={header.id} className={styles.headerCell}>
              {flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          );
        })}
      </div>
      <div className={styles.body} style={{ height: total }}>
        {items.map((vi) => {
          const row = processedRows[vi.index]!.original;
          return (
            <div
              key={vi.key}
              className={styles.bodyRow}
              style={{
                gridTemplateColumns: gridTemplate,
                transform: `translateY(${vi.start}px)`,
                height: vi.size,
              }}
            >
              {columns.map((col) => (
                <div key={col.id} className={styles.bodyCell} data-column-id={col.id}>
                  {col.cell(row)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

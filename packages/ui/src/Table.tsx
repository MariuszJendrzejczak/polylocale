import { useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import styles from './Table.module.css';

export interface TableColumn<TRow> {
  readonly id: string;
  readonly header: ReactNode;
  readonly width?: number;
  readonly minWidth?: number;
  readonly cell: (row: TRow) => ReactNode;
}

export interface TableProps<TRow> {
  readonly rows: readonly TRow[];
  readonly columns: readonly TableColumn<TRow>[];
  readonly rowKey: (row: TRow) => string;
  readonly rowHeight?: number;
  readonly emptyState?: ReactNode;
}

const HEADER_HEIGHT = 36;
const DEFAULT_ROW_HEIGHT = 36;

export function Table<TRow>(props: TableProps<TRow>): ReactElement {
  const { rows, columns, rowKey, rowHeight = DEFAULT_ROW_HEIGHT, emptyState } = props;
  const parentRef = useRef<HTMLDivElement>(null);

  const tanColumns = useMemo<ColumnDef<TRow>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: () => <>{c.header}</>,
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows as TRow[],
    columns: tanColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    getItemKey: (index) => rowKey(rows[index]!),
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

  const headerGroup = table.getHeaderGroups()[0];
  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();

  return (
    <div ref={parentRef} className={styles.scroll}>
      <div
        className={styles.headerRow}
        style={{ gridTemplateColumns: gridTemplate, height: HEADER_HEIGHT }}
      >
        {headerGroup?.headers.map((header) => (
          <div key={header.id} className={styles.headerCell}>
            {flexRender(header.column.columnDef.header, header.getContext())}
          </div>
        ))}
      </div>
      <div className={styles.body} style={{ height: total }}>
        {items.map((vi) => {
          const row = rows[vi.index]!;
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

import { useMemo, useState } from 'react'
import type * as React from 'react'
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface ColumnDef<T> {
  /** Stable key for React reconciliation. */
  key: string
  /** Header cell content. */
  header: React.ReactNode
  /** Cell renderer for a row. */
  cell: (row: T) => React.ReactNode
  /** Text alignment for header + cell. Default 'left'. */
  align?: 'left' | 'right' | 'center'
  /** Extra Tailwind classes applied to header + cell. */
  className?: string
  /** Opt-in: column header becomes a sort toggle. */
  sortable?: boolean
  /** Required when `sortable`. Extracts comparison key from a row.
   *  Returning null/undefined sorts to the end regardless of direction. */
  sortKey?: (row: T) => string | number | Date | null | undefined
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  /** Stable per-row key. */
  rowKey: (row: T) => string
  /** Right-fixed Actions column. Returns whatever JSX (Button row, dropdown, etc). */
  rowActions?: (row: T) => React.ReactNode
  /** Header label for the actions column. Defaults to "Actions". */
  actionsLabel?: React.ReactNode
  /** Show a loading row instead of data. */
  isLoading?: boolean
  /** Custom loading row content. Defaults to "Loading…". */
  loadingPlaceholder?: React.ReactNode
  /** Shown in lieu of rows when data.length === 0 (and not loading). */
  emptyMessage?: React.ReactNode
  /** Class applied to <tr> per row — for conditional highlights. */
  rowClassName?: (row: T) => string
  /** Optional caption rendered below the table. */
  caption?: React.ReactNode
  /** Initial sort. Header click cycles asc → desc → none from this starting point. */
  defaultSort?: { columnKey: string; direction: 'asc' | 'desc' }
}

const alignClass: Record<NonNullable<ColumnDef<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

type SortState = { columnKey: string; direction: 'asc' | 'desc' } | null

function compareKeys(
  a: string | number | Date | null | undefined,
  b: string | number | Date | null | undefined,
  direction: 'asc' | 'desc',
): number {
  // Nulls/undefined sort to the end regardless of direction.
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1

  const av = a instanceof Date ? a.getTime() : a
  const bv = b instanceof Date ? b.getTime() : b
  let cmp: number
  if (typeof av === 'number' && typeof bv === 'number') {
    cmp = av - bv
  } else {
    cmp = String(av).localeCompare(String(bv))
  }
  return direction === 'asc' ? cmp : -cmp
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  rowActions,
  actionsLabel = 'Actions',
  isLoading = false,
  loadingPlaceholder = 'Loading…',
  emptyMessage = 'No items',
  rowClassName,
  caption,
  defaultSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(defaultSort ?? null)
  const totalCols = columns.length + (rowActions ? 1 : 0)

  const sortedData = useMemo(() => {
    if (!sort) return data
    const col = columns.find((c) => c.key === sort.columnKey)
    if (!col?.sortKey) return data
    const key = col.sortKey
    return [...data].sort((a, b) => compareKeys(key(a), key(b), sort.direction))
  }, [data, columns, sort])

  const onHeaderClick = (col: ColumnDef<T>) => {
    if (!col.sortable) return
    setSort((prev) => {
      if (!prev || prev.columnKey !== col.key) {
        return { columnKey: col.key, direction: 'asc' }
      }
      if (prev.direction === 'asc') return { columnKey: col.key, direction: 'desc' }
      return null
    })
  }

  return (
    <Table>
      {caption && <TableCaption>{caption}</TableCaption>}
      <TableHeader>
        <TableRow>
          {columns.map((col) => {
            const isActive = sort?.columnKey === col.key
            const SortIcon = !col.sortable
              ? null
              : !isActive
                ? ChevronsUpDownIcon
                : sort.direction === 'asc'
                  ? ChevronUpIcon
                  : ChevronDownIcon
            return (
              <TableHead
                key={col.key}
                className={cn(alignClass[col.align ?? 'left'], col.className)}
                aria-sort={
                  !col.sortable
                    ? undefined
                    : isActive
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                }
              >
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() => onHeaderClick(col)}
                    className={cn(
                      'inline-flex items-center gap-1 -mx-2 px-2 py-1 rounded hover:bg-muted',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      isActive && 'text-foreground',
                    )}
                  >
                    <span>{col.header}</span>
                    {SortIcon && <SortIcon className="size-3.5 opacity-70" />}
                  </button>
                ) : (
                  col.header
                )}
              </TableHead>
            )
          })}
          {rowActions && (
            <TableHead className="text-right w-px whitespace-nowrap">
              {actionsLabel}
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell
              colSpan={totalCols}
              className="text-center text-muted-foreground py-8"
            >
              {loadingPlaceholder}
            </TableCell>
          </TableRow>
        ) : sortedData.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={totalCols}
              className="text-center text-muted-foreground py-8"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          sortedData.map((row) => (
            <TableRow key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className={cn(alignClass[col.align ?? 'left'], col.className)}
                >
                  {col.cell(row)}
                </TableCell>
              ))}
              {rowActions && (
                <TableCell className="text-right w-px whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    {rowActions(row)}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

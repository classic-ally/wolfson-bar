import type * as React from 'react'
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
}

const alignClass: Record<NonNullable<ColumnDef<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
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
}: DataTableProps<T>) {
  const totalCols = columns.length + (rowActions ? 1 : 0)

  return (
    <Table>
      {caption && <TableCaption>{caption}</TableCaption>}
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.key}
              className={cn(alignClass[col.align ?? 'left'], col.className)}
            >
              {col.header}
            </TableHead>
          ))}
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
        ) : data.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={totalCols}
              className="text-center text-muted-foreground py-8"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((row) => (
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

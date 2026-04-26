# UI primitives

shadcn/ui components owned by this repo. Edit freely — they're recipes, not a dependency.

Add more via `pnpm dlx shadcn@latest add <name>`. See [ui.shadcn.com](https://ui.shadcn.com/docs/components) for the registry.

Brand color overrides live in `src/index.css` under `:root` (`--primary`, `--accent`, `--destructive`). Run `pnpm storybook` to preview.

## DataTable + Badge

`DataTable.tsx` is a thin typed wrapper around shadcn `Table` for the common "list of records + optional row actions" shape. Pass `columns` (each with `header`, `cell(row)`, optional `align`/`className`), `data`, `rowKey(row)`, optional `rowActions(row) => JSX`, and optional `isLoading` / `emptyMessage` / `rowClassName`. Right-fixed actions column appears only when `rowActions` is provided. No sorting, pagination, or selection — those are deliberately out of scope.

`Badge` (shadcn recipe at `badge.tsx`) is the standard pill for roles, status, and shift fill state. Variants map to brand tokens: `default` (primary green), `secondary` (slate), `destructive` (red), `outline`, `ghost`. Convention: `destructive` → Admin, `default` → Committee, `secondary` → Member.

`DateRangePicker` wraps shadcn `Calendar` (range mode) inside a `Popover`. Props: `value` / `defaultValue` / `onValueChange` (a `DateRange` from `react-day-picker`), optional `minDate` / `maxDate`, `placeholder`, `numberOfMonths` (default 2), `disabled`, `fullWidth`. Trigger button shows formatted range or placeholder. `react-day-picker`'s `DateRange` type is re-exported.

import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ExportCard } from './CommitteeExport'

const meta = {
  title: 'Committee/ExportCard',
  component: ExportCard,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ExportCard>

export default meta
type Story = StoryObj<typeof meta>

const noopDownload = () => Promise.resolve()
const delayedDownload = () => new Promise<void>((resolve) => setTimeout(resolve, 1500))
const failingDownload = () =>
  Promise.reject(new Error('Network unreachable — try again in a minute.'))

export const Members: Story = {
  args: {
    title: 'Members',
    description:
      'Every active rota member with their email and contract status. Use for mailing lists, recruiting contract holders, or chasing onboarding gaps.',
    columns: ['display_name', 'email', 'has_contract', 'contract_expiry_date'],
    filenameHint: 'members-YYYY-MM-DD.csv',
    onDownload: noopDownload,
  },
}

export const ShiftHistory: Story = {
  args: {
    title: 'Shift history',
    description:
      'Every shift signup across all time, joined to the member and event. Use for "who worked X" lookups and per-member totals.',
    columns: ['shift_date', 'event_title', 'display_name', 'email'],
    filenameHint: 'shift-history-YYYY-MM-DD.csv',
    onDownload: noopDownload,
  },
}

/// Clicking the card opens the dialog; clicking Download calls onDownload once.
export const ClickFlowInvokesDownload: Story = {
  args: {
    title: 'Members',
    description: 'Test interaction — click triggers the spy.',
    columns: ['display_name', 'email'],
    filenameHint: 'members-YYYY-MM-DD.csv',
    onDownload: fn(() => Promise.resolve()),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Members/ }))

    // Dialog content portals outside canvasElement — query the body.
    const body = within(document.body)
    const downloadBtn = await body.findByRole('button', { name: /Download CSV/ })
    await userEvent.click(downloadBtn)

    await waitFor(() => {
      expect(args.onDownload).toHaveBeenCalledTimes(1)
    })
  },
}

export const SlowDownload: Story = {
  args: {
    title: 'Members',
    description: 'Simulates a slow download — click "Download CSV" to see the loading state.',
    columns: ['display_name', 'email', 'has_contract', 'contract_expiry_date'],
    filenameHint: 'members-YYYY-MM-DD.csv',
    onDownload: delayedDownload,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Members/ }))

    const body = within(document.body)
    const downloadBtn = await body.findByRole('button', { name: /Download CSV/ })
    await userEvent.click(downloadBtn)

    // While the promise is in flight the button text flips to "Downloading…".
    await body.findByRole('button', { name: /Downloading/ })
  },
}

export const DownloadFailure: Story = {
  args: {
    title: 'Members',
    description: 'Simulates a network failure — click "Download CSV" to surface the error state.',
    columns: ['display_name', 'email', 'has_contract', 'contract_expiry_date'],
    filenameHint: 'members-YYYY-MM-DD.csv',
    onDownload: failingDownload,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Members/ }))

    const body = within(document.body)
    const downloadBtn = await body.findByRole('button', { name: /Download CSV/ })
    await userEvent.click(downloadBtn)

    // Error message surfaces from the rejected promise.
    await body.findByText(/Network unreachable/)
  },
}

export const ManyColumns: Story = {
  args: {
    title: 'Hypothetical wide export',
    description:
      'Sanity-check the layout with a longer column list (future reports may carry more columns).',
    columns: [
      'shift_date',
      'event_title',
      'display_name',
      'email',
      'signed_up_at',
      'cancelled_at',
      'is_committee',
      'requires_contract',
    ],
    filenameHint: 'wide-report-YYYY-MM-DD.csv',
    onDownload: noopDownload,
  },
}

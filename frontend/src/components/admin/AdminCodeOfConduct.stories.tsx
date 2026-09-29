import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import AdminCodeOfConduct from './AdminCodeOfConduct'
import { cocHandlers } from '@/test/handlers'

const meta = {
  title: 'Admin/AdminCodeOfConduct',
  component: AdminCodeOfConduct,
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/admin/coc/versions', () =>
          HttpResponse.json([
            { version: 2, published_at: '2026-09-01 12:00:00', published_by_name: 'Alex Admin' },
            { version: 1, published_at: '2026-01-10 09:30:00', published_by_name: null },
          ]),
        ),
        http.get('*/api/admin/users', () =>
          HttpResponse.json(
            Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, code_of_conduct_signed: i < 9 })),
          ),
        ),
        http.post('*/api/admin/coc', () => HttpResponse.json({ version: 3, users_reset: 9 })),
        ...cocHandlers,
      ],
    },
  },
} satisfies Meta<typeof AdminCodeOfConduct>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

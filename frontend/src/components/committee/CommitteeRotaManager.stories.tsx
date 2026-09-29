import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import CommitteeRotaManager from './CommitteeRotaManager'
import {
  defaultHandlers,
  emptyUnallocatedHandlers,
  loadingHandlers,
  cocResetHandlers,
} from '@/test/handlers'

const meta = {
  title: 'Committee/RotaManager',
  component: CommitteeRotaManager,
  parameters: {
    layout: 'fullscreen',
    msw: { handlers: defaultHandlers },
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="max-w-5xl mx-auto p-6">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof CommitteeRotaManager>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const EmptyList: Story = {
  parameters: { msw: { handlers: emptyUnallocatedHandlers } },
}

/** Just after a new Code of Conduct: members are hidden until they re-sign. */
export const AfterCocReset: Story = {
  parameters: { msw: { handlers: cocResetHandlers } },
}

export const LoadingState: Story = {
  parameters: { msw: { handlers: loadingHandlers } },
}

export const MobilePortrait: Story = {
  globals: { viewport: { value: 'iphone14', isRotated: false } },
}

export const Tablet: Story = {
  globals: { viewport: { value: 'ipad', isRotated: false } },
}

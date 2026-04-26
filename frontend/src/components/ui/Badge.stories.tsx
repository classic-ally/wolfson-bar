import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './badge'

const meta = {
  title: 'UI/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'],
    },
  },
  args: { children: 'Badge' },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Secondary: Story = { args: { variant: 'secondary' } }

export const Destructive: Story = { args: { variant: 'destructive', children: 'Error' } }

export const Outline: Story = { args: { variant: 'outline' } }

export const VariantMatrix: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
    </div>
  ),
}

export const RoleBadges: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge variant="destructive">Admin</Badge>
      <Badge variant="default">Committee</Badge>
      <Badge variant="secondary">Member</Badge>
    </div>
  ),
}

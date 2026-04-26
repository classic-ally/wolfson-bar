import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
    },
    disabled: { control: 'boolean' },
  },
  args: { children: 'Click me' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Secondary: Story = { args: { variant: 'secondary' } }

export const Outline: Story = { args: { variant: 'outline' } }

export const Ghost: Story = { args: { variant: 'ghost' } }

export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete' } }

export const Link: Story = { args: { variant: 'link', children: 'Read more' } }

export const Disabled: Story = { args: { disabled: true } }

export const SizeMatrix: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="xs">XS</Button>
      <Button size="sm">SM</Button>
      <Button size="default">Default</Button>
      <Button size="lg">LG</Button>
    </div>
  ),
}

export const VariantMatrix: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
}

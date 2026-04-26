import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { DateRangePicker, type DateRange } from './DateRangePicker'

const meta = {
  title: 'UI/DateRangePicker',
  component: DateRangePicker,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof DateRangePicker>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper(props: { defaultValue?: DateRange; minDate?: Date; maxDate?: Date }) {
  const [range, setRange] = useState<DateRange | undefined>(props.defaultValue)
  return (
    <div className="space-y-3">
      <DateRangePicker
        value={range}
        onValueChange={setRange}
        minDate={props.minDate}
        maxDate={props.maxDate}
      />
      <p className="text-sm text-muted-foreground">
        Selected:{' '}
        {range?.from
          ? `${range.from.toDateString()}${range.to ? ' → ' + range.to.toDateString() : ''}`
          : '(none)'}
      </p>
    </div>
  )
}

export const Default: Story = {
  render: () => <Wrapper />,
  args: {},
}

export const WithDefault: Story = {
  render: () => (
    <Wrapper
      defaultValue={{ from: new Date('2026-05-01'), to: new Date('2026-05-28') }}
    />
  ),
  args: {},
}

export const Constrained: Story = {
  render: () => (
    <Wrapper minDate={new Date('2026-05-01')} maxDate={new Date('2026-06-30')} />
  ),
  args: {},
}

export const MobilePortrait: Story = {
  render: () => <Wrapper />,
  globals: { viewport: { value: 'iphone14', isRotated: false } },
  args: {},
}

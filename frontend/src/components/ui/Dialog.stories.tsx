import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Button } from './button'

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Confirm: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. All your data will be permanently removed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button variant="destructive">Confirm delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const FormExample: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Edit profile</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Update your display name.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Display name</span>
            <input
              type="text"
              defaultValue="Allison"
              className="h-8 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
        </div>
        <DialogFooter showCloseButton>
          <Button>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const LongContent: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Show terms</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Terms of service</DialogTitle>
          <DialogDescription>Last updated April 2026.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto pr-2 text-sm leading-6 text-muted-foreground">
          {Array.from({ length: 8 }).map((_, i) => (
            <p key={i} className="mb-3">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Section {i + 1}
              describes the rights and obligations of all parties using the bar
              management system, including but not limited to shift booking, induction
              completion, and food safety obligations.
            </p>
          ))}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  ),
}

import { useState } from 'react'
import { adminSetContract, adminClearContract } from '../../lib/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ContractModalProps {
  userId: string
  userName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export default function ContractModal({
  userId,
  userName,
  open,
  onOpenChange,
  onSaved,
}: ContractModalProps) {
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!date) {
      alert('Please select a date')
      return
    }
    setSaving(true)
    try {
      await adminSetContract(userId, date)
      onSaved()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to set contract')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (
      !confirm(
        "Remove this user's contract? They will no longer be able to sign up for contract-required shifts.",
      )
    ) {
      return
    }
    setSaving(true)
    try {
      await adminClearContract(userId)
      onSaved()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clear contract')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Contract</DialogTitle>
          <DialogDescription>{userName || 'Unknown user'}</DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Contract Expiry Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        <DialogFooter className="!justify-between">
          <Button
            variant="destructive"
            onClick={handleClear}
            disabled={saving}
          >
            Remove Contract
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !date}>
              {saving ? 'Saving…' : 'Set Contract'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

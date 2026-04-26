import { useState } from 'react'
import { Product } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

export interface NewProductModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scannedBarcode: string
  availableProducts: Product[]
  onLink: (productId: number) => void | Promise<void>
  onCreate: (data: { posId: number; name: string; category: string }) => void | Promise<void>
}

export default function NewProductModal({
  open,
  onOpenChange,
  scannedBarcode,
  availableProducts,
  onLink,
  onCreate,
}: NewProductModalProps) {
  const [selectedLinkProductId, setSelectedLinkProductId] = useState<number | null>(null)
  const [posId, setPosId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')

  const handleLink = () => {
    if (selectedLinkProductId !== null) onLink(selectedLinkProductId)
  }

  const handleCreate = () => {
    if (posId === null || !name || !category) return
    onCreate({ posId, name, category })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Barcode Not Found</DialogTitle>
          <DialogDescription>
            Barcode <strong className="text-foreground">{scannedBarcode}</strong> is not linked to any product. Choose an option below.
          </DialogDescription>
        </DialogHeader>

        {(() => {
          const items = availableProducts.map((product) => ({
            value: product.id,
            label: `[${product.id}] ${product.name}`,
          }))
          const selectedItem =
            items.find((i) => i.value === selectedLinkProductId) ?? null
          return (
            <div className="space-y-3">
              <h3 className="text-base font-medium">Link to Existing Product</h3>
              <Combobox
                items={items}
                value={selectedItem}
                onValueChange={(item: typeof items[number] | null) =>
                  setSelectedLinkProductId(item?.value ?? null)
                }
                itemToStringValue={(item: typeof items[number]) => item.label}
              >
                <ComboboxInput placeholder="Search or select a product..." />
                <ComboboxContent>
                  <ComboboxEmpty>No products found.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: typeof items[number]) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {selectedLinkProductId !== null && (
                <Button onClick={handleLink} className="w-full">
                  Link Barcode to Selected Product
                </Button>
              )}
            </div>
          )
        })()}

        {selectedLinkProductId === null && (
          <div className="border-t border-border pt-5 space-y-4">
            <h3 className="text-base font-medium">Or Create New Product</h3>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">PoS ID *</span>
              <input
                type="number"
                value={posId ?? ''}
                onChange={(e) => setPosId(parseInt(e.target.value) || null)}
                placeholder="e.g., 42"
                className="h-9 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Product Name *</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Coca-Cola 330ml Can"
                className="h-9 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Category *</span>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., soft_drinks"
                className="h-9 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>

            <Button
              onClick={handleCreate}
              className="w-full"
              disabled={posId === null || !name || !category}
            >
              Create Product &amp; Link Barcode
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import NewProductModal from './NewProductModal'
import { Button } from '@/components/ui/button'
import type { Product } from '@/lib/auth'

const fixtureProducts: Product[] = [
  { id: 1, name: 'Coca-Cola 330ml', description: null, category: 'soft_drinks', current_stock: 12, last_unit_cost: 0.6, created_at: '', updated_at: '' },
  { id: 2, name: 'Sprite 330ml', description: null, category: 'soft_drinks', current_stock: 4, last_unit_cost: 0.6, created_at: '', updated_at: '' },
  { id: 3, name: 'Heineken 330ml', description: null, category: 'beer', current_stock: 0, last_unit_cost: 1.2, created_at: '', updated_at: '' },
  { id: 4, name: 'Stella Artois 330ml', description: null, category: 'beer', current_stock: 24, last_unit_cost: 1.1, created_at: '', updated_at: '' },
]

const meta = {
  title: 'Committee/NewProductModal',
  component: NewProductModal,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof NewProductModal>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper({ products }: { products: Product[] }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="p-8 space-y-2">
      <Button onClick={() => setOpen(true)}>Re-open modal</Button>
      <NewProductModal
        open={open}
        onOpenChange={setOpen}
        scannedBarcode="5000000000017"
        availableProducts={products}
        onLink={(id) => {
          alert(`Would link barcode to product ${id}`)
          setOpen(false)
        }}
        onCreate={({ posId, name, category }) => {
          alert(`Would create product: PoS ${posId} / ${name} / ${category}`)
          setOpen(false)
        }}
      />
    </div>
  )
}

export const Default: Story = {
  render: () => <Wrapper products={fixtureProducts} />,
  args: {
    open: true,
    onOpenChange: () => {},
    scannedBarcode: '5000000000017',
    availableProducts: fixtureProducts,
    onLink: () => {},
    onCreate: () => {},
  },
}

export const NoExistingProducts: Story = {
  render: () => <Wrapper products={[]} />,
  args: {
    open: true,
    onOpenChange: () => {},
    scannedBarcode: '5000000000017',
    availableProducts: [],
    onLink: () => {},
    onCreate: () => {},
  },
}

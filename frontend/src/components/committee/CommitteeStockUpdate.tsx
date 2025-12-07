import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getProducts, Product, createStockTransactions, StockTransaction, lookupBarcode, addBarcode, createProduct } from '../../lib/auth'
import QRScanner from '../QRScanner'

interface TransactionRow {
  id: string
  product_id: number | null
  product_name: string
  current_stock: number
  quantity: number  // Can be positive or negative
  target_stock: number | null  // Alternative input mode
  unit_cost: number | null
}

export default function CommitteeStockUpdate() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notes, setNotes] = useState('')

  // Global options
  const [useTargetMode, setUseTargetMode] = useState(false)
  const [allowAdjustment, setAllowAdjustment] = useState(false)

  // Barcode scanning state
  const [scanningForRowId, setScanningForRowId] = useState<string | null>(null)
  const [processingScan, setProcessingScan] = useState(false)
  const [showNewProductModal, setShowNewProductModal] = useState(false)
  const [targetRowId, setTargetRowId] = useState<string | null>(null)
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)
  const [selectedLinkProductId, setSelectedLinkProductId] = useState<number | null>(null)
  const [newProductPosId, setNewProductPosId] = useState<number | null>(null)
  const [newProductName, setNewProductName] = useState('')
  const [newProductCategory, setNewProductCategory] = useState('')

  const [rows, setRows] = useState<TransactionRow[]>([
    {
      id: crypto.randomUUID(),
      product_id: null,
      product_name: '',
      current_stock: 0,
      quantity: 0,
      target_stock: null,
      unit_cost: null
    }
  ])

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      const fetchedProducts = await getProducts()
      setProducts(fetchedProducts)
    } catch (err) {
      console.error('Failed to load products:', err)
      alert('Failed to load products. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const addRow = () => {
    setRows([...rows, {
      id: crypto.randomUUID(),
      product_id: null,
      product_name: '',
      current_stock: 0,
      quantity: 0,
      target_stock: null,
      unit_cost: null
    }])
  }

  const removeRow = (id: string) => {
    if (rows.length === 1) {
      alert('You must have at least one transaction row.')
      return
    }
    setRows(rows.filter(row => row.id !== id))
  }

  const updateRow = (id: string, updates: Partial<TransactionRow>) => {
    setRows(rows.map(row =>
      row.id === id ? { ...row, ...updates } : row
    ))
  }

  const handleProductSelect = (id: string, productId: number) => {
    const product = products.find(p => p.id === productId)
    if (product) {
      updateRow(id, {
        product_id: productId,
        product_name: product.name,
        current_stock: product.current_stock,
        // Pre-fill unit cost if we have historical data
        unit_cost: product.last_unit_cost
      })
    }
  }

  const handleTargetStockChange = (id: string, value: string) => {
    const row = rows.find(r => r.id === id)
    if (!row) return

    if (value === '') {
      updateRow(id, {
        target_stock: null,
        quantity: 0
      })
      return
    }

    const targetStock = parseInt(value)
    if (!isNaN(targetStock)) {
      const quantity = targetStock - row.current_stock
      updateRow(id, {
        target_stock: targetStock,
        quantity
      })
    }
  }

  const handleQuantityChange = (id: string, value: string) => {
    if (value === '') {
      updateRow(id, {
        quantity: 0,
        target_stock: null
      })
      return
    }

    const quantity = parseInt(value)
    if (!isNaN(quantity)) {
      updateRow(id, {
        quantity,
        target_stock: null  // Clear target stock when manually entering quantity
      })
    }
  }

  // Get list of products available for a specific row (excluding products selected in other rows)
  const getAvailableProducts = (currentRowId: string) => {
    const selectedProductIds = rows
      .filter(row => row.id !== currentRowId && row.product_id !== null)
      .map(row => row.product_id)

    return products.filter(product => !selectedProductIds.includes(product.id))
  }

  const handleSubmit = async () => {
    // Validate all rows
    const validRows = rows.filter(row => row.product_id !== null && row.quantity !== 0)

    if (validRows.length === 0) {
      alert('Please add at least one valid transaction with a product and non-zero quantity.')
      return
    }

    // Check for duplicate products
    const productIds = validRows.map(row => row.product_id!)
    const duplicates = productIds.filter((id, index) => productIds.indexOf(id) !== index)
    if (duplicates.length > 0) {
      const duplicateProducts = products.filter(p => duplicates.includes(p.id))
      const names = duplicateProducts.map(p => p.name).join(', ')
      alert(`Duplicate products detected: ${names}. Each product can only appear once per transaction.`)
      return
    }

    // Check that positive quantities (purchases) have unit costs unless allow_adjustment is checked
    const invalidPurchases = validRows.filter(row =>
      row.quantity > 0 && !allowAdjustment && (row.unit_cost === null || row.unit_cost <= 0)
    )

    if (invalidPurchases.length > 0) {
      alert('Positive quantities require a valid unit cost unless "Allow adjustment?" is checked.')
      return
    }

    // Convert to API format
    const transactions: StockTransaction[] = validRows.map(row => ({
      product_id: row.product_id!,
      quantity: row.quantity,
      unit_cost: (row.quantity > 0 && !allowAdjustment) ? row.unit_cost! : undefined
    }))

    setSubmitting(true)
    try {
      await createStockTransactions({
        transactions,
        notes: notes.trim() || undefined
      })
      alert(`Successfully created ${transactions.length} stock transaction(s)!`)
      navigate('/committee/stock')
    } catch (err) {
      console.error('Failed to create transactions:', err)
      alert('Failed to create transactions. Please check your input and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (rows.some(row => row.product_id !== null || row.quantity > 0)) {
      if (!confirm('You have unsaved changes. Are you sure you want to cancel?')) {
        return
      }
    }
    navigate('/committee/stock')
  }

  const handleScanBarcode = (rowId: string) => {
    setScanningForRowId(rowId)
  }

  const handleBarcodeScanned = async (barcode: string) => {
    if (!scanningForRowId || processingScan) return

    const rowId = scanningForRowId
    setProcessingScan(true)
    setScanningForRowId(null)

    try {
      // Try to lookup the barcode
      const product = await lookupBarcode(barcode)

      // Check if this product is already used in another row
      const alreadyUsed = rows.some(row => row.id !== rowId && row.product_id === product.id)
      if (alreadyUsed) {
        alert(`"${product.name}" is already selected in another row. Each product can only appear once per transaction.`)
        setProcessingScan(false)
        return
      }

      // Found product - auto-fill the row
      updateRow(rowId, {
        product_id: product.id,
        product_name: product.name,
        current_stock: product.current_stock,
        unit_cost: product.last_unit_cost
      })
      setProcessingScan(false)
    } catch (err) {
      // Barcode not found - show modal to create/link
      setTargetRowId(rowId)
      setScannedBarcode(barcode)
      setShowNewProductModal(true)
      setProcessingScan(false)
    }
  }

  const handleLinkExistingProduct = async () => {
    if (!scannedBarcode || !targetRowId || !selectedLinkProductId) return

    // Check if this product is already used in another row
    const alreadyUsed = rows.some(row => row.id !== targetRowId && row.product_id === selectedLinkProductId)
    if (alreadyUsed) {
      const product = products.find(p => p.id === selectedLinkProductId)
      alert(`"${product?.name}" is already selected in another row. Each product can only appear once per transaction.`)
      setProcessingScan(false)
      return
    }

    try {
      await addBarcode(selectedLinkProductId, scannedBarcode)

      const product = products.find(p => p.id === selectedLinkProductId)
      if (product) {
        updateRow(targetRowId, {
          product_id: product.id,
          product_name: product.name,
          current_stock: product.current_stock,
          unit_cost: product.last_unit_cost
        })
      }

      setShowNewProductModal(false)
      setTargetRowId(null)
      setScannedBarcode(null)
      setSelectedLinkProductId(null)
      setProcessingScan(false)
      alert('Barcode linked successfully!')
    } catch (err) {
      console.error('Failed to link barcode:', err)
      alert('Failed to link barcode. It may already be linked to another product.')
      setProcessingScan(false)
    }
  }

  const handleCreateNewProduct = async () => {
    if (!scannedBarcode || !targetRowId || !newProductPosId || !newProductName || !newProductCategory) {
      alert('Please fill in all fields.')
      return
    }

    try {
      // Create the product
      const newProduct = await createProduct(newProductPosId, {
        name: newProductName,
        category: newProductCategory
      })

      // Link the barcode
      await addBarcode(newProduct.id, scannedBarcode)

      // Add new product to products list (avoid full reload which causes state issues)
      const newProductWithStock = {
        ...newProduct,
        current_stock: 0,
        last_unit_cost: null
      }
      setProducts([...products, newProductWithStock])

      // Auto-fill the row
      updateRow(targetRowId, {
        product_id: newProduct.id,
        product_name: newProduct.name,
        current_stock: 0,  // New product starts with 0 stock
        unit_cost: null
      })

      // Close modal and reset
      setShowNewProductModal(false)
      setTargetRowId(null)
      setScannedBarcode(null)
      setSelectedLinkProductId(null)
      setNewProductPosId(null)
      setNewProductName('')
      setNewProductCategory('')
      setProcessingScan(false)

      alert('Product created and barcode linked successfully!')
    } catch (err: any) {
      console.error('Failed to create product:', err)
      alert(err.message || 'Failed to create product. The PoS ID may already be in use.')
      setProcessingScan(false)
    }
  }

  const handleCloseNewProductModal = () => {
    setShowNewProductModal(false)
    setTargetRowId(null)
    setScannedBarcode(null)
    setSelectedLinkProductId(null)
    setNewProductPosId(null)
    setNewProductName('')
    setNewProductCategory('')
    setProcessingScan(false)
  }

  if (loading) {
    return <div><h1>Add/Update Stock</h1><p>Loading products...</p></div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
        <button
          onClick={handleCancel}
          style={{
            padding: '8px 12px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            marginRight: '15px'
          }}
        >
          ← Back
        </button>
        <h1 style={{ margin: 0 }}>Add/Update Stock</h1>
      </div>

      <p style={{ color: '#666', marginBottom: '20px' }}>
        Toggle between Change mode (±amounts) or Target mode (final stock levels) using the checkbox in the table header.
      </p>

      <div style={{ marginBottom: '30px' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          backgroundColor: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <thead>
            <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
              <th style={{ padding: '12px', textAlign: 'left', width: '25%' }}>Product</th>
              <th style={{ padding: '12px', textAlign: 'right', width: '12%' }}>Current</th>
              <th style={{ padding: '12px', textAlign: 'right', width: '15%' }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useTargetMode}
                    onChange={(e) => setUseTargetMode(e.target.checked)}
                    style={{ marginRight: '6px' }}
                  />
                  {useTargetMode ? 'Target' : 'Change'}
                </label>
              </th>
              <th style={{ padding: '12px', textAlign: 'right', width: '12%' }}>→ After</th>
              <th style={{ padding: '12px', textAlign: 'right', width: '15%' }}>Unit Cost</th>
              <th style={{ padding: '12px', textAlign: 'center', width: '10%' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const remainingAfter = row.product_id ? row.current_stock + row.quantity : null
              const requiresCost = row.quantity > 0 && !allowAdjustment
              const availableProducts = getAvailableProducts(row.id)
              const currentProduct = row.product_id ? products.find(p => p.id === row.product_id) : null

              return (
                <tr key={row.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                  {/* Product selection */}
                  <td style={{ padding: '8px' }}>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <select
                        value={row.product_id || ''}
                        onChange={(e) => handleProductSelect(row.id, parseInt(e.target.value))}
                        style={{
                          flex: 1,
                          padding: '6px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '13px'
                        }}
                      >
                        <option value="">Select...</option>
                        {/* Show currently selected product even if it would otherwise be filtered */}
                        {currentProduct && !availableProducts.find(p => p.id === currentProduct.id) && (
                          <option key={currentProduct.id} value={currentProduct.id}>
                            [{currentProduct.id}] {currentProduct.name}
                          </option>
                        )}
                        {availableProducts.map(product => (
                          <option key={product.id} value={product.id}>
                            [{product.id}] {product.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleScanBarcode(row.id)}
                        style={{
                          padding: '6px 8px',
                          backgroundColor: '#007bff',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '13px'
                        }}
                        title="Scan barcode"
                      >
                        📷
                      </button>
                    </div>
                  </td>

                  {/* Current stock */}
                  <td style={{ padding: '8px', textAlign: 'right', color: '#666' }}>
                    {row.product_id ? row.current_stock : '-'}
                  </td>

                  {/* Quantity change OR Target stock (based on useTargetMode) */}
                  <td style={{ padding: '8px' }}>
                    {useTargetMode ? (
                      <input
                        type="number"
                        min="0"
                        value={row.target_stock === null ? '' : row.target_stock}
                        onChange={(e) => handleTargetStockChange(row.id, e.target.value)}
                        disabled={!row.product_id}
                        style={{
                          width: '100%',
                          padding: '6px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '13px',
                          textAlign: 'right',
                          backgroundColor: !row.product_id ? '#f8f9fa' : 'white'
                        }}
                        placeholder="Target"
                      />
                    ) : (
                      <input
                        type="number"
                        value={row.quantity === 0 ? '' : row.quantity}
                        onChange={(e) => handleQuantityChange(row.id, e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '13px',
                          textAlign: 'right'
                        }}
                        placeholder="±0"
                      />
                    )}
                  </td>

                  {/* Remaining after */}
                  <td style={{
                    padding: '8px',
                    textAlign: 'right',
                    fontWeight: 500,
                    color: remainingAfter !== null ? (remainingAfter < 0 ? '#dc3545' : '#28a745') : '#666'
                  }}>
                    {remainingAfter !== null ? remainingAfter : '-'}
                  </td>

                  {/* Unit cost */}
                  <td style={{ padding: '8px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.unit_cost === null ? '' : row.unit_cost}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === '') {
                          updateRow(row.id, { unit_cost: null })
                        } else {
                          const parsed = parseFloat(val)
                          if (!isNaN(parsed)) {
                            updateRow(row.id, { unit_cost: parsed })
                          }
                        }
                      }}
                      disabled={!requiresCost}
                      style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '13px',
                        textAlign: 'right',
                        backgroundColor: !requiresCost ? '#f8f9fa' : 'white'
                      }}
                      placeholder={requiresCost ? '0.00' : 'N/A'}
                    />
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: rows.length === 1 ? '#ccc' : '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: rows.length === 1 ? 'not-allowed' : 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>

        <div style={{ marginTop: '10px', display: 'flex', gap: '15px', alignItems: 'center' }}>
          <button
            onClick={addRow}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            + Add Row
          </button>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={allowAdjustment}
              onChange={(e) => setAllowAdjustment(e.target.checked)}
              style={{ marginRight: '6px' }}
            />
            Allow adjustments? (no cost required for positive quantities)
          </label>
        </div>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: '8px' }}>
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g., Invoice #1234 from Vendor X, moved to bar for Friday event, etc."
          rows={3}
          style={{
            width: '100%',
            padding: '10px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '14px',
            fontFamily: 'inherit',
            resize: 'vertical'
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            padding: '12px 24px',
            backgroundColor: submitting ? '#6c757d' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 500
          }}
        >
          {submitting ? 'Submitting...' : 'Submit Transactions'}
        </button>
        <button
          onClick={handleCancel}
          disabled={submitting}
          style={{
            padding: '12px 24px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontSize: '16px'
          }}
        >
          Cancel
        </button>
      </div>

      <div style={{
        marginTop: '30px',
        padding: '16px',
        backgroundColor: '#e7f3ff',
        borderRadius: '4px',
        border: '1px solid #bee5eb'
      }}>
        <strong>How it works:</strong>
        <ul style={{ marginTop: '8px', marginBottom: 0, paddingLeft: '20px', fontSize: '14px' }}>
          <li><strong>Change mode:</strong> Enter quantity changes (positive to add, negative to remove)</li>
          <li><strong>Target mode:</strong> Check the box in the header to enter final stock levels instead</li>
          <li><strong>Unit cost:</strong> Required for positive quantities (purchases) unless "Allow adjustments?" is checked</li>
          <li><strong>Allow adjustments:</strong> Check to make corrections without tracking costs</li>
        </ul>
      </div>

      {/* Barcode Scanner */}
      {scanningForRowId && (
        <QRScanner
          onScan={handleBarcodeScanned}
          onClose={() => setScanningForRowId(null)}
        />
      )}

      {/* New Product Modal */}
      {showNewProductModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '30px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
          >
            <h2 style={{ marginTop: 0 }}>Barcode Not Found</h2>
            <p style={{ color: '#666', marginBottom: '20px' }}>
              Barcode <strong>{scannedBarcode}</strong> is not linked to any product.
              Choose an option below:
            </p>

            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>Link to Existing Product</h3>
              <select
                value={selectedLinkProductId || ''}
                onChange={(e) => setSelectedLinkProductId(e.target.value ? parseInt(e.target.value) : null)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  marginBottom: '10px'
                }}
              >
                <option value="">Select a product...</option>
                {(() => {
                  const availableProducts = targetRowId ? getAvailableProducts(targetRowId) : products
                  return availableProducts.map(product => (
                    <option key={product.id} value={product.id}>
                      [{product.id}] {product.name}
                    </option>
                  ))
                })()}
              </select>

              {selectedLinkProductId && (
                <button
                  onClick={handleLinkExistingProduct}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  Link Barcode to Selected Product
                </button>
              )}
            </div>

            {!selectedLinkProductId && (
              <div style={{ borderTop: '1px solid #ddd', paddingTop: '20px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '16px', marginBottom: '15px' }}>Or Create New Product</h3>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '5px' }}>
                  PoS ID *
                </label>
                <input
                  type="number"
                  value={newProductPosId || ''}
                  onChange={(e) => setNewProductPosId(parseInt(e.target.value) || null)}
                  placeholder="e.g., 42"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '5px' }}>
                  Product Name *
                </label>
                <input
                  type="text"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="e.g., Coca-Cola 330ml Can"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: '5px' }}>
                  Category *
                </label>
                <input
                  type="text"
                  value={newProductCategory}
                  onChange={(e) => setNewProductCategory(e.target.value)}
                  placeholder="e.g., soft_drinks"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
              </div>

              <button
                onClick={handleCreateNewProduct}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Create Product &amp; Link Barcode
              </button>
            </div>
            )}

            <button
              onClick={handleCloseNewProductModal}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

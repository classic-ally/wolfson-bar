import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getProducts, Product } from '../../lib/auth'

export default function CommitteeStock() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

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

  const getCategories = (): string[] => {
    const categories = new Set(products.map(p => p.category))
    return Array.from(categories).sort()
  }

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(filter.toLowerCase()) ||
                          product.description?.toLowerCase().includes(filter.toLowerCase()) ||
                          product.id.toString().includes(filter)
    const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const formatCurrency = (amount: number | null): string => {
    if (amount === null) return '-'
    return `£${amount.toFixed(2)}`
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Stock Management</h1>
        <button
          style={{
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500
          }}
          onClick={() => navigate('/committee/stock/update')}
        >
          + Add/Update Stock
        </button>
      </div>

      <p style={{ color: '#666', marginBottom: '20px' }}>
        View and manage bar stock levels, pricing, and inventory.
      </p>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <input
          type="text"
          placeholder="Search by name, description, or PoS ID..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            padding: '10px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '14px'
          }}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            padding: '10px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '14px',
            minWidth: '150px'
          }}
        >
          <option value="all">All Categories</option>
          {getCategories().map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : products.length === 0 ? (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          backgroundColor: '#f8f9fa',
          borderRadius: '4px',
          color: '#666'
        }}>
          <p style={{ margin: 0, marginBottom: '10px' }}>No products in stock system yet.</p>
          <p style={{ margin: 0, fontSize: '14px' }}>Click "Add/Update Stock" to get started.</p>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '10px', color: '#666', fontSize: '14px' }}>
            Showing {filteredProducts.length} of {products.length} products
          </div>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            backgroundColor: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '12px', textAlign: 'left', width: '80px' }}>PoS ID</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Product Name</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Category</th>
                <th style={{ padding: '12px', textAlign: 'right', width: '100px' }}>Stock Level</th>
                <th style={{ padding: '12px', textAlign: 'right', width: '120px' }}>Last Unit Cost</th>
                <th style={{ padding: '12px', textAlign: 'right', width: '120px' }}>Total Value</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const isLowStock = product.current_stock < 10
                const totalValue = product.last_unit_cost !== null
                  ? product.current_stock * product.last_unit_cost
                  : null

                return (
                  <tr
                    key={product.id}
                    style={{
                      borderBottom: '1px solid #dee2e6',
                      backgroundColor: isLowStock ? '#fff3cd' : 'white'
                    }}
                  >
                    <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: 500 }}>
                      {product.id}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 500 }}>{product.name}</div>
                      {product.description && (
                        <div style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>
                          {product.description}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{
                        padding: '4px 8px',
                        backgroundColor: '#e7f3ff',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 500
                      }}>
                        {product.category}
                      </span>
                    </td>
                    <td style={{
                      padding: '12px',
                      textAlign: 'right',
                      fontWeight: 500,
                      color: isLowStock ? '#856404' : 'inherit'
                    }}>
                      {product.current_stock}
                      {isLowStock && <span style={{ marginLeft: '4px' }}>⚠️</span>}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      {formatCurrency(product.last_unit_cost)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 500 }}>
                      {formatCurrency(totalValue)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div style={{
            marginTop: '20px',
            padding: '16px',
            backgroundColor: '#e7f3ff',
            borderRadius: '4px',
            border: '1px solid #bee5eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <strong>Total Inventory Value:</strong>{' '}
              {formatCurrency(
                filteredProducts.reduce((sum, p) => {
                  if (p.last_unit_cost !== null) {
                    return sum + (p.current_stock * p.last_unit_cost)
                  }
                  return sum
                }, 0)
              )}
            </div>
            <div style={{ fontSize: '14px', color: '#666' }}>
              ⚠️ = Low stock warning (&lt; 10 units)
            </div>
          </div>
        </>
      )}
    </div>
  )
}

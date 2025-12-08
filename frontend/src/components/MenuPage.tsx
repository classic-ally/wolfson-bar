import { usePageTitle } from '../hooks/usePageTitle'

export default function MenuPage() {
  usePageTitle('Menu')

  return (
    <main className="content" style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
      <h1>Bar Menu</h1>
      <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#666' }}>
        Menu coming soon...
      </p>
    </main>
  )
}

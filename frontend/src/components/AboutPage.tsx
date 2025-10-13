import { useState } from 'react'

type TabType = 'about' | 'rota' | 'barco'

export default function AboutPage() {
  const [activeTab, setActiveTab] = useState<TabType>('about')

  return (
    <main className="content" style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ borderBottom: '2px solid #e0e0e0', marginBottom: '30px', overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ display: 'flex', gap: '0', minWidth: 'max-content' }}>
          <button
            onClick={() => setActiveTab('about')}
            style={{
              padding: '12px 24px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'about' ? '#8B0000' : '#666',
              borderBottom: activeTab === 'about' ? '3px solid #8B0000' : '3px solid transparent',
              marginBottom: '-2px',
              fontWeight: activeTab === 'about' ? 600 : 400,
              fontSize: '16px'
            }}
          >
            About
          </button>
          <button
            onClick={() => setActiveTab('rota')}
            style={{
              padding: '12px 24px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'rota' ? '#8B0000' : '#666',
              borderBottom: activeTab === 'rota' ? '3px solid #8B0000' : '3px solid transparent',
              marginBottom: '-2px',
              fontWeight: activeTab === 'rota' ? 600 : 400,
              fontSize: '16px'
            }}
          >
            Rota Members
          </button>
          <button
            onClick={() => setActiveTab('barco')}
            style={{
              padding: '12px 24px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === 'barco' ? '#8B0000' : '#666',
              borderBottom: activeTab === 'barco' ? '3px solid #8B0000' : '3px solid transparent',
              marginBottom: '-2px',
              fontWeight: activeTab === 'barco' ? 600 : 400,
              fontSize: '16px'
            }}
          >
            BarCo
          </button>
        </div>
      </div>

      {activeTab === 'about' && (
        <div>
          <h2>Welcome to the Cellar Bar</h2>
          <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#333' }}>
            The Wolfson College Cellar Bar is run entirely on a voluntary basis, which means that drink and snack prices are amongst the cheapest anywhere in Oxford. People who sign up to be part of the bar are trained and then are put on the monthly rota. Each night, two people open, run and shut the bar. If you would like to know more about the history of the bar visit the{' '}
            <a
              href="https://www.wolfson.ox.ac.uk/12-the-cellar-bar/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#8B0000', textDecoration: 'underline' }}
            >
              Wolfson website
            </a>.
          </p>
        </div>
      )}

      {activeTab === 'rota' && (
        <div>
          <h2>Rota Membership</h2>
          <p>Content coming soon...</p>
        </div>
      )}

      {activeTab === 'barco' && (
        <div>
          <h2>Bar Committee (BarCo)</h2>
          <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#333', marginBottom: '16px' }}>
            The bar is managed by a dedicated committee of Wolfson members who work together to keep everything running smoothly. The Executive Team is made up of the Chair, the Treasurer who also acts as Vice-Chair, the Stock Manager, and the Secretary.
          </p>
          <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#333', marginBottom: '16px' }}>
            Other important roles on the committee include Rota Manager, Entertainment Manager, Social Secretary (and sub-committee) and IT Manager.
          </p>
          <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#333' }}>
            Elections for committee positions are held during Hilary Term. If you are interested in getting involved, keep an eye out for announcements or speak to a current member of the team.
          </p>
        </div>
      )}
    </main>
  )
}

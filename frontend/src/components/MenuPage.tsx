import { usePageTitle } from '../hooks/usePageTitle'

export default function MenuPage() {
  usePageTitle('Menu')

  const sectionStyle = {
    marginBottom: '24px',
  }

  const headingStyle = {
    fontSize: '18px',
    fontWeight: 600 as const,
    marginBottom: '8px',
  }

  const textStyle = {
    fontSize: '16px',
    lineHeight: '1.6',
    color: '#444',
  }

  return (
    <main className="content" style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
      <h1>Bar Menu</h1>
      <p style={{ ...textStyle, marginBottom: '32px' }}>
        We offer a wide selection of drinks to suit every taste.
      </p>

      <div style={sectionStyle}>
        <h3 style={headingStyle}>On Draught</h3>
        <p style={textStyle}>
          Enjoy our rotating and classic taps, including Neck Oil, Camden Hells, Asahi, and Orchard Pig.
          We also feature a rotating monthly tap and a selection of rotating cask ales.
        </p>
      </div>

      <div style={sectionStyle}>
        <h3 style={headingStyle}>Bottles &amp; Cans</h3>
        <p style={textStyle}>
          Choose from craft beer cans and bottles, fruit ciders, non-alcoholic beer, and a variety of soft drinks.
        </p>
      </div>

      <div style={sectionStyle}>
        <h3 style={headingStyle}>Wine</h3>
        <p style={textStyle}>
          We also offer a selection of wines, with options to suit a variety of preferences.
        </p>
      </div>

      <div style={sectionStyle}>
        <h3 style={headingStyle}>Spirits &amp; More</h3>
        <p style={textStyle}>
          Our bar is stocked with a large selection of liqueurs, whiskies, rums, tequilas, vodkas, and gins.
          Don't miss our unique Wolfson Ale and Wolfson Gin.
        </p>
      </div>

      <div style={sectionStyle}>
        <h3 style={headingStyle}>Snacks</h3>
        <p style={textStyle}>
          We also offer a range of bar snacks, perfect to enjoy alongside your drink.
        </p>
      </div>

      <p style={{ ...textStyle, marginTop: '32px', fontStyle: 'italic' }}>
        Whether you're after a classic pint or something new to try, there's something here for everyone.
      </p>
    </main>
  )
}

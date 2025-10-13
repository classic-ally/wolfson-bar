import { useState } from 'react'
import ReactMarkdown from 'react-markdown'

const cocContent = `# Wolfson Cellar Bar - Code of Conduct

ALL trained Rota Members of the Wolfson College bar MUST read and accept the following Code of Conduct to be issued with a 2025-2026 Rota Member card.

Upon completion of this form, Rota Members will be issued with a physical rota card and a digital copy of the Code of Conduct. Only those with a valid 2025-2026 Rota Member card will be able to sign out the Bar keys from the Porters Lodge.

There are two sections to the Code of Conduct. Please ensure that you read each carefully.

## Members' Understanding

BarCo asks that all Rota members read and abide by this Code of Conduct while working a bar shift. They should also conduct themselves in an appropriate manner when off-duty as a bar patron.

**Rota members understand that...**

- Rota Members are responsible for opening, running and shutting the bar for the duration of their shifts. They should ask for help as needed from BarCo, or the Lodge in the cases of security or medical issues, or other emergencies.
- When not working a shift, Rota Members are not entitled to enter the behind-the-bar area without the express permission of the on-duty Rota Members or BarCo Officers.
- BarCo Officers are permitted in the behind-the-bar area at all times.
- Bar patrons are expected to conduct themselves responsibly in the bar, and be courteous to on-duty Rota Members, other patrons, and all other members of College, including staff and College guests.
- Rota Members are within their rights to stop serving and close the bar at any time. BarCo asks that Rota Members notify them if the bar closes early.
- BarCo Officers have the right to close the bar at any time if they deem it necessary.
- Rota Members in breach of this Code of Conduct may have their Rota membership suspended at the discretion of the Bar Committee.

## Expected Conduct of Members

**Rota members will…**

- **Attend shifts** they have been assigned by the Rota Manager. If they are unable to work a shift they are signed up for, they will:
    - Arrange a shift swap as far in advance if possible.
    - Notify their shift partner and BarCo ASAP if they are unable to work a shift at the last minute.
- **Work at least one shift per month.**
- **Ensure that they have their Rota Member card** when collecting the bar keys from the Porters Lodge. Keys will not be issued to any Rota Members without a card.
- **Ensure that non-Rota Members do not enter the behind-the-bar area** at any time.
- **Serve alcohol responsibly** and in accordance with legal requirements:
    - All alcohol consumed from the bar must be paid for. This should be done at the point of purchase using cash, debit/credit card, or with Bar Credit from a Wolfson Bod Card.
    - It is not permitted to set up tabs.
    - All alcohol must be sold in legal measures (25ml for spirits and liqueurs, or full or ½ pints for draught beers and ciders). These should be measured using the measures provided. Free-pouring is not permitted.
    - Do not serve alcohol to those who could be a danger to themselves or others as a result of excessive alcohol consumption. Ask the Lodge for assistance if it becomes necessary to remove members from the bar. Do not attempt to do this yourself.
- **Prepare food safely:**
    - Check that paninis are in-date before cooking, following packet instructions for microwaving, and serve in a keep-warm food bag with a napkin.
- **Keep music at a sensible volume.**
- **Ring the bell for last orders** 15-30 minutes before the end of service.
- **Ensure that the bar closing times are adhered to.** These are legal requirements as well as BarCo and College policy, and there are no exceptions to the times at which we must stop serving or the bar must be closed.
- **Cooperate with all requests from Porters** regarding volume of music and closing the bar. Porters have complete authority to close the bar before time if they deem it necessary.
- **Make a reasonable effort to ensure that guests (non-members) are signed in** to the bar's guest book upon arrival, in line with the legal requirements of the bar's Members Club licence.
    - Nonetheless, it is not the sole responsibility of voluntary Rota members to ensure adherence to these rules. The onus remains on Club Members to ensure their guests are properly signed in.
- **Conduct themselves responsibly in the bar.**
- **Be polite and courteous** to all members of College, including Porters and other College staff.
- **Return the Rota Keys to the Lodge immediately after a shift.** It is the responsibility of whoever signed out the keys to make sure they are either returned to the Internal Mail slot, or handed directly to the Night Porter.
- **The Bar must be left in a sanitary and tidy condition:**
    - Wipe down prep and serving surfaces
    - Clean the drip trays, beer mats, draught nozzles, microwave and other utensils.
    - Collect and clean/recycle glasses/cups.
    - Take out the bins.
    - Turn off equipment (including draining the dishwasher) and lights at the end of a shift.
    - Keep fridges stocked if possible.

---

**I confirm that I have read, understood, and agree to abide by the above Code of Conduct for Wolfson Cellar Bar Members. I accept that the digital entry of my name in the form below acts as a signature of agreement.**
`

interface CodeOfConductProps {
  onAccept: () => void
  onDecline: () => void
}

export default function CodeOfConduct({ onAccept, onDecline }: CodeOfConductProps) {
  const [agreed, setAgreed] = useState(false)
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget
    const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 10
    if (isAtBottom) {
      setHasScrolledToBottom(true)
    }
  }

  return (
    <div style={{
      maxWidth: '800px',
      margin: '40px auto',
      padding: '20px',
      backgroundColor: 'white',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
    }}>
      <div
        onScroll={handleScroll}
        style={{
          maxHeight: '60vh',
          overflow: 'auto',
          padding: '20px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          marginBottom: '20px',
          backgroundColor: '#fafafa'
        }}
      >
        <ReactMarkdown>{cocContent}</ReactMarkdown>
      </div>

      {!hasScrolledToBottom && (
        <div style={{
          textAlign: 'center',
          color: '#666',
          marginBottom: '10px',
          fontSize: '14px'
        }}>
          ↓ Please scroll to the bottom to continue ↓
        </div>
      )}

      <div style={{ marginBottom: '20px' }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: hasScrolledToBottom ? 'pointer' : 'not-allowed',
          opacity: hasScrolledToBottom ? 1 : 0.5
        }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={!hasScrolledToBottom}
            style={{ width: '20px', height: '20px' }}
          />
          <span>
            I confirm that I have read, understood, and agree to abide by the above Code of Conduct
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button
          onClick={onDecline}
          style={{
            padding: '10px 30px',
            backgroundColor: '#666',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Decline
        </button>
        <button
          onClick={onAccept}
          disabled={!agreed}
          style={{
            padding: '10px 30px',
            backgroundColor: agreed ? '#8B0000' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: agreed ? 'pointer' : 'not-allowed'
          }}
        >
          Accept and Continue
        </button>
      </div>
    </div>
  )
}

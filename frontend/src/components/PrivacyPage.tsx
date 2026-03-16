import { usePageTitle } from '../hooks/usePageTitle'

export default function PrivacyPage() {
  usePageTitle('Privacy Notice')

  return (
    <main className="content" style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
      <h1>Privacy Notice</h1>

      <div style={{ lineHeight: 1.8, color: '#333' }}>
        <h2>What we collect</h2>
        <p>When you create an account, we store:</p>
        <ul>
          <li><strong>Display name</strong> - so other volunteers and committee members can identify you on the rota</li>
          <li><strong>Passkey credential</strong> - a public key used to authenticate you (we never see your private key)</li>
          <li><strong>Email address</strong> (optional) - if you choose to provide one, for sign-in and shift notifications</li>
          <li><strong>Food safety certificate</strong> - uploaded as part of onboarding, reviewed by committee</li>
          <li><strong>Contract details</strong> - expiry date, if applicable for paid shifts</li>
          <li><strong>Shift signup history</strong> - which shifts you've signed up for</li>
          <li><strong>Onboarding status</strong> - which steps you've completed (CoC, food safety, induction)</li>
        </ul>

        <h2>Why we collect it</h2>
        <p>We collect this data solely to operate the Wolfson Cellar Bar volunteer rota system. Specifically:</p>
        <ul>
          <li>To authenticate you and manage your account</li>
          <li>To track onboarding progress and ensure food safety compliance</li>
          <li>To manage shift scheduling and display the rota</li>
          <li>To send you shift change notifications (only if you opt in)</li>
        </ul>

        <h2>Who can access your data</h2>
        <ul>
          <li><strong>You</strong> can view and export all your data from your profile</li>
          <li><strong>Committee members</strong> can see your display name, shift signups, and onboarding status</li>
          <li><strong>Admins</strong> can additionally manage user roles</li>
          <li>Your email address is only visible to you</li>
          <li>We do not share your data with third parties, except Resend (our email provider) if you opt into email notifications</li>
        </ul>

        <h2>Data retention</h2>
        <ul>
          <li>Your account data is retained while your account is active</li>
          <li>Shift signup records are retained for the academic year for operational purposes</li>
          <li>You can delete your account at any time, which removes all your data</li>
        </ul>

        <h2>Your rights</h2>
        <p>Under UK GDPR, you have the right to:</p>
        <ul>
          <li><strong>Access</strong> your data - use the "Download My Data" button on your profile</li>
          <li><strong>Rectify</strong> your data - edit your display name and email on your profile</li>
          <li><strong>Erase</strong> your data - use the "Delete My Account" button on your profile</li>
          <li><strong>Object</strong> to processing - contact the college Data Protection Officer</li>
          <li><strong>Data portability</strong> - your data export is provided in JSON format</li>
        </ul>

        <h2>Contact</h2>
        <p>
          For any questions about how your data is handled, contact the Wolfson College
          Data Protection Officer through the college's main office.
        </p>
      </div>
    </main>
  )
}

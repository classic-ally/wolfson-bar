# Wolfson Bar - Rota Management System

A passkey-authenticated bar rota management system with TypeScript frontend and Rust backend.

**Work in Progess** - Following initial committee review we intend to pilot this system with committee members to observe any bugs or feature additions that may be necessary for replacing the existing Google Sheets infrastructure.

## Demo Videos

### Onboarding Flow
https://github.com/user-attachments/assets/a6c941d3-b631-4477-977c-6d5a1206f7a7

- **User signs up** 
  - No info leaked except onboarding shifts to unknown users (can potentially be further improved by gating to users with food safety training upload only)
  - Passkey auth, only info collected is a display name
- **User accepts Code of Conduct and uploads Food Safety Training** 
  - Supports JPEG/PNG/PDF up to 5MB 
  - Stored as binary blob in database for simplicity, no object sotrage
- **Committee member verifies Food Safety Training** 
  - Committee dashboard page displayed to authorized BarCo committee members only
  - Provides one-stop shop for evaluating volunteer signup rates, retention, etc, as well as events planning infra
- **User signs up for induction shift** 
  - Restricted from signing up for general shifts until after attending this shift
- **User shows QR code to committee member at induction shift**
  - In-person validation step enforced by UI design
- **Committee member scans QR code to mark user as full rota member**
  - No need to look up user, easy UX

### Integrated Events and Rota
https://github.com/user-attachments/assets/4ca3bc44-fece-417b-8c5a-65fd81ad51a3

- **Integrated rota requirements with scheduled events**
  - Event requirements (need contract members, need more than minimum bartenders, etc) are automatically integrated into sign-up sheet
  - Sign-up sheet uses same UI as logged-out event listing for standardized interface
- **Easy event configuration reducing inter-committee communications burden**
  - Events manager can easily create recurring events as well as one-off events without needing to consult IT manager
- **Calendar integration**
  - iCal subscription support for both general events and My Shifts interface 
  - Shifts you sign up for show up directly in your phone's calendar

## Architecture

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust + Axum + SQLite + WebAuthn
- **Auth**: Passkeys (WebAuthn) - no passwords, biometric login
- **Database**: SQLite (portable, zero-config)
- **Type Safety**: ts-rs generates TypeScript types from Rust (in-progress, currently using duplicated types)

## How Passkeys Work

### Registration Flow
```
User clicks "Register"
  → Backend generates challenge
  → Browser prompts for biometric/PIN
  → Device creates key pair (private key stays on device!)
  → Public key sent to backend
  → Backend stores public key + issues JWT
```

### Login Flow
```
User clicks "Login"
  → Backend generates challenge
  → Browser prompts for biometric/PIN
  → Device signs challenge with private key
  → Signature sent to backend
  → Backend verifies with stored public key
  → Issues JWT
```

## Security Features

- **No passwords** - Can't be phished or leaked
- **Biometric** - Touch ID, Face ID, Windows Hello
- **Device-bound** - Private key never leaves device (but supports syncing with iCloud/Chrome passwords)
- **Domain-bound** - Credentials tied to deployed domain
- **Replay-proof** - Each challenge is unique

## Data Storage (Privacy-First)

### What's Stored in Database
```sql
users
  - id (random UUID)
  - display_name (optional, can be pseudonym)
  - passkey_credential (public key only!)
  - created_at
```

### What's NOT Stored
- ❌ Passwords
- ❌ Email addresses
- ❌ Personal information
- ❌ Private keys (stay on device)

## Development Tips

### Testing Locally
- Passkeys work on `localhost` (no HTTPS needed for dev)
- Mobile: Use your phone's biometrics

## Support

Questions? Open an issue or ask in the bar! 🍺

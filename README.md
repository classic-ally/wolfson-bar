# Wolfson Bar - Rota Management System

A passkey-authenticated bar rota management system with TypeScript frontend and Rust backend.

**Work in Progess** - Following initial committee review we intend to pilot this system with committee members to observe any bugs or feature additions that may be necessary for replacing the existing Google Sheets infrastructure.

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

**No passwords** - Can't be phished or leaked
**Biometric** - Touch ID, Face ID, Windows Hello
**Device-bound** - Private key never leaves device
**Domain-bound** - Credentials tied to deployed domain
**Replay-proof** - Each challenge is unique

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

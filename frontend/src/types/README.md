# Generated Types

This directory will contain TypeScript types automatically generated from the Rust backend using `ts-rs`.

## Usage

Types are generated when you run tests in the Rust backend:

```bash
cd ../backend
cargo test
```

This will generate files like:
- `Event.ts`
- `Shift.ts`
- `User.ts`
- etc.

Then import them in your frontend:

```typescript
import { Event } from './types/Event'
import { Shift } from './types/Shift'
```

## Manual Types

Until the backend is ready, we're using manual type definitions in `App.tsx`.

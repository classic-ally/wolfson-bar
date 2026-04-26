# Generated Types

TypeScript bindings emitted from Rust types in the backend via `ts-rs`.

The `*.ts` files in this directory are gitignored and regenerated on demand.

## How they get here

- `pnpm dev` and `pnpm build` regenerate via the `prebuild`/`predev` lifecycle scripts.
- `nix develop` regenerates on shell entry if missing (see `flake.nix` shellHook).
- `nix build` produces them through a dedicated `ts-bindings` derivation that the `frontend` derivation copies in.
- Manual: `cd ../../backend && cargo test --tests export_bindings_` (or `pnpm gen-types` from `frontend/`).

## Path resolution

`backend/.cargo/config.toml` sets `TS_RS_EXPORT_DIR` relative to the backend crate root, so the destination is stable regardless of where `cargo test` is invoked from.

## Importing

```typescript
import type { UserStatus } from '../types/UserStatus'
```

Components import directly from `../types/X`; data shapes are not re-exported through `lib/auth.ts`.

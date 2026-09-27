# Spikes

Throwaway Phase 0 proofs of concept. They are not part of the workspace and are
not built or tested by Turborepo.

| Spike | Verdict |
| --- | --- |
| `convex-selfhost` | Proceed: Convex self-hosting + Better Auth generic OIDC. |
| `blobatar-rn` | Proceed: Blobatar deterministic avatars in React Native. |
| `mls-demo` | **Deleted.** The client-side MLS (`ts-mls`, RFC 9420) spike is superseded by the move to server-side encryption with an External Key Manager. |

The `mls-demo` directory (a two-device MLS demo depending on `ts-mls` and
`packages/crypto`) was removed along with the obsolete `@aulora/crypto` package;
Aulora no longer ships a client-side E2EE crypto core.

# Licensing

Aulora uses a dual license.

## PolyForm Noncommercial 1.0.0

The full text ships in the repository root as `LICENSE`. It allows personal use
(hobby, study, private entertainment, amateur pursuits, religious observance)
and use by charities, schools, public research, public-safety/health and
environmental organizations, and government bodies. It does **not** allow
commercial use. Aulora is source-available, not OSI open source.

## Commercial license

Any company or for-profit team running Aulora for work needs the paid
commercial license. The terms and pricing are not finalized; see
`COMMERCIAL.md` in the repository root for the current stub.

## How enforcement works

There is no DRM. The [admin panel](admin.md) license screen shows the parsed
status (unlicensed, active, expired or invalid) and reminds unlicensed
commercial installs. A key looks like:

```
AULORA1.CO.20271231.20260101.ACME_CORP.K3F9
```

The tier (`CO` commercial, `NC` noncommercial), expiry date, issue date and
licensee are visible, and a short checksum catches typos. Key format lives in
`packages/convex/convex/lib/license.ts`. Compliance is your responsibility.

## Contributions

Contributors sign a CLA so the project can keep selling commercial licenses
while contributors keep their copyright. See `CONTRIBUTING.md` and `CLA.md` in
the repository root.

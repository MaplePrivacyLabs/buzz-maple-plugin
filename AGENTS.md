# Maple Buzz plugin

Standalone plugin for the stock Buzz 1.0.0 public API. Keep runtime imports and
third-party dependencies out of the built single-file module. Do not import
private Buzz internals or change owner admission. Keep credentials, user
profiles and deployment-specific configuration out of this repository.

Use `nix develop --no-update-lock-file -c node --test` and
`nix develop --no-update-lock-file -c node scripts/build.mjs`. The build is
concatenation, not dependency resolution. Keep the pinned Nix input unchanged
for routine work. Test protocol behavior and lifecycle, not implementation text.
Automated tests use protocol fixtures. Run live sign-in, inference and desktop
checks only on a chosen test computer with authorized accounts; never include
account data or raw conversation captures in commits.

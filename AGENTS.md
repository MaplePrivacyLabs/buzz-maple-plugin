# Maple Buzz plugin

Standalone plugin for the stock Buzz 1.0.0 public API. Keep runtime imports and
third-party dependencies out of the built single-file module. Do not import
private Buzz internals or change owner admission. No credentials, profiles or
company machine inventory in this repository.

Use `nix develop --no-update-lock-file -c node --test` and
`nix develop --no-update-lock-file -c node scripts/build.mjs`. The build is
concatenation, not dependency resolution. Keep the pinned Nix input unchanged
for routine work. Test protocol behavior and lifecycle, not implementation text.
Never start a real agent on the administrative Mac; fixtures only. Actual
sign-in, inference and desktop acceptance run on the selected worker.

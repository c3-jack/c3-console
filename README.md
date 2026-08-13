# c3-console

Personal console for calling C3 AI platform REST endpoints against any app —
point it at a base URL + auth token and run type/method calls, with grid/tree
rendering, saved profiles, and console shortcuts.

## Dev

```
npm install
npm run dev
```

## Release

Builds an ad-hoc-signed `.dmg` and publishes it to GitHub Releases, which
`electron-updater` checks on every launch.

```
npm run build          # build only, no publish
GH_TOKEN=$(gh auth token) npm run publish
```

First install from a release still needs one Gatekeeper "unidentified
developer" right-click → Open (no paid Apple Developer ID). In-app
auto-updates after that apply silently.

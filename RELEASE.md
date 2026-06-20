# Releasing `@applaudiq/embed-react-native`

Maintainer guide for publishing the SDK to npm. Releases use [release-it](https://github.com/release-it/release-it)
— one command does the version bump, build, git tag, and `npm publish`.

## One-time setup

1. **npm org + access.** This is a public, scoped package (`@applaudiq/…`). Create the free **`@applaudiq`**
   organization once at [npmjs.com → Add Organization](https://www.npmjs.com/org/create) and make sure your npm
   account is a member with publish rights.
2. **Authenticate.** Either `npm login` interactively, or for CI export an **Automation** token (Classic token →
   Automation; it bypasses 2FA):
   ```sh
   export NPM_TOKEN=<your-automation-token>
   echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc
   ```
3. **Git remote.** Tags are pushed on release, so add the remote once:
   ```sh
   git remote add origin git@github.com:therewardstore/applaudiq-embed-react-native.git
   ```

## Each release

1. **Update the changelog.** Add a new `## [X.Y.Z]` section to [`CHANGELOG.md`](./CHANGELOG.md) describing the
   changes (it's hand-curated — release-it does **not** generate it).
2. **Commit everything** — release-it requires a clean working tree.
3. **Release:**
   ```sh
   npm install          # ensure release-it + builder-bob are present
   npm run release      # prompts for patch / minor / major
   ```
   `npm run release` runs `release-it`, which: runs `typecheck` → bumps `package.json` → rebuilds `lib/`
   (`bob build`) → `npm publish --access public` → commits `chore: release X.Y.Z` → tags **`X.Y.Z`** (bare, no `v`,
   matching the iOS/Android repos) → pushes the commit + tag.

   To rehearse without publishing:
   ```sh
   npm run release -- --dry-run
   ```

## After publishing

The example apps consume the SDK via a local `file:` path **pre-publish**. Once it's on npm, switch each example's
`package.json` from the `file:` path to the published version and drop the `watchFolders` line in `metro.config.js`:

```json
"@applaudiq/embed-react-native": "^1.0.0"
```

(`applaudiq-sdk-example/native-integration/react-native-cli` and `…/react-native-expo` — their READMEs document this.)

## Notes

- **2FA:** if your account requires it and you're not using an automation token, release-it prompts for the OTP.
- **Recovery:** if the version bumped but `npm publish` failed (e.g. network/2FA), re-run with
  `npm run release -- --no-increment` to publish the current version without bumping again.
- **What ships:** only the `files` allowlist — `src/`, `lib/`, `README.md`, `CHANGELOG.md`, `LICENSE`. Verify with
  `npm pack --dry-run`.

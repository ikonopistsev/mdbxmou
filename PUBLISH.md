# Release Process

## Publishing to NPM

This package uses GitHub Actions for automated publishing to NPM.

### How to publish a new version:

1. Update the version in `package.json`:
   ```bash
   npm version patch  # for bug fixes
   npm version minor  # for new features
   npm version major  # for breaking changes
   ```

2. Push the version tag:
   ```bash
   git push origin main --tags
   ```

3. The GitHub Action will automatically:
   - Run tests
   - Build the native module
   - Publish to NPM

### Manual publish:

If you need to publish manually:

```bash
npm run build
npm publish --access public
```

### Requirements:

- NPM_AUTH_TOKEN secret must be set in GitHub repository settings
- The token should have publish permissions for the mdbxmou package

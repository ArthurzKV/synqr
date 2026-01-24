# Contributing to SyncForge

Thanks for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/ArthurzKV/syncforge.git
cd syncforge

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

## Project Structure

```
packages/
├── core/    # CRDT engine, clock, document, merge
├── types/   # CRDT type implementations
├── schema/  # Schema system
└── sync/    # Sync protocol and plugins
```

## Making Changes

1. Fork the repo
2. Create a branch: `git checkout -b my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit: `git commit -m "feat: add something"`
6. Push: `git push origin my-feature`
7. Open a Pull Request

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `test:` adding tests
- `refactor:` code change that doesn't fix/add

## Code Style

- TypeScript strict mode
- No `any` types unless absolutely necessary
- Write tests for new features

## Questions?

Open a [Discussion](https://github.com/ArthurzKV/syncforge/discussions) or file an issue.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-01-24

### Added

- **@syncforge/core**
  - Hybrid Vector Clock system
  - Document container with subscriptions
  - Merge engine for conflict resolution
  - Operation system for all CRDT types

- **@syncforge/types**
  - LWWRegister and MVRegister
  - GCounter and PNCounter
  - AWSet (Add-Wins Set)
  - AWMap (Add-Wins Map)
  - FugueList (ordered list with Fugue algorithm)
  - RichText and PlainText

- **@syncforge/schema**
  - Declarative schema DSL (`t.lww`, `t.set`, `t.list`, etc.)
  - TypeScript type inference from schemas
  - Runtime validation
  - Schema registry

- **@syncforge/sync**
  - Sync protocol with delta sync
  - WebSocket plugin
  - IndexedDB plugin
  - Plugin architecture

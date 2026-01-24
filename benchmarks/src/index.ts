/**
 * SyncForge Benchmark Suite
 *
 * Compares SyncForge vs Yjs vs Automerge
 * Run with: node --expose-gc --loader ts-node/esm src/index.ts
 */

import { measure, formatResultsTable, formatMergeTable, BenchmarkResult, forceGC } from './measure.js';

// Import libraries
import * as Y from 'yjs';
import * as Automerge from '@automerge/automerge';

// Import SyncForge (from parent workspace)
import { createDocument, merge } from '../../packages/core/dist/index.js';

const OPERATIONS = 10_000;

// ============================================================================
// B1: Sequential Edits (append characters)
// ============================================================================

async function b1SyncForge(): Promise<BenchmarkResult> {
  return measure('B1: Sequential Edits', 'SyncForge', OPERATIONS, () => {
    const doc = createDocument({ id: 'bench', replicaId: 'r1' });

    for (let i = 0; i < OPERATIONS; i++) {
      doc.listPush('text', String.fromCharCode(97 + (i % 26)));
    }

    const text = doc.get<string[]>('text');
    return { documentSize: JSON.stringify(doc.getOperations()).length };
  });
}

async function b1Yjs(): Promise<BenchmarkResult> {
  return measure('B1: Sequential Edits', 'Yjs', OPERATIONS, () => {
    const doc = new Y.Doc();
    const text = doc.getText('text');

    for (let i = 0; i < OPERATIONS; i++) {
      text.insert(i, String.fromCharCode(97 + (i % 26)));
    }

    const encoded = Y.encodeStateAsUpdate(doc);
    return { documentSize: encoded.byteLength };
  });
}

async function b1Automerge(): Promise<BenchmarkResult> {
  return measure('B1: Sequential Edits', 'Automerge', OPERATIONS, () => {
    let doc = Automerge.from({ text: '' });

    for (let i = 0; i < OPERATIONS; i++) {
      doc = Automerge.change(doc, (d: any) => {
        d.text = d.text + String.fromCharCode(97 + (i % 26));
      });
    }

    const encoded = Automerge.save(doc);
    return { documentSize: encoded.byteLength };
  });
}

// ============================================================================
// B2: Two-Client Merge
// ============================================================================

async function b2SyncForge(): Promise<BenchmarkResult> {
  // Setup: create two documents with initial data
  const doc1 = createDocument({ id: 'bench', replicaId: 'r1' });
  const doc2 = createDocument({ id: 'bench', replicaId: 'r2' });

  // Both start with same base
  for (let i = 0; i < 100; i++) {
    doc1.listPush('text', 'x');
  }
  // Sync initial state
  doc2.applyOperations(doc1.getOperations().slice());

  forceGC();

  return measure('B2: Two-Client Merge', 'SyncForge', 1000, () => {
    // Each client makes 500 edits
    for (let i = 0; i < 500; i++) {
      doc1.listPush('text', 'a');
      doc2.listPush('text', 'b');
    }

    // Merge
    const { document: merged } = merge(doc1, doc2);

    return { documentSize: JSON.stringify(merged.getOperations()).length };
  });
}

async function b2Yjs(): Promise<BenchmarkResult> {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();

  const text1 = doc1.getText('text');
  const text2 = doc2.getText('text');

  // Setup initial state
  for (let i = 0; i < 100; i++) {
    text1.insert(i, 'x');
  }
  // Sync
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

  forceGC();

  return measure('B2: Two-Client Merge', 'Yjs', 1000, () => {
    // Each client makes 500 edits
    for (let i = 0; i < 500; i++) {
      text1.insert(text1.length, 'a');
      text2.insert(text2.length, 'b');
    }

    // Merge (apply updates both ways)
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    return { documentSize: Y.encodeStateAsUpdate(doc1).byteLength };
  });
}

async function b2Automerge(): Promise<BenchmarkResult> {
  let doc1 = Automerge.from({ text: 'x'.repeat(100) });
  let doc2 = Automerge.clone(doc1);

  forceGC();

  return measure('B2: Two-Client Merge', 'Automerge', 1000, () => {
    // Each client makes 500 edits
    for (let i = 0; i < 500; i++) {
      doc1 = Automerge.change(doc1, (d: any) => {
        d.text = d.text + 'a';
      });
      doc2 = Automerge.change(doc2, (d: any) => {
        d.text = d.text + 'b';
      });
    }

    // Merge
    const merged = Automerge.merge(doc1, doc2);

    return { documentSize: Automerge.save(merged).byteLength };
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('# SyncForge Benchmark Results\n');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Node: ${process.version}`);
  console.log(`Operations: ${OPERATIONS.toLocaleString()}\n`);
  console.log('---\n');

  // B1: Sequential Edits
  console.log('Running B1: Sequential Edits...\n');
  const b1Results: BenchmarkResult[] = [];

  try {
    b1Results.push(await b1SyncForge());
    console.log('  SyncForge: done');
  } catch (e) {
    console.log('  SyncForge: FAILED -', (e as Error).message);
  }

  try {
    b1Results.push(await b1Yjs());
    console.log('  Yjs: done');
  } catch (e) {
    console.log('  Yjs: FAILED -', (e as Error).message);
  }

  try {
    b1Results.push(await b1Automerge());
    console.log('  Automerge: done');
  } catch (e) {
    console.log('  Automerge: FAILED -', (e as Error).message);
  }

  console.log('\n' + formatResultsTable(b1Results, 'B1: Sequential Edits (10,000 characters)'));

  // B2: Two-Client Merge
  console.log('Running B2: Two-Client Merge...\n');
  const b2Results: BenchmarkResult[] = [];

  try {
    b2Results.push(await b2SyncForge());
    console.log('  SyncForge: done');
  } catch (e) {
    console.log('  SyncForge: FAILED -', (e as Error).message);
  }

  try {
    b2Results.push(await b2Yjs());
    console.log('  Yjs: done');
  } catch (e) {
    console.log('  Yjs: FAILED -', (e as Error).message);
  }

  try {
    b2Results.push(await b2Automerge());
    console.log('  Automerge: done');
  } catch (e) {
    console.log('  Automerge: FAILED -', (e as Error).message);
  }

  console.log('\n' + formatMergeTable(b2Results, 'B2: Two-Client Merge (500 edits each)'));

  // Summary
  console.log('---\n');
  console.log('## Summary\n');

  if (b1Results.length >= 2) {
    const syncforgeB1 = b1Results.find(r => r.library === 'SyncForge');
    const yjsB1 = b1Results.find(r => r.library === 'Yjs');

    if (syncforgeB1 && yjsB1) {
      const ratio = (syncforgeB1.timeMs / yjsB1.timeMs).toFixed(2);
      console.log(`- B1: SyncForge is ${ratio}x ${Number(ratio) > 1 ? 'slower' : 'faster'} than Yjs`);
    }
  }

  if (b2Results.length >= 2) {
    const syncforgeB2 = b2Results.find(r => r.library === 'SyncForge');
    const yjsB2 = b2Results.find(r => r.library === 'Yjs');

    if (syncforgeB2 && yjsB2) {
      const ratio = (syncforgeB2.timeMs / yjsB2.timeMs).toFixed(2);
      console.log(`- B2: SyncForge is ${ratio}x ${Number(ratio) > 1 ? 'slower' : 'faster'} than Yjs`);
    }
  }
}

main().catch(console.error);

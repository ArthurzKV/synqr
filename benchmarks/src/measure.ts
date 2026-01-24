/**
 * Benchmark measurement utilities
 */

declare const global: {
  gc?: () => void;
};

export interface BenchmarkResult {
  name: string;
  library: string;
  timeMs: number;
  opsPerSec: number;
  memoryMB: number;
  operations: number;
  documentSize?: number;
}

/**
 * Force garbage collection if available
 */
export function forceGC(): void {
  if (global.gc) {
    global.gc();
  }
}

/**
 * Get current memory usage in MB
 */
export function getMemoryMB(): number {
  forceGC();
  const usage = process.memoryUsage();
  return Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100;
}

/**
 * Measure a benchmark function
 */
export async function measure(
  name: string,
  library: string,
  operations: number,
  fn: () => Promise<{ documentSize?: number }> | { documentSize?: number }
): Promise<BenchmarkResult> {
  forceGC();
  const memBefore = getMemoryMB();

  const start = performance.now();
  const result = await fn();
  const end = performance.now();

  const timeMs = Math.round((end - start) * 100) / 100;
  const memAfter = getMemoryMB();

  return {
    name,
    library,
    timeMs,
    opsPerSec: Math.round(operations / (timeMs / 1000)),
    memoryMB: Math.round((memAfter - memBefore) * 100) / 100,
    operations,
    documentSize: result.documentSize,
  };
}

/**
 * Format results as markdown table
 */
export function formatResultsTable(results: BenchmarkResult[], title: string): string {
  const lines: string[] = [];

  lines.push(`### ${title}`);
  lines.push('');
  lines.push('| Library | Time (ms) | Ops/sec | Memory (MB) |');
  lines.push('|---------|-----------|---------|-------------|');

  for (const r of results) {
    lines.push(`| ${r.library} | ${r.timeMs} | ${r.opsPerSec.toLocaleString()} | ${r.memoryMB} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format merge results as markdown table
 */
export function formatMergeTable(results: BenchmarkResult[], title: string): string {
  const lines: string[] = [];

  lines.push(`### ${title}`);
  lines.push('');
  lines.push('| Library | Merge Time (ms) | Doc Size (bytes) | Memory (MB) |');
  lines.push('|---------|-----------------|------------------|-------------|');

  for (const r of results) {
    const docSize = r.documentSize ? r.documentSize.toLocaleString() : 'N/A';
    lines.push(`| ${r.library} | ${r.timeMs} | ${docSize} | ${r.memoryMB} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Text Types
 *
 * RichText - CRDT rich text using Peritext-inspired approach
 */

import type {
  HybridTimestamp,
  ReplicaId,
  Path,
  TextInsertOp,
  TextDeleteOp,
  TextFormatOp,
  TextFormat,
} from 'synqr-core';
import { HybridVectorClock, TimestampOrder } from 'synqr-core';

/**
 * A span of text with consistent formatting
 */
export interface TextSpan {
  /** The text content */
  text: string;
  /** Format applied to this span */
  format: TextFormat;
}

/**
 * Internal segment for text storage
 */
interface TextSegment {
  /** Unique segment ID */
  id: string;
  /** Text content */
  content: string;
  /** Deleted characters bitmap */
  deleted: boolean[];
  /** When this segment was created */
  timestamp: HybridTimestamp;
  /** Which replica created this segment */
  origin: ReplicaId;
  /** Segment to the left */
  left: string | null;
  /** Segment to the right */
  right: string | null;
}

/**
 * Format mark (Peritext-style)
 */
interface FormatMark {
  /** Unique ID for this mark */
  id: string;
  /** Start segment */
  startSegment: string;
  /** Start offset within segment */
  startOffset: number;
  /** Is the start boundary inclusive? */
  startInclusive: boolean;
  /** End segment */
  endSegment: string;
  /** End offset within segment */
  endOffset: number;
  /** Is the end boundary inclusive? */
  endInclusive: boolean;
  /** The format to apply */
  format: TextFormat;
  /** When this mark was created */
  timestamp: HybridTimestamp;
  /** Whether this mark has been removed */
  removed: boolean;
}

/**
 * RichText: CRDT rich text with inline formatting
 *
 * Uses Peritext-inspired approach for handling concurrent formatting.
 * Formatting is stored as "marks" with explicit boundaries.
 */
export class RichText {
  /** All segments by ID */
  private segments: Map<string, TextSegment> = new Map();
  /** First segment ID */
  private head: string | null = null;
  /** All format marks */
  private marks: Map<string, FormatMark> = new Map();
  /** Sequence counter */
  private seq: number = 0;
  private readonly path: Path;

  constructor(path: Path = []) {
    this.path = path;
  }

  /**
   * Get the plain text content
   */
  toString(): string {
    let result = '';
    for (const segment of this.getOrderedSegments()) {
      for (let i = 0; i < segment.content.length; i++) {
        if (!segment.deleted[i]) {
          result += segment.content[i];
        }
      }
    }
    return result;
  }

  /**
   * Get the text length
   */
  get length(): number {
    return this.toString().length;
  }

  /**
   * Check if empty
   */
  get isEmpty(): boolean {
    return this.length === 0;
  }

  /**
   * Get formatted spans
   */
  toSpans(): TextSpan[] {
    const text = this.toString();
    if (text.length === 0) return [];

    // Get format at each position
    const formats = this.getFormatsAtPositions();

    // Group consecutive positions with same format
    const spans: TextSpan[] = [];
    let currentSpan: TextSpan | null = null;

    for (let i = 0; i < text.length; i++) {
      const format = formats[i] ?? {};
      const formatKey = JSON.stringify(format);

      if (!currentSpan || JSON.stringify(currentSpan.format) !== formatKey) {
        if (currentSpan) {
          spans.push(currentSpan);
        }
        currentSpan = { text: text[i]!, format };
      } else {
        currentSpan.text += text[i];
      }
    }

    if (currentSpan) {
      spans.push(currentSpan);
    }

    return spans;
  }

  /**
   * Insert text at a position
   */
  insert(
    position: number,
    text: string,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): string {
    const segmentId = this.generateSegmentId(origin);

    // Find where to insert
    const { segment: afterSegment, offset } = this.positionToSegment(position);

    const segment: TextSegment = {
      id: segmentId,
      content: text,
      deleted: new Array(text.length).fill(false),
      timestamp,
      origin,
      left: afterSegment,
      right: afterSegment ? this.segments.get(afterSegment)?.right ?? null : this.head,
    };

    this.segments.set(segmentId, segment);

    // Update links
    if (afterSegment) {
      const afterNode = this.segments.get(afterSegment);
      if (afterNode) {
        if (afterNode.right) {
          const rightNode = this.segments.get(afterNode.right);
          if (rightNode) {
            rightNode.left = segmentId;
          }
        }
        afterNode.right = segmentId;
      }
    } else {
      // Insert at beginning
      if (this.head) {
        const headNode = this.segments.get(this.head);
        if (headNode) {
          headNode.left = segmentId;
        }
      }
      segment.right = this.head;
      this.head = segmentId;
    }

    return segmentId;
  }

  /**
   * Delete text in a range
   */
  delete(start: number, length: number): void {
    const text = this.toString();
    if (start >= text.length || length <= 0) return;

    const end = Math.min(start + length, text.length);
    let pos = 0;

    for (const segment of this.getOrderedSegments()) {
      for (let i = 0; i < segment.content.length; i++) {
        if (!segment.deleted[i]) {
          if (pos >= start && pos < end) {
            segment.deleted[i] = true;
          }
          pos++;
        }
      }
      if (pos >= end) break;
    }
  }

  /**
   * Apply formatting to a range
   */
  format(
    start: number,
    end: number,
    format: TextFormat,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): string {
    const markId = `${origin}-mark-${this.seq++}`;

    // Convert positions to segment references
    const startRef = this.positionToSegment(start);
    const endRef = this.positionToSegment(end);

    const mark: FormatMark = {
      id: markId,
      startSegment: startRef.segment ?? '',
      startOffset: startRef.offset,
      startInclusive: true,
      endSegment: endRef.segment ?? '',
      endOffset: endRef.offset,
      endInclusive: false,
      format,
      timestamp,
      removed: false,
    };

    this.marks.set(markId, mark);
    return markId;
  }

  /**
   * Remove formatting from a range
   */
  unformat(
    start: number,
    end: number,
    formatKey: keyof TextFormat,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): string {
    return this.format(start, end, { [formatKey]: null }, timestamp, origin);
  }

  /**
   * Apply a text insert operation
   */
  applyInsert(op: TextInsertOp): void {
    const segment: TextSegment = {
      id: op.segmentId,
      content: op.text,
      deleted: new Array(op.text.length).fill(false),
      timestamp: op.timestamp,
      origin: op.origin,
      left: op.after,
      right: null,
    };

    this.segments.set(op.segmentId, segment);

    if (op.after) {
      const afterNode = this.segments.get(op.after);
      if (afterNode) {
        segment.right = afterNode.right;
        if (afterNode.right) {
          const rightNode = this.segments.get(afterNode.right);
          if (rightNode) {
            rightNode.left = op.segmentId;
          }
        }
        afterNode.right = op.segmentId;
      }
    } else {
      segment.right = this.head;
      if (this.head) {
        const headNode = this.segments.get(this.head);
        if (headNode) {
          headNode.left = op.segmentId;
        }
      }
      this.head = op.segmentId;
    }
  }

  /**
   * Apply a text delete operation
   */
  applyDelete(op: TextDeleteOp): void {
    const segment = this.segments.get(op.segmentId);
    if (!segment) return;

    for (let i = op.start; i < op.start + op.length && i < segment.deleted.length; i++) {
      segment.deleted[i] = true;
    }
  }

  /**
   * Apply a format operation
   */
  applyFormat(op: TextFormatOp): void {
    const markId = `${op.origin}-mark-${Date.now()}`;

    const mark: FormatMark = {
      id: markId,
      startSegment: op.startSegment,
      startOffset: op.startOffset,
      startInclusive: true,
      endSegment: op.endSegment,
      endOffset: op.endOffset,
      endInclusive: false,
      format: op.format,
      timestamp: op.timestamp,
      removed: false,
    };

    this.marks.set(markId, mark);
  }

  /**
   * Merge with another RichText
   */
  merge(other: RichText): void {
    // Merge segments
    for (const [id, segment] of other.segments) {
      if (!this.segments.has(id)) {
        this.segments.set(id, { ...segment, deleted: [...segment.deleted] });
      } else {
        // Merge deleted state
        const existing = this.segments.get(id)!;
        for (let i = 0; i < segment.deleted.length; i++) {
          if (segment.deleted[i]) {
            existing.deleted[i] = true;
          }
        }
      }
    }

    // Merge marks
    for (const [id, mark] of other.marks) {
      if (!this.marks.has(id)) {
        this.marks.set(id, { ...mark });
      } else if (mark.removed) {
        this.marks.get(id)!.removed = true;
      }
    }

    // Rebuild links
    this.rebuildLinks();
  }

  /**
   * Get format at a specific position
   */
  getFormatAt(position: number): TextFormat {
    const formats = this.getFormatsAtPositions();
    return formats[position] ?? {};
  }

  /**
   * Convert to JSON
   */
  toJSON(): { text: string; spans: TextSpan[] } {
    return {
      text: this.toString(),
      spans: this.toSpans(),
    };
  }

  /**
   * Get state for serialization
   */
  getState(): {
    segments: Array<[string, TextSegment]>;
    marks: Array<[string, FormatMark]>;
    head: string | null;
    seq: number;
  } {
    return {
      segments: Array.from(this.segments.entries()),
      marks: Array.from(this.marks.entries()),
      head: this.head,
      seq: this.seq,
    };
  }

  /**
   * Restore from state
   */
  setState(state: {
    segments: Array<[string, TextSegment]>;
    marks: Array<[string, FormatMark]>;
    head: string | null;
    seq: number;
  }): void {
    this.segments = new Map(state.segments);
    this.marks = new Map(state.marks);
    this.head = state.head;
    this.seq = state.seq;
  }

  // ============================================
  // Private methods
  // ============================================

  private generateSegmentId(origin: ReplicaId): string {
    return `${origin}-seg-${this.seq++}`;
  }

  private getOrderedSegments(): TextSegment[] {
    const result: TextSegment[] = [];
    let current = this.head;

    while (current) {
      const segment = this.segments.get(current);
      if (segment) {
        result.push(segment);
        current = segment.right;
      } else {
        break;
      }
    }

    return result;
  }

  private positionToSegment(position: number): { segment: string | null; offset: number } {
    let pos = 0;

    for (const segment of this.getOrderedSegments()) {
      for (let i = 0; i < segment.content.length; i++) {
        if (!segment.deleted[i]) {
          if (pos === position) {
            return { segment: segment.id, offset: i };
          }
          pos++;
        }
      }
    }

    // Position at end
    const segments = this.getOrderedSegments();
    if (segments.length > 0) {
      const last = segments[segments.length - 1]!;
      return { segment: last.id, offset: last.content.length };
    }

    return { segment: null, offset: 0 };
  }

  private getFormatsAtPositions(): TextFormat[] {
    const text = this.toString();
    const formats: TextFormat[] = new Array(text.length).fill(null).map(() => ({}));

    // Apply each active mark
    for (const mark of this.marks.values()) {
      if (mark.removed) continue;

      const startPos = this.segmentToPosition(mark.startSegment, mark.startOffset);
      const endPos = this.segmentToPosition(mark.endSegment, mark.endOffset);

      if (startPos === -1 || endPos === -1) continue;

      const actualStart = mark.startInclusive ? startPos : startPos + 1;
      const actualEnd = mark.endInclusive ? endPos + 1 : endPos;

      for (let i = actualStart; i < actualEnd && i < formats.length; i++) {
        Object.assign(formats[i]!, mark.format);
      }
    }

    return formats;
  }

  private segmentToPosition(segmentId: string, offset: number): number {
    let pos = 0;

    for (const segment of this.getOrderedSegments()) {
      if (segment.id === segmentId) {
        let localOffset = 0;
        for (let i = 0; i < segment.content.length; i++) {
          if (!segment.deleted[i]) {
            if (localOffset === offset) {
              return pos;
            }
            localOffset++;
            pos++;
          }
        }
        return pos;
      }

      for (let i = 0; i < segment.content.length; i++) {
        if (!segment.deleted[i]) {
          pos++;
        }
      }
    }

    return -1;
  }

  private rebuildLinks(): void {
    // Sort segments by timestamp
    const sorted = Array.from(this.segments.values()).sort((a, b) => {
      if (a.timestamp.hlc.physical !== b.timestamp.hlc.physical) {
        return a.timestamp.hlc.physical - b.timestamp.hlc.physical;
      }
      if (a.timestamp.hlc.logical !== b.timestamp.hlc.logical) {
        return a.timestamp.hlc.logical - b.timestamp.hlc.logical;
      }
      return a.timestamp.hlc.replica.localeCompare(b.timestamp.hlc.replica);
    });

    // Rebuild links based on explicit left/right references and timestamp order
    if (sorted.length === 0) {
      this.head = null;
      return;
    }

    // Find the actual head (segment with no valid left reference)
    let head: TextSegment | null = null;
    for (const segment of sorted) {
      if (!segment.left || !this.segments.has(segment.left)) {
        if (!head || this.compareSegments(segment, head) < 0) {
          head = segment;
        }
      }
    }

    this.head = head?.id ?? sorted[0]?.id ?? null;
  }

  private compareSegments(a: TextSegment, b: TextSegment): number {
    if (a.timestamp.hlc.physical !== b.timestamp.hlc.physical) {
      return a.timestamp.hlc.physical - b.timestamp.hlc.physical;
    }
    if (a.timestamp.hlc.logical !== b.timestamp.hlc.logical) {
      return a.timestamp.hlc.logical - b.timestamp.hlc.logical;
    }
    return a.timestamp.hlc.replica.localeCompare(b.timestamp.hlc.replica);
  }
}

/**
 * PlainText: Simple CRDT text without formatting
 */
export class PlainText {
  private readonly richText: RichText;

  constructor(path: Path = []) {
    this.richText = new RichText(path);
  }

  /**
   * Get the text content
   */
  toString(): string {
    return this.richText.toString();
  }

  /**
   * Get length
   */
  get length(): number {
    return this.richText.length;
  }

  /**
   * Insert text
   */
  insert(
    position: number,
    text: string,
    timestamp: HybridTimestamp,
    origin: ReplicaId
  ): string {
    return this.richText.insert(position, text, timestamp, origin);
  }

  /**
   * Delete text
   */
  delete(start: number, length: number): void {
    this.richText.delete(start, length);
  }

  /**
   * Merge with another PlainText
   */
  merge(other: PlainText): void {
    this.richText.merge(other.richText);
  }

  /**
   * Apply insert operation
   */
  applyInsert(op: TextInsertOp): void {
    this.richText.applyInsert(op);
  }

  /**
   * Apply delete operation
   */
  applyDelete(op: TextDeleteOp): void {
    this.richText.applyDelete(op);
  }

  /**
   * Convert to JSON
   */
  toJSON(): string {
    return this.toString();
  }
}

/**
 * Factory functions for creating text CRDTs
 */
export const CRDTText = {
  /**
   * Create a rich text CRDT
   */
  rich(path: Path = []): RichText {
    return new RichText(path);
  },

  /**
   * Create a plain text CRDT
   */
  plain(path: Path = []): PlainText {
    return new PlainText(path);
  },
};

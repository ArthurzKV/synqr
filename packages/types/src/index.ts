/**
 * synqr-types
 *
 * CRDT types: Register, Counter, Set, Map, List, Text
 */

// Register types
export {
  LWWRegister,
  MVRegister,
  Register,
  type MVValue,
} from './register.js';

// Counter types
export {
  GCounter,
  PNCounter,
  BoundedCounter,
  Counter,
} from './counter.js';

// Set types
export {
  AWSet,
  ORSet,
  CRDTSet,
  type SetElementMeta,
} from './set.js';

// Map types
export {
  AWMap,
  LWWMap,
  CRDTMap,
  type MapEntryMeta,
} from './map.js';

// List types
export {
  FugueList,
  CRDTList,
  type ElementId,
} from './list.js';

// Text types
export {
  RichText,
  PlainText,
  CRDTText,
  type TextSpan,
} from './text.js';

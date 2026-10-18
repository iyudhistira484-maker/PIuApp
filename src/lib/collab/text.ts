// One common-prefix/suffix diff for external editor updates. A whole-model
// replace is what @monaco-editor/react does for a changed `value`; it moves the
// caret and breaks undo. This diff lets CodeEditor apply only the changed
// middle and map the caret across it.

export interface TextDiff {
  prefix: number;
  /** Length of the replaced range in the old text. */
  removed: number;
  inserted: string;
}

export function textDiff(current: string, next: string): TextDiff | null {
  if (current === next) return null;
  let prefix = 0;
  const max = Math.min(current.length, next.length);
  while (prefix < max && current[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  return {
    prefix,
    removed: current.length - suffix - prefix,
    inserted: next.slice(prefix, next.length - suffix),
  };
}

/** Caret offset after the edit; inside the replaced range lands after it. */
export function mapOffset(diff: TextDiff, offset: number): number {
  const end = diff.prefix + diff.removed;
  // A caret exactly at the edit point follows the new text, so a collaborator's
  // insertion never leaves it stuck in front of what they typed.
  if (offset < diff.prefix) return offset;
  if (offset >= end) return offset + diff.inserted.length - diff.removed;
  return diff.prefix + diff.inserted.length;
}

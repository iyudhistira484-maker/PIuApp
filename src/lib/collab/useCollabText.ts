// Bridges the pure CRDT session to React and to the project's existing private
// Realtime channel. The browser edits locally first; the merged text is written
// back through the normal store path, so autosave, revisions and conflict
// detection keep working exactly as before.

import { useEffect, useRef, useState } from "react";
import { CrdtLimitError } from "./doc";
import {
  CrdtSession,
  EVENT,
  type CollabMessage,
  type CollabStatus,
} from "./protocol";

export interface CollabTransport {
  /** False when the private channel is not joined yet. */
  send(event: string, payload: Record<string, unknown>): boolean;
  subscribe(handler: (payload: unknown) => void): () => void;
}

export interface CollabState {
  status: CollabStatus;
  /** Live tabs on this file, including this one. */
  writers: number;
}

const OFF: CollabState = { status: "off", writers: 1 };

export function useCollabText(options: {
  transport: CollabTransport | null;
  /** File this session owns; switching files starts a fresh session. */
  path: string;
  /** Current saved text from the store, updated on every keystroke. */
  value: string;
  /** Other members whose presence points at this same file. */
  peers: number;
  /** False for Viewer or when no file is open. */
  editable: boolean;
  /** True while the private channel is joined and can send broadcasts. */
  joined: boolean;
  /**
   * Called with the file the merge belongs to, so a message that arrives while
   * switching files can never be written into the newly opened one.
   */
  onMerged: (text: string, path: string) => void;
}): CollabState {
  const { transport, path, value, peers, editable, joined } = options;
  const valueRef = useRef(value);
  valueRef.current = value;
  const mergedRef = useRef(options.onMerged);
  mergedRef.current = options.onMerged;
  const [site] = useState(() => "u" + Math.random().toString(36).slice(2, 10));
  const sessionRef = useRef<CrdtSession | null>(null);
  const [state, setState] = useState<CollabState>(OFF);
  const start = editable && peers > 0;

  const publish = (message: CollabMessage) => {
    if (!transport) return;
    transport.send(EVENT, message as unknown as Record<string, unknown>);
  };
  const publishRef = useRef(publish);
  publishRef.current = publish;

  const sync = () => {
    const session = sessionRef.current;
    if (!session) return;
    const next = { status: session.status, writers: session.writers() };
    setState((prev) =>
      prev.status === next.status && prev.writers === next.writers
        ? prev
        : next,
    );
  };

  // One subscription per channel; it always talks to the current session.
  useEffect(() => {
    if (!transport) return;
    return transport.subscribe((payload) => {
      const session = sessionRef.current;
      if (!session) return;
      const result = session.receive(payload);
      for (const reply of result.reply || []) publishRef.current(reply);
      if (result.text !== undefined)
        mergedRef.current(result.text, session.path);
      sync();
    });
    // sync() only reads refs and setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  // Viewer mode and file switches end the session immediately. A peer leaving
  // does not: keeping the document (and its base) makes a reconnect or a
  // returning tab merge again instead of being reported as a base conflict.
  useEffect(() => {
    sessionRef.current = null;
    setState(OFF);
    return () => {
      sessionRef.current = null;
    };
  }, [path, editable, transport, site]);

  // A session starts only once someone else is present, so a solo tab pays
  // nothing for a document it cannot merge with.
  useEffect(() => {
    if (!start || sessionRef.current) return;
    let session: CrdtSession;
    try {
      session = new CrdtSession(path, valueRef.current, site);
    } catch (error) {
      if (error instanceof CrdtLimitError) {
        setState({ status: "limit", writers: 1 });
        return;
      }
      throw error;
    }
    sessionRef.current = session;
    setState({ status: session.status, writers: session.writers() });
    if (joined) publishRef.current(session.hello());
    // `joined` is read at activation time; a reconnect is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, path, site, transport]);

  // Socket drops keep the session, but the hello is lost with the socket.
  // Re-announce after reconnecting or when a peer returns, so both sides
  // exchange everything typed while nobody was listening.
  useEffect(() => {
    const session = sessionRef.current;
    if (!joined || !session) return;
    publishRef.current(session.hello());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, peers]);

  // Local typing: convert to ops, broadcast once. The store echo that follows
  // is a no-op because the document already holds this text.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || session.doc.text() === value) return;
    const { message } = session.applyLocal(value);
    if (message) publishRef.current(message);
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return state;
}

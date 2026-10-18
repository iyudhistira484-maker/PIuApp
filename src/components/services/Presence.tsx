import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { useStore } from "../../lib/store";
import { requestCloudSync } from "../../lib/cloud/sync";
import { EVENT as CRDT_EVENT } from "../../lib/collab/protocol";
import {
  displayName,
  presencePeers,
  presenceSummary,
  presenceWhere,
  type PresenceMeta,
  type PresencePeer,
  type PresenceState,
} from "../../lib/presence";

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

/** Broadcast transport on the same private channel, for the CRDT session. */
export interface ProjectChannel {
  send(event: string, payload: Record<string, unknown>): boolean;
  subscribe(handler: (payload: unknown) => void): () => void;
}

/**
 * Joins the project's private Realtime channel and publishes a small, honest
 * presence payload: display name, open file and cursor. The same channel also
 * carries CRDT messages for the open file; presence alone never merges text.
 */
export function useProjectPresence(
  projectId: string,
  file: string,
  cursor: CursorPosition,
): { peers: PresencePeer[]; state: PresenceState; transport: ProjectChannel } {
  const user = useStore((s) => s.user);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [state, setState] = useState<PresenceState>("off");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinedRef = useRef(false);
  const payloadRef = useRef<Record<string, unknown>>({});
  const listeners = useRef(new Set<(payload: unknown) => void>());
  const transport = useMemo<ProjectChannel>(
    () => ({
      send(event, payload) {
        const channel = channelRef.current;
        if (!channel || !joinedRef.current) return false;
        void channel
          .send({ type: "broadcast", event, payload })
          .catch(() => undefined);
        return true;
      },
      subscribe(handler) {
        listeners.current.add(handler);
        return () => {
          listeners.current.delete(handler);
        };
      },
    }),
    [],
  );
  const name = displayName(user?.name || user?.email || "", "Anda");
  payloadRef.current = {
    name,
    file,
    line: cursor.lineNumber,
    column: cursor.column,
    at: Date.now(),
  };

  useEffect(() => {
    const userId = user?.id;
    if (!supabase || !userId || user?.demo || !projectId) {
      setPeers([]);
      setState("off");
      return;
    }
    let alive = true;
    setState("connecting");
    // A blocked WebSocket must not leave the statusbar saying "connecting"
    // forever; file sync keeps working either way.
    const timeout = setTimeout(() => {
      if (alive)
        setState((current) =>
          current === "connecting" ? "degraded" : current,
        );
    }, 8_000);
    const channel = supabase.channel("piwu:project:" + projectId, {
      config: { private: true, presence: { key: userId } },
    });
    channelRef.current = channel;
    const sync = () => {
      if (!alive) return;
      const raw = channel.presenceState() as unknown as Record<
        string,
        PresenceMeta[]
      >;
      setPeers(presencePeers(raw, userId));
    };
    channel
      .on("presence", { event: "sync" }, sync)
      .on("broadcast", { event: CRDT_EVENT }, (message) => {
        for (const listener of listeners.current) listener(message.payload);
      })
      .subscribe((status) => {
        if (!alive) return;
        if (status === "SUBSCRIBED") {
          joinedRef.current = true;
          setState("live");
          void channel.track(payloadRef.current);
          sync();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          joinedRef.current = false;
          setState("degraded");
        } else if (status === "CLOSED") {
          joinedRef.current = false;
          setState("off");
        }
      });
    // File sync keeps working even when presence is unavailable.
    const changes = supabase
      .channel("piwu:workspace:" + projectId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_workspaces",
          filter: "project_id=eq." + projectId,
        },
        requestCloudSync,
      )
      .subscribe();
    // A tab that sleeps through a final leave event would otherwise linger.
    const refresh = setInterval(sync, 60_000);
    return () => {
      alive = false;
      joinedRef.current = false;
      channelRef.current = null;
      clearTimeout(timeout);
      clearInterval(refresh);
      setPeers([]);
      void supabase!.removeChannel(channel);
      void supabase!.removeChannel(changes);
    };
  }, [projectId, user?.id, user?.demo]);

  // Cursor moves are frequent; publish at most a few times per second.
  useEffect(() => {
    // track() throws before the channel finishes joining; wait for SUBSCRIBED.
    if (state !== "live" || !channelRef.current) return;
    const timer = setTimeout(() => {
      if (state === "live" && channelRef.current)
        void channelRef.current.track(payloadRef.current);
    }, 220);
    return () => clearTimeout(timer);
  }, [file, cursor.lineNumber, cursor.column, name, state]);

  return { peers, state, transport };
}

export default function Presence({
  peers,
  state,
  activeFile,
}: {
  peers: PresencePeer[];
  state: PresenceState;
  activeFile: string;
}) {
  if (state === "off" && peers.length === 0) return null;
  const summary = presenceSummary(peers, state);
  return (
    <div
      className="presence-stack"
      role="group"
      aria-label={summary || "Kolaborator"}
      title="Kehadiran dan posisi kursor dilaporkan sendiri oleh klien, bukan identitas terverifikasi. File yang sama digabung dengan CRDT saat rekan aktif; perubahan tetap disimpan lewat revisi dan deteksi konflik."
    >
      {peers.slice(0, 4).map((peer) => {
        const where = presenceWhere(peer, activeFile);
        return (
          <span
            key={peer.id}
            className="presence-avatar"
            style={{ background: peer.color }}
            aria-label={`${peer.name} · ${where}`}
            title={`${peer.name} · ${where}`}
          >
            {peer.initials}
          </span>
        );
      })}
      {peers.length > 4 && (
        <span className="presence-more" title={`${peers.length - 4} lainnya`}>
          +{peers.length - 4}
        </span>
      )}
      <span className={"presence-status " + state} aria-live="polite">
        {summary}
      </span>
    </div>
  );
}

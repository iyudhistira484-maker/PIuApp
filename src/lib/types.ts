export type Mode = "Builder" | "Plan" | "Ask";
export type Model = "Otomatis" | "Cepat" | "Seimbang" | "Kuat" | (string & {});
export interface OpsChange {
  kind: string;
  target: string;
  id?: string;
  name?: string;
  changes?: string[];
  reason?: string;
  /** scene.build only: which attached photo the model was read from. */
  photo?: number | null;
  /** scene.build only: true when the whole model became one merged mesh. */
  asMesh?: boolean;
  /** scene.build only: triangle budget the server really generated. */
  geometry?: { vertices: number; faces: number } | null;
  /** scene.build only: colours sampled from the photo, biggest group first. */
  colorGroups?: { color: string; faces: number }[];
  /** scene.build only: one row per part the model was built from. */
  parts?: {
    name: string;
    kind: string;
    shape: string;
    vertices?: number;
    faces?: number;
  }[];
}
/** What the server actually did with a structured scene ops batch. */
export interface OpsReport {
  version: number;
  applied: OpsChange[];
  rejected: OpsChange[];
  sceneChanged: boolean;
  note: string;
}
/** One numbered search result the server actually retrieved. */
export interface SourceRef {
  index: number;
  provider: string;
  kind: string;
  title: string;
  url: string;
  snippet?: string;
  /** Query that produced this source, so the panel can explain where it came from. */
  query?: string;
}
export interface ResearchRound {
  query: string;
  kind: string;
  provider: string;
  label: string;
  cached: boolean;
  count: number;
  error: string;
}
/**
 * Model-written synthesis of the pages that were read. It is not a quote: the
 * panel says so, and citations inside it are validated like any other.
 */
export interface ResearchSummary {
  text: string;
  /** Source numbers the synthesis covers, as it declared them. */
  covers: number[];
  cited: number[];
  invalid: number[];
  gaps?: string;
  notice?: string;
  /** How many pages existed when the synthesis was made. */
  pages?: number;
  round?: number;
}
/** What the read-only server tools actually did, in a plain report. */
export interface ToolReport {
  rounds: number;
  calls: { name: string; ok: boolean }[];
  refused: string[];
  notice: string;
}
/** Honest report of the research round: what was searched, what was cited. */
export interface ResearchReport {
  rounds: ResearchRound[];
  sources: SourceRef[];
  read: number;
  notice: string;
  cited: number[];
  uncited: number[];
  invalid: number[];
  citationNotice?: string;
  /** Citations whose source shares no significant word with the sentence. */
  unsupported?: number[];
  /** Citations too short to judge, or whose source has no readable text. */
  insufficient?: number[];
  checked?: number;
  groundingNotice?: string;
  /** Citations backed only by the AI's own synthesis, not by page wording. */
  viaSummary?: number[];
  /** Present when an abstractive cross-page synthesis was built. */
  summary?: ResearchSummary;
}
/**
 * One step of the research loop, streamed while the turn is still running so
 * the wait is explainable instead of a spinner with no story.
 */
export interface ResearchStep {
  phase: "search" | "read" | "open" | "tool" | "summary" | "studio";
  round?: number;
  queries?: string[];
  pages?: number;
  urls?: string[];
  /** Names of the server tools that ran in this step. */
  tools?: string[];
  /** Studio snapshot read before the first model pass (Roblox projects). */
  scripts?: number;
  nodes?: number;
  /** The bridge token expired: the snapshot may no longer match Studio. */
  stale?: boolean;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: Mode;
  files?: string[];
  ops?: OpsReport;
  /** Numbered sources behind the answer, kept so the citations stay checkable. */
  sources?: SourceRef[];
  research?: ResearchReport;
  /** Read-only server tools that ran for this reply (files, ops dry run). */
  tools?: ToolReport;
  /** Non-research notes: an ignored tool request is never silent. */
  notes?: string[];
  summary?: string[];
  /** Model the provider answered with, shown on the reply. */
  model?: string;
  at: number;
}
export interface Version {
  id: string;
  label: string;
  files: Record<string, string>;
  at: number;
}
export interface Plan {
  pages?: string[];
  structure?: string[];
  decisions?: string[];
  goal: string;
  tasks: { text: string; done: boolean; comment: string }[];
  approved: boolean;
}
export interface Project {
  kind?: import("./project-kinds").ProjectKind;
  id: string;
  name: string;
  description: string;
  template: string;
  files: Record<string, string>;
  messages: Message[];
  versions: Version[];
  createdAt: number;
  updatedAt: number;
  plan?: Plan;
  comments: { id: string; selector: string; body: string; resolved: boolean }[];
}
export interface User {
  id: string;
  name: string;
  email: string;
  demo: boolean;
}
export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  tags: string;
}

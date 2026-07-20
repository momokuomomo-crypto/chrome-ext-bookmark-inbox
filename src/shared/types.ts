export type EntryStatus = "pending" | "processed";
export type EntrySource = "toolbar" | "context-page" | "context-link";

export interface InboxEntry {
  id: string;
  url: string;
  title: string;
  source: EntrySource;
  status: EntryStatus;
  createdAt: string;
  lastSavedAt: string;
  processedAt: string | null;
}

export interface InboxState {
  schemaVersion: 1;
  entries: InboxEntry[];
}

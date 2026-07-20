import type { EntryStatus, EntrySource, InboxEntry } from "./types";

export type Request =
  | { type: "SAVE_URL"; url: string; title: string; source: EntrySource }
  | { type: "SET_STATUS"; id: string; status: EntryStatus }
  | { type: "DELETE_ENTRY"; id: string };

export type Response =
  | { type: "SAVE_RESULT"; ok: true; entry: InboxEntry }
  | {
      type: "SAVE_RESULT";
      ok: false;
      code: "UNSUPPORTED_URL" | "CAPACITY_REACHED";
      message: string;
    }
  | { type: "MUTATION_RESULT"; ok: true }
  | { type: "MUTATION_RESULT"; ok: false; error: string };

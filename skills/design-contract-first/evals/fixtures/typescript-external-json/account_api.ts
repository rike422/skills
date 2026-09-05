export interface Account {
  readonly id: string;
  readonly displayName: string;
  readonly active: boolean;
}

// The external API returns JSON shaped like:
// { "account_id": "a-123", "display_name": "Ada", "status": "active" }
export function parseAccountResponse(payload: unknown): Account {
  throw new Error("Not implemented");
}

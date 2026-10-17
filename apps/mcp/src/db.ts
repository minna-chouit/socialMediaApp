export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Runs `fn` in one transaction as the cadence_mcp role with the owner's JWT claims, so the M4
 * RLS policies and grants apply. `reason` is logged to change_log by the database (FR-3).
 */
export type Db = <T>(
  ownerId: string,
  reason: string | null,
  fn: (tx: Tx) => Promise<T>,
) => Promise<T>;

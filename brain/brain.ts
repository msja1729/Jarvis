/** The swappable brain interface (SPEC 4.2). v1 implements only ClaudeCLIBrain. */

export type ModelChoice = 'haiku' | 'sonnet';

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
}

export interface BrainResult {
  reply: string;
  session_id: string | null;
  tokens_used: number;
  is_error: boolean;
  usage?: TokenUsage;
  /** True when the plan's usage limit was hit (criterion 6). */
  limit_reached?: boolean;
  model?: string;
}

export interface AskOptions {
  /** Live progress such as "Reading Gmail…". */
  onProgress?: (label: string) => void;
  signal?: AbortSignal;
  /** Which team member answers: decides the system prompt and which apps' tools are offered. */
  role?: string;
  /** A consulted role must not consult others in turn (one hop only). */
  consult?: boolean;
  /** The reply as it is being written (pieces of text), so speaking can start early. */
  onText?: (delta: string) => void;
}

export interface Brain {
  ask(text: string, session_id: string | null, model: ModelChoice, opts?: AskOptions): Promise<BrainResult>;
}

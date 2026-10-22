/** Provider-independent AI video generation interface. */

export type ProviderCapabilities = {
  /** Can replace faces inside an existing (template) video. */
  videoFaceSwap: boolean;
  maxFaces: number;
  qualities: string[];          // provider quality parameters it accepts
  supportsCancel: boolean;
  reportsProgress: boolean;
  reportsCost: boolean;
  producesRealVideo: boolean;   // false for the dev adapter
};

export type FaceInput = { slotKey: string; providerInput: string; imageUrl: string };

export type SubmitInput = {
  jobId: string;
  templateVideoUrl: string;
  faces: FaceInput[];           // already in deterministic slot order
  quality: string;
  config: Record<string, unknown>;
};

/** Opaque provider-owned state persisted between polls (multi-step providers). */
export type ProviderState = Record<string, unknown> | null;

export type ProviderJobStatus =
  | {
      state: "queued" | "processing";
      progress?: number;
      /** Multi-step providers: the next step was submitted — track this id/state from now on. */
      next?: { providerJobId: string; state: ProviderState; cost?: number; credits?: number };
    }
  | { state: "succeeded"; outputUrl: string; cost?: number }
  | { state: "failed"; errorCode: string; retryable: boolean; cost?: number };

export class ProviderError extends Error {
  /** retryable = safe to retry automatically (e.g. not accepted / not charged). */
  constructor(public code: string, public retryable: boolean, message?: string) {
    super(message ?? code);
  }
}

export interface GenerationProvider {
  readonly key: string;
  capabilities(): ProviderCapabilities;
  /** Returns problem codes; empty = inputs acceptable. */
  validateInputs(input: Omit<SubmitInput, "jobId">): string[];
  /** credits = provider credits charged (e.g. Akool deduction_credit), for the admin cost view. */
  submit(input: SubmitInput): Promise<{ providerJobId: string; cost?: number; credits?: number; state?: ProviderState }>;
  getStatus(providerJobId: string, ctx: { startedAt: Date | null; state: ProviderState }): Promise<ProviderJobStatus>;
  cancel?(providerJobId: string): Promise<void>;
}

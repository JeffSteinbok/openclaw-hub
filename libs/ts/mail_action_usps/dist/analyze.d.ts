/**
 * Main USPS mail analysis pipeline.
 *
 * Flow: folder → parse HTML → vision-analyze images → apply rules → optional memory → notify
 */
export interface ProcessDigestOptions {
    folder: string;
    analysis?: Array<Record<string, unknown>>;
    date?: string;
    dryRun?: boolean;
    visionBackend?: string;
    messageId?: string;
    persistAnalysis?: boolean;
    writeMemory?: boolean;
    sendNotifications?: boolean;
    updateWorkflowState?: boolean;
    workspaceAgent?: string;
    memoryAgent?: string;
    visionAgent?: string;
}
/**
 * Process a single USPS digest.
 */
export declare function processDigest(options: ProcessDigestOptions): Promise<Record<string, unknown>>;

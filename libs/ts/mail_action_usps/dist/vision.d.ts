/**
 * Vision analysis backends for USPS mailpiece scans.
 *
 * Two backends:
 *   - openclaw_agent: copies image to agent workspace, asks openclaw agent to analyze
 *   - provided: analysis is passed directly (for Copilot inline / testing)
 */
export interface AnalysisResult {
    sender: string;
    addressee: string;
    description: string;
    type: string;
    importance: string;
    mail_class: string;
    address_method: string;
}
/**
 * Analyze a single mailpiece scan via openclaw agent vision.
 */
export declare function analyzeViaAgent(imagePath: string, visionAgent: string): AnalysisResult;
/**
 * Ensure an analysis dict has all required fields with defaults.
 */
export declare function validateAnalysis(analysis: Record<string, unknown>): AnalysisResult;

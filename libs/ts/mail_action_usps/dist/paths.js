/**
 * Workspace path helpers for USPS analysis data.
 */
import { homedir } from "node:os";
import { join } from "node:path";
export function getWorkspaceAgent(agent) {
    if (!agent) {
        throw new Error("workspace_agent must be specified explicitly");
    }
    return agent;
}
export function getWorkspaceRoot(agent) {
    return join(homedir(), ".openclaw", "agents", getWorkspaceAgent(agent), "workspace");
}
export function getMemoryDir(agent) {
    return join(getWorkspaceRoot(agent), "memory");
}
export function getLongTermMemoryDir(agent) {
    return join(getWorkspaceRoot(agent), "memory", "mail");
}
export function getUspsDir(agent) {
    return join(getWorkspaceRoot(agent), "usps-mail");
}
export function getAnalysisFile(agent) {
    return join(getMemoryDir(agent), "usps_analysis.json");
}
export function getStateFile(agent) {
    return join(getMemoryDir(agent), "usps_state.json");
}
export function getRulesFile(agent) {
    return join(getUspsDir(agent), "rules.json");
}
export function getConfigFile(agent) {
    return join(getUspsDir(agent), "config.json");
}

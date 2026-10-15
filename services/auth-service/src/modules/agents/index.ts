/**
 * Agents module — NOT MOUNTED.
 *
 * Owns: agents, agent API keys (encrypted + hashed), agent usage logs.
 *
 * These models and helpers were defined in auth-service but nothing here uses them;
 * the agent/API-key endpoints that write the agents and agent_logs tables live in
 * another codebase that shares this database. They are grouped here so that
 * ownership is explicit, pending a decision on where the agents context lives.
 */
export { default as Agent } from './models/Agent';
export { default as AgentLog } from './models/AgentLog';
export { encryptKey, decryptKey, hashKey } from './cryptoUtils';
export { sendApiKeyOtpEmail } from './emails';

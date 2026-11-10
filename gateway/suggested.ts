/**
 * Built-in list of apps the user can add with one click (SPEC 6.2).
 * Each URL was checked to be a live MCP endpoint. "oauth" apps support automatic
 * client registration, so the user only signs in; "key" apps need a token.
 */
export interface SuggestedApp {
  id: string;
  name: string;
  description: string;
  url: string;
  /** none: works without an account (no sign-in, no key). */
  auth: 'oauth' | 'key' | 'none';
  keyHelp?: string;
}

export const SUGGESTED_APPS: SuggestedApp[] = [
  { id: 'notion', name: 'Notion', description: 'Search, read, and edit your Notion pages.', url: 'https://mcp.notion.com/mcp', auth: 'oauth' },
  { id: 'linear', name: 'Linear', description: 'Find, create, and update Linear issues.', url: 'https://mcp.linear.app/mcp', auth: 'oauth' },
  { id: 'atlassian', name: 'Jira & Confluence', description: 'Work with Jira issues and Confluence pages.', url: 'https://mcp.atlassian.com/v1/mcp', auth: 'oauth' },
  { id: 'asana', name: 'Asana', description: 'See and manage your Asana tasks and projects.', url: 'https://mcp.asana.com/v2/mcp', auth: 'oauth' },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Read issues, pull requests, and repositories.',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'key',
    keyHelp: 'Create a personal access token at github.com → Settings → Developer settings → Personal access tokens.',
  },
];

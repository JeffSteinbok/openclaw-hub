# GitHub Plugin

Manage GitHub issue workflows directly from OpenClaw. The plugin is intentionally focused on issue operations: create, inspect, update, comment on, close, reopen, and list issues without switching to the GitHub UI.

## Authentication

Set the `GITHUB_TOKEN` environment variable to a GitHub personal access token (classic or fine-grained) with appropriate scopes:
- For issues: `repo` scope (classic) or `issues:write` (fine-grained)

```bash
export GITHUB_TOKEN=ghp_...
```

## Tools

### Issue Management

#### `github_create_issue`

Create a new issue in a GitHub repository.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | ✅ | Repository owner (user or organisation) |
| `repo` | string | ✅ | Repository name |
| `title` | string | ✅ | Issue title |
| `body` | string | | Issue body (Markdown supported) |
| `labels` | string[] | | Labels to apply (must already exist in the repo) |
| `assignees` | string[] | | GitHub usernames to assign the issue to |
| `milestone` | integer | | Milestone number to associate with the issue |

#### `github_get_issue`

Get a single issue by its number.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | ✅ | Repository owner |
| `repo` | string | ✅ | Repository name |
| `issue_number` | integer | ✅ | Issue number |

#### `github_edit_issue`

Edit an existing issue. At least one field to update must be provided.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | ✅ | Repository owner |
| `repo` | string | ✅ | Repository name |
| `issue_number` | integer | ✅ | Issue number |
| `title` | string | | New issue title |
| `body` | string | | New issue body (Markdown supported) |
| `state` | string | | Issue state: `"open"` or `"closed"` |
| `labels` | string[] | | Labels to apply (replaces existing) |
| `assignees` | string[] | | Assignees (replaces existing) |
| `milestone` | integer | | Milestone number |

#### `github_close_issue`

Close or reopen an issue.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | ✅ | Repository owner |
| `repo` | string | ✅ | Repository name |
| `issue_number` | integer | ✅ | Issue number |
| `reopen` | boolean | | Set to `true` to reopen instead of close |

#### `github_comment_issue`

Add a comment to an issue.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | ✅ | Repository owner |
| `repo` | string | ✅ | Repository name |
| `issue_number` | integer | ✅ | Issue number |
| `body` | string | ✅ | Comment body (Markdown supported) |

#### `github_list_issues`

List issues with optional filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `owner` | string | ✅ | Repository owner |
| `repo` | string | ✅ | Repository name |
| `state` | string | | Filter by state: `"open"`, `"closed"`, or `"all"` (default: `"open"`) |
| `labels` | string | | Comma-separated list of labels to filter by |
| `assignee` | string | | Filter by assignee username |
| `milestone` | string | | Filter by milestone number or `"*"` for any milestone |
| `per_page` | integer | | Results per page (default: 30, max: 100) |
| `page` | integer | | Page number for pagination (default: 1) |

## Example Responses

### Issue Response

```json
{
  "number": 42,
  "title": "Bug: something broke",
  "url": "https://github.com/owner/repo/issues/42",
  "state": "open",
  "created_at": "2026-03-09T16:00:00Z",
  "labels": ["bug"],
  "assignees": ["octocat"]
}
```

### Comment Response

```json
{
  "id": 12345,
  "body": "This is a comment",
  "user": "bot",
  "created_at": "2026-03-13T00:00:00Z",
  "url": "https://github.com/owner/repo/issues/1#issuecomment-12345"
}
```

### List Issues Response

```json
{
  "issues": [
    {
      "number": 42,
      "title": "Bug: something broke",
      "url": "https://github.com/owner/repo/issues/42",
      "state": "open",
      "created_at": "2026-03-09T16:00:00Z",
      "labels": ["bug"],
      "assignees": ["octocat"]
    }
  ],
  "count": 1
}
```

## Configuration

No additional configuration is required in `openclaw.json` beyond adding the plugin to `plugins.load.paths`.

## Requirements

- Python 3.9+
- Standard library only (no extra packages required)

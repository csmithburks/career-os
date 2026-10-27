> **Fork notice.** This is a modified copy of [dmorrill/gmail-mcp-multi](https://github.com/dmorrill/gmail-mcp-multi) (MIT, branch `feature/initial-implementation`). My changes are listed in [`SETUP.md`](SETUP.md):
> - **Least privilege:** read + draft only (`gmail.readonly`, `gmail.compose`); send, delete and label tools removed
> - **Windows sign-in fix**, plus terminal sign-in so OAuth can't time out inside the client
> - **Wrong-account guard:** refuses to save a sign-in if you picked the wrong Google account
> - **New tools:** thread-aware `draft_email` replies and `read_thread`; `read_email` returns readable text
> - Tests in `test/`
>
> Note: some tool tables below come from the upstream README and list tools this fork removed. The tools here are `list_accounts`, `authenticate`, `search_emails`, `read_email`, `read_thread`, `draft_email` and `list_labels`.

# gmail-mcp-multi

A Gmail MCP server with native multi-account support. Manage multiple Gmail accounts from a single server instance.

Unlike other Gmail MCPs that require running separate server instances per account, this one lets you specify which account to use on each tool call—making it easy to manage personal and work inboxes from Claude Code, Cursor, or any MCP client.

## Features

- **Multi-account support** - Single server instance, unlimited Gmail accounts
- **Account aliases** - Use friendly names like "work" or "personal" instead of email addresses
- **Full Gmail API** - Search, read, send, label, and manage emails
- **Batch operations** - Bulk modify or delete emails efficiently
- **Auto token refresh** - Handles OAuth token refresh automatically

## Installation

```bash
npm install -g gmail-mcp-multi
```

Or run directly with npx:
```bash
npx gmail-mcp-multi
```

## Quick Start

### 1. Set up Google Cloud OAuth

You'll need OAuth credentials from Google Cloud Console:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the Gmail API
4. Create OAuth 2.0 credentials (Desktop app type)
5. Download the credentials JSON

### 2. Configure the MCP

Create `~/.gmail-mcp/oauth-keys.json` with your OAuth credentials.

### 3. Add to your MCP client

**Claude Code (`~/.claude/settings.json`):**
```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["gmail-mcp-multi"]
    }
  }
}
```

### 4. Authenticate accounts

Once the MCP is running, use the `authenticate` tool:
```
authenticate({ alias: "work", email: "you@company.com" })
authenticate({ alias: "personal", email: "you@gmail.com" })
```

### 5. Use it!

```
search_emails({ account: "work", query: "in:inbox is:unread" })
search_emails({ account: "personal", query: "from:mom" })
```

## Tools

All tools that interact with Gmail require an `account` parameter (alias or email).

### Account Management
| Tool | Description |
|------|-------------|
| `list_accounts` | List all configured accounts and auth status |
| `authenticate` | Add or re-authenticate an account |

### Email Operations
| Tool | Description |
|------|-------------|
| `search_emails` | Search emails using Gmail query syntax |
| `read_email` | Get full content of an email by ID |
| `send_email` | Send a new email |
| `draft_email` | Create a draft |
| `modify_email` | Add/remove labels, mark read/unread |
| `delete_email` | Trash or permanently delete |
| `batch_modify_emails` | Bulk label operations |
| `batch_delete_emails` | Bulk delete |

### Label Management
| Tool | Description |
|------|-------------|
| `list_labels` | Get all labels for an account |
| `create_label` | Create a new label |
| `delete_label` | Delete a label |

## Configuration

Credentials are stored in `~/.gmail-mcp/`:

```
~/.gmail-mcp/
├── config.json           # Account aliases and settings
├── oauth-keys.json       # Your Google OAuth app credentials
└── accounts/
    ├── work/
    │   └── credentials.json
    └── personal/
        └── credentials.json
```

## Development

```bash
git clone https://github.com/dmorrill/gmail-mcp-multi.git
cd gmail-mcp-multi
npm install
npm run build
npm run dev
```

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT

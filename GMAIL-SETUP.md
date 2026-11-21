# Gmail in Desknote

The existing `inbox-mcp.js` now exposes `read_gmail_inbox` and `search_gmail` alongside the Zalo/Messenger readers. Gmail requests only `gmail.readonly`: it cannot send, delete, label, or mark email read.

## Connect once

1. In your Google Cloud project enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
2. Configure Google Auth Platform's consent screen. For an external app in Testing, add your Google account as a test user.
3. Create an OAuth client with application type **Desktop app**, download its JSON outside this repository.
4. Run `desknote gmail.login "C:/path/to/client_secret.json"` and grant read-only access in the browser. Sign-in times out after three minutes. If your school blocks third-party access, your Workspace administrator must allow it.
5. `desknote gmail.status` reports whether credentials are configured (not a live connectivity test). `desknote gmail.search "Nihongo"` verifies access and finds the library email, including mail older than seven days. Search returns up to 20 messages.

Google client settings and refresh token are encrypted for the current Windows user with DPAPI, saved to `%APPDATA%/Desknote/gmail-account.dpapi`. Tokens never appear in CLI output. Reconnect with `gmail.login` if Google revokes or expires consent. Testing-mode refresh tokens may expire after seven days.

Automatic reviews use the existing schedule and model budget. They read only inbox mail, excluding Promotions and Social before retrieving content, starting with 24 hours and capped at seven days. Explicit `gmail.search` can search older mail. Plain-text bodies are used when present; HTML-only mail uses Google's snippet, and attachments are not downloaded. Email content is untrusted input to the existing planner validation.

shortcut: when a review window contains more than 500 matching emails, coverage stays partial and its cursor does not advance; use explicit search to inspect missed obligations, and add oldest-first pagination before relying on automatic reviews for a high-volume inbox.

For another local MCP client, configure Node to launch `PATH_TO_DESKNOTE/inbox-mcp.js`. It uses the same Windows account credentials. The Desknote AGY chat still receives planner data only; use `desknote gmail.search` for targeted searches. No ChatGPT Gmail plugin is needed.

References: https://developers.google.com/identity/protocols/oauth2/native-app and https://developers.google.com/workspace/gmail/api/auth/scopes

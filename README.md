# Desknote

Transparent Windows desktop planner: tasks, routines, calendar events, countdowns, reminders and a wake-up alarm. Stays behind application windows and remains visible with Win+D.

Based on [Task Nest](https://github.com/GovinduSasanka/task-nest) by Govindu Sasanka. Upstream MIT license preserved in LICENSE.

## Run

Requires Windows, Node.js and Python 3.12 for native desktop attachment.

    npm install
    npm start

Drag the header to move the widget. Alt+Shift+T toggles visibility. The tray menu controls startup, notifications and quitting.

## CLI

    node cli.js help
    node cli.js list --json
    node cli.js add "Prepare report" --list work
    node cli.js routines
    node cli.js events

Dates are deadlines; planned work times are separate. Data is stored locally in %APPDATA%/Desknote with backups on writes. Existing installations retain their previous data directory. DESKNOTE_DATA_DIR overrides the directory. Use the CLI for serialized writes and immediate UI refresh.

Run `npm link` to make the `desknote` command available globally.

## Optional integrations

AGY chat requires a separately installed and authenticated AGY CLI. Inbox reviews use local read-only Zalo/Messenger adapters and optional [Gmail](GMAIL-SETUP.md). Reviews consume AGY quota when generating a plan and can be disabled in the review panel.

Put Zalo settings in inbox-local.json in the app data directory, with zaloAccount (your account ID) and excludedZaloThreads (an array of thread IDs). Exclusions are applied before retrieving content. Messenger reuses the local messenger-mcp listener on port 8765 and its existing token file. Credentials, personal schedules and local configuration are excluded from the repository.

## Development

    npm test
    npm run dist

Tests use isolated data and mocked model/audio integrations. Native desktop checks require an interactive Windows session. Personal alarm audio is not distributed; Windows alarm audio is the fallback.

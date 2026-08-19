# DSH Cursor Subscription

**English** | [简体中文](README_zh.md)

Sign in to your Cursor account and use your Cursor subscription directly from DeepSeek Harness—without an API key and without depending on the Cursor IDE or Cursor CLI. The plugin preserves DSH's existing session, tool, and permission systems: once signed in, you can select Cursor subscription models from the model picker, while agent tool calls are executed through DSH's local toolset.

> ⚠️ This plugin integrates with Cursor's unpublished Agent protocol (`agent.v1.AgentService/Run`). It is a community reverse-engineering project and may stop working when Cursor changes its server-side implementation. This project is not affiliated with or endorsed by Anysphere or Cursor. Please comply with Cursor's terms of service.

## Features

- Use a Cursor subscription directly in DSH through browser-based PKCE sign-in—no API key required.
- Store credentials in DSH's local credential store and refresh access tokens automatically.
- Discover models available to the current account dynamically through Cursor's `GetUsableModels`, with a built-in fallback list if discovery fails.
- Stream conversations with reasoning output and DSH tool calls.
- View sign-in status and token expiration in the settings page.
- View and manually refresh subscription usage, including requests, plan usage percentage, on-demand spend, and billing cycle.
- View and manually refresh the models available to the current account.
- Configure the per-run tool-round limit and HTTP retry count, interval, and status codes from the settings page.

## Installation

### Install with an Agent (Recommended)

Send the agent a link to [AGENTS.md](AGENTS.md). It contains the instructions for installation, updates, removal, and verification.

### Manual Installation with the `dsh` Command

```sh
dsh plugin --profile web add dsh-cursor-subscription
dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

The installed package list should contain exactly one `dsh-cursor-subscription`, and the composed configuration should contain exactly one `cursor-subscription` entry.

### Local Development Installation

Run the following command in the profile directory, such as `%USERPROFILE%\.dsh\profiles\web`:

```sh
pnpm add file:D:/mcp/dsh-cursor-subscription
```

Then add `dsh-cursor-subscription` to the `dsh.profile.bundles` array in `package.json` and restart DSH.

## Sign-in and Usage

1. Open **Settings -> Cursor Subscription** in DSH.
2. Select **Browser Sign-in**. Your browser will open the Cursor sign-in page.
3. Complete sign-in and authorization. The settings page will automatically show that you are signed in.
4. Select a Cursor model from the model picker, such as `composer-2` or `claude-4-sonnet`.

When a tool is required, the agent converts Cursor's tool request into a local DSH tool execution. The result is returned to the model through the conversation history; Cursor's filesystem tools are not used.

The **Runtime settings** card controls the maximum tool rounds in one Cursor run and the HTTP retry policy. Retry count means additional attempts and defaults to `0` (disabled). Cursor's streaming POST protocol cannot prove that a failed attempt was not processed remotely, so enabling retries may repeat model work or usage. Retries occur only before any response output when the initial HTTP status matches the configured list.

## Updating and Removing

```sh
dsh plugin --profile web update dsh-cursor-subscription   # Update
dsh plugin --profile web remove dsh-cursor-subscription   # Remove
```

If DSH is running, restart it manually after installation or an update.

## Troubleshooting

- **DSH still reports that you are signed out after sign-in:** Make sure the browser completed the entire authorization flow and redirected to the completion page. Polling waits for up to approximately 2.5 minutes.
- **The model list is empty:** `GetUsableModels` depends on the account type. If discovery fails, the plugin uses its built-in model list, and you can still enter a model name manually.
- **Requests return 401:** If the access token has expired and the refresh token is no longer valid, sign in again from the settings page.
- **The server protocol changed:** Cursor's Agent protocol is unpublished. If requests fail, check for a plugin update.

## Scope and Support

- Cursor-native features such as image generation and web search are outside this plugin's scope.
- Report problems through the repository's Issues page.

[MIT](LICENSE)

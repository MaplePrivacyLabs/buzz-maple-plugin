# Maple for Buzz

A dependency-free harness plugin for stock Buzz desktop 1.0.0. It runs the
installed `maple-agent acp` **on the computer running Buzz**, exposes Buzz tools
over local HTTP MCP, and keeps one Maple task per Buzz conversation. Run both
applications on an always-on remote desktop if that is where your agent lives.
No Builderlab account, client fork or relay fork is required by the design.

Status: PoC under development. Protocol fixtures pass; live authenticated Buzz
and Maple acceptance is pending. Buzz's public harness API is preview. Record
and test compatible client/plugin versions before upgrading.

## Install

1. Install Buzz desktop and Maple Work on the execution computer. Sign Maple in
   using its own supported flow and confirm `maple-agent` is on Buzz's PATH.
2. Create the working directory you want the agent to use. Default:
   `~/workspaces/buzz`.
3. In Buzz Settings → Plugins → Manage plugins, install the `dist` folder,
   review its process/MCP/file permissions, and enable **Maple**.
4. Create an agent with the Maple harness. Set its directory, optional model ID
   and instructions, then add it to the desired conversation.

The owner and same-owner attested agents can invoke it through the standard
Buzz harness gate. Other people can contribute in a shared thread; the owner
can mention the agent to act on their contributions. The agent sees the thread
context that Buzz supplies. This plugin does not broaden invocation policy.

The model field must match an ID Maple advertises. Blank preserves Maple's
selected default. The plugin checks HTTP MCP capabilities and confirms an
explicit model selection. It passes Buzz instructions in the initial user input
without replacing Maple's system prompt. Visible replies use Buzz's MCP tools;
streamed assistant text is not automatically reposted.

## Sessions and lifecycle

Session IDs, context cursors and configuration are saved in Buzz's native agent
storage. MCP bearer credentials are kept in memory and are reattached through
`session/load` after restart. A failed restore is reported, not silently replaced
with an empty task. **Reset conversation sessions** starts fresh Buzz sessions
without deleting saved Maple tasks; stop active work first.

Follow-ups use Maple's negotiated `_session/steering` extension. If the turn
finished during steering, the explicit `promptRequired` contract gives ownership
of the next prompt to this plugin. Stop/unload sends `session/cancel` before
closing owned processes/tool servers. Closing ACP alone would only detach it
from Maple's shared host, so cancellation is explicit.

The processes have the normal OS user's access. Working directories, personas
and instructions do not themselves isolate filesystem or credentials. Set up
resource access on the execution computer as appropriate for your agents.

## Development

No npm packages are installed or bundled. The Nix input is pinned to the same
reviewed nixpkgs revision used by Maple Agent's component shell.

```sh
nix develop --no-update-lock-file -c node --test
nix develop --no-update-lock-file -c node scripts/build.mjs
```

`dist/manifest.json` and `dist/plugin.js` are committed installation artifacts.
The builder concatenates the two local source modules. Tests use scripted ACP
processes, not provider accounts or real inference. They cover HTTP MCP,
selection, session restoration, steering races, refusals and cleanup.

Public contracts reviewed: [Buzz v1.0.0 plugin API](https://github.com/block/buzz-app/blob/v1.0.0/docs/plugin-architecture.md),
[public harness kit](https://github.com/block/buzz-app/blob/v1.0.0/src/features/agent-harness/kit.ts),
[Maple ACP](https://github.com/MaplePrivacyLabs/Maple/tree/c5f1120a6facf0a6069cb8e592b8d23e27067d4e/apps/maple-agent).

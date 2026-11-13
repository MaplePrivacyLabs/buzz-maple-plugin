# Maple for Buzz

Use [Maple Work](https://maple.ai/work) as an agent in [Buzz](https://github.com/block/buzz-app).
Mention your agent in a conversation; Maple works in your chosen folder and
replies in the Buzz thread.

**Experimental PoC.** Basic replies and follow-up conversations work. The plugin
is still being tested, and Buzz's harness API is preview. It is not yet a stable,
fully stress-tested integration.

## Quick start

1. Install Buzz desktop and Maple Work **on the same computer**, and sign in to
   both. Ensure `maple-agent` is available on the PATH used by Buzz.
2. In Buzz, open **Settings → Plugins → Manage plugins → Add**.
3. Enter this repository URL and leave **Branch or tag** blank:

   ```text
   https://github.com/MaplePrivacyLabs/buzz-maple-plugin
   ```

4. Click **Find**. Buzz discovers the built Maple plugin in `dist`. Review its
   process/MCP/file permissions, choose **Install plugin**, and enable **Maple**.
5. Create an agent and select the **Maple** harness. Choose an existing project
   folder; leave **Model ID** blank to use Maple's default. Add the agent to a
   channel, then select its mention and send a message.

For a first check, ask: **“Please run `pwd` and reply in this thread with your
working directory.”** No build step, Node installation or extra hosting account
is needed to install the committed plugin.

Buzz and Maple can also run together on an always-on remote desktop. The plugin
runs Maple on that computer; other people use their own Buzz clients to chat
with the agent. Installing the plugin on a laptop runs Maple on that laptop.

## Requirements and limits

- Checked with **Buzz desktop 1.0.0 and 1.0.1** and **Maple Work 0.0.23 build 950** on Linux.
  Other versions/platforms have not yet been validated for this plugin.
- Maple must be signed in and its local store unlocked. In Maple Work,
  **Settings → ACP** shows the command for the installed executable. Buzz
  launches `maple-agent acp`; its directory must be on Buzz's PATH. Restart Buzz
  after changing that environment.
- The agent's owner can invoke it. Teammates can contribute in the thread, and
  the owner can mention the agent to act on their input. This uses Buzz's normal
  owner-admission policy.
- Maple has the execution user's normal filesystem and tool access. The plugin
  can start Maple, provide Buzz tools and read files for it. A chosen working
  directory or a separate agent persona does not create an access boundary.
- The 1.0.1 smoke check covered an existing thread after a Buzz restart, a fresh
  thread, shell execution, attachment upload/download, Stop during a bounded
  shell task and a successful follow-up. These checks used the existing plugin
  implementation. Active-turn steering, unplanned crash/reboot recovery and
  cancellation of other tool types still need live stress testing.

If an agent does not respond, first check its channel membership, Maple sign-in,
working directory and whether Buzz can find `maple-agent`. An explicit model ID
must be one Maple advertises; leaving it blank is the simplest starting point.

## Sessions

The plugin keeps one Maple task per Buzz conversation and saves its session ID
and context cursor in Buzz's native agent storage. Temporary HTTP MCP bearer
credentials stay in memory and are reattached when a session is loaded.
Maple sends visible replies through Buzz's tools.

Agent settings include the working directory, optional model and instructions.
**Reset conversation sessions** starts fresh Buzz bindings without deleting
saved Maple tasks. Stop active work before resetting or changing configuration.

Base instructions and core memory are supplied when a session is first primed.
Existing sessions do not automatically gain Buzz's native prompt/memory refresh
behavior. Changing the plugin's configured instructions starts a new session.

## Development

The runtime has no third-party JavaScript dependencies. The committed
`dist/manifest.json` and `dist/plugin.js` are the installation artifacts; the
builder concatenates the two local source modules.

```sh
nix develop --no-update-lock-file -c node --test
nix develop --no-update-lock-file -c node scripts/build.mjs
```

The pinned Nix shell supplies Node 24. Tests use scripted ACP processes rather
than real accounts or model calls. They cover protocol framing, HTTP MCP,
model selection, session loading, steering races, refusals and cleanup.

Public API references: [Buzz plugin API](https://github.com/block/buzz-app/blob/v1.0.0/docs/plugin-architecture.md),
[Buzz harness kit](https://github.com/block/buzz-app/blob/v1.0.0/src/features/agent-harness/kit.ts),
[Maple ACP](https://github.com/MaplePrivacyLabs/Maple/tree/c5f1120a6facf0a6069cb8e592b8d23e27067d4e/apps/maple-agent).

## License

[MIT](LICENSE).

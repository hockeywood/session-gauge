# session-gauge

A band above the Claude Code prompt that shows how full the context window is, your 5-hour and weekly plan usage with reset times, a projected end-of-window figure, and roughly how many replies are left before the session should be compacted or restarted. A Compact button runs /compact when you press it. Type /gauge to hide or show the band.

Context colours: green under 60%, amber from 60% (compact at the next break), red from 80% (start a new session).

Display only. It reads your plan limits from Anthropic's usage service through your own Claude login, and it sends nothing anywhere else.

Ideas borrowed, with thanks, from anantraghunath/claude-code-usage-quota-mod (MIT): live limit reads at session open, the pace-blend forecast, and the Compact button.

## Install

At the prompt of a terminal session:

    /plugin install session-gauge --marketplace hockeywood/session-gauge

From a shell:

    claude plugin install session-gauge --marketplace hockeywood/session-gauge

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with hockeywood/session-gauge, then Add plugin.

## Live panel (cloud sessions in the desktop app)

A cloud session shown in the Claude desktop app draws no band above the prompt. So the gauge also writes its figures every 2 minutes, and after replies at most every 30 seconds, to a live artifact page, the Session Gauge Panel, which can stay open beside the chat. Each session writes its own row, and the panel shows the freshest session first. The panel link in hooks/panel.ts is the author's own private artifact; anyone else installing this plugin should publish their own copy of the panel and change PANEL_URL. Without access to the panel, the feed stops after three failed writes and the band and status line carry on as before.

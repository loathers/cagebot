import { createServer, IncomingMessage, ServerResponse } from "http";
import { CageBot } from "./CageBot";
import { KoLStatus } from "./utils/Typings";

const STATUS_CACHE_MS = 60_000;

type StatusData = {
  bot: { name: string; id: string } | null;
  caged: boolean;
  busy: boolean;
  rollover: boolean;
  cageTask: {
    requester: { name: string; id: string };
    clan: { name: string; id: string };
    startedAt: string;
    secondsInCage: number;
    releaseable: boolean;
  } | null;
  pendingWhispers: number;
  adventures: number | null;
  full: number | null;
  maxFull: number;
  drunk: number | null;
  maxDrunk: number | null;
  level: number | null;
};

export function startStatusServer(cageBot: CageBot) {
  let cachedStatus: KoLStatus | undefined;
  let cachedAt = 0;

  async function getKoLStatus(): Promise<KoLStatus | undefined> {
    const client = cageBot.getClient();

    if (
      Date.now() - cachedAt >= STATUS_CACHE_MS &&
      !client.isRollover() &&
      (await client.loggedIn())
    ) {
      const status = await client.getStatus();

      // getStatus() returns fake defaults when the request fails; only
      // treat responses with real turn data as fresh.
      if (status.turnsPlayed > 0) {
        cachedStatus = status;
        cachedAt = Date.now();
      }
    }

    return cachedStatus;
  }

  async function buildStatus(): Promise<StatusData> {
    const status = await getKoLStatus();
    const me = cageBot.getClient().getMe();
    const task = cageBot.getCageTask();

    return {
      bot: me ? { name: me.name, id: me.id } : null,
      caged: cageBot.isCaged(),
      busy: cageBot.isBusy(),
      rollover: cageBot.getClient().isRollover(),
      cageTask: task
        ? {
            requester: { name: task.requester.name, id: task.requester.id },
            clan: { name: task.clan.name, id: task.clan.id },
            startedAt: new Date(task.started).toISOString(),
            secondsInCage: cageBot.secondsInTask(),
            releaseable: cageBot.releaseable(),
          }
        : null,
      pendingWhispers: cageBot.getPendingWhisperCount(),
      adventures: status?.adventures ?? null,
      full: status?.full ?? null,
      maxFull: 15,
      drunk: status?.drunk ?? null,
      maxDrunk: cageBot.getDietHandler().getMaxDrunk() ?? null,
      level: status?.level ?? null,
    };
  }

  function renderHtml(data: StatusData): string {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const show = (value: number | null) => (value == null ? "?" : `${value}`);

    const rows: [string, string][] = [
      ["Caged", data.caged ? "Yes" : "No"],
      ["Busy", data.busy ? "Yes" : "No"],
      ["Rollover", data.rollover ? "In progress" : "No"],
      ["Pending whispers", `${data.pendingWhispers}`],
      ["Adventures", show(data.adventures)],
      ["Fullness", `${show(data.full)} / ${data.maxFull}`],
      ["Drunkenness", `${show(data.drunk)} / ${show(data.maxDrunk)}`],
      ["Level", show(data.level)],
    ];

    if (data.cageTask) {
      rows.splice(
        1,
        0,
        ["Clan", esc(data.cageTask.clan.name)],
        ["Requested by", esc(data.cageTask.requester.name)],
        ["Caged since", data.cageTask.startedAt],
        ["Releaseable by anyone", data.cageTask.releaseable ? "Yes" : "Not yet"]
      );
    }

    const title = data.bot ? esc(data.bot.name) : "Cagebot";

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
<h1>${title} (<font color="${data.caged ? "red" : "green"}">${
      data.caged ? "CAGED" : "not caged"
    }</font>)</h1>
<table>
${rows.map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join("\n")}
</table>
<p>An automatic hobopolis cagebaiting bot for Kingdom of Loathing. Whisper "help" to it in game.</p>
</body>
</html>`;
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = (req.url || "/").split("?")[0];

      if (!["/", "/status", "/status.json"].includes(path)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const data = await buildStatus();
      const wantsJson =
        path.endsWith(".json") || (req.headers.accept || "").includes("application/json");

      if (wantsJson) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderHtml(data));
      }
    } catch (error) {
      console.log(`Error serving status page: ${error}`);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  const port = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`Status server listening on ${host}:${port}`);
  });
}

import { CageBot } from "../CageBot";
import { RequestStatus, RequestResponse, RequestStatusDetails } from "./JsonResponses";
import { KoLClient } from "./KoLClient";
import { CageTask, Diet, ChatMessage, SavedSettings, ClanWhiteboard } from "./Typings";
import { readFileSync, writeFileSync } from "fs";
import { decode, encode } from "html-entities";

const savedFileName: string = "./data/runtime_state.json";

export function humanReadableTime(seconds: number): string {
  return `${Math.floor(seconds / 3600)}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Used to split a message to fit into KOL's message limits
 *
 * 260 is the rough limit, but given it injects spaces in 20+ long words. Lower that to 245
 */
export function splitMessage(message: string, limit: number = 245): string[] {
  let encodedRemainder = encode(message);
  let messages: string[] = [];

  if (encodedRemainder.length > limit) {
    let end = limit;
    let toSnip: string;

    // Make sure we don't leave html entities out
    while (
      !message.includes((toSnip = decode(encodedRemainder.substring(0, end)))) ||
      !message.includes(decode(encodedRemainder.substring(end)))
    ) {
      end--;
    }

    encodedRemainder = encodedRemainder.substring(end);
    messages.push(toSnip);
  }

  messages.push(decode(encodedRemainder));

  return messages;
}

export function toJson(object: any) {
  return JSON.stringify(object).replaceAll(" ", "%20");
}

export function createApiResponse(status: RequestStatus, details: RequestStatusDetails): string {
  const apiStatus: RequestResponse = {
    type: "notify",
    status: status,
    details: details,
  };

  return toJson(apiStatus);
}

export async function sendApiResponse(
  message: ChatMessage,
  status: RequestStatus,
  details: RequestStatusDetails
) {
  message.reply(createApiResponse(status, details));
}

export function saveSettings(turnsPlayed: number, maxDrunk: number, task?: CageTask) {
  writeFileSync(
    savedFileName,
    JSON.stringify({
      validAtTurn: turnsPlayed,
      maxDrunk: maxDrunk,
      cageTask: task,
    } as SavedSettings),
    "utf-8"
  );
}

export function loadSettings(): SavedSettings | undefined {
  const file = readFileSync(savedFileName, "utf-8");

  if (!file) {
    return undefined;
  }

  try {
    const json = JSON.parse(file);

    const settings: SavedSettings = {
      validAtTurn: parseInt(json["validAtTurn"]),
      maxDrunk: parseInt(json["maxDrunk"]),
    };

    if (json["cageTask"]) {
      const task = json["cageTask"];

      settings.cageTask = {
        requester: task["requester"],
        clan: task["clan"],
        started: parseInt(task["started"]),
        apiResponses: task["apiResponses"] === "true",
        autoRelease: task["autoRelease"] === "true",
      };
    }

    return settings;
  } catch {
    console.log("Failed to read saved runtime state");
  }

  return undefined;
}

export async function updateWhiteboard(cagebot: CageBot, setCaged: boolean) {
  if (
    !cagebot.getClient().getUsername() ||
    !cagebot.getSettings().whiteboardMessageCaged ||
    !cagebot.getSettings().whiteboardMessageUncaged
  ) {
    return;
  }

  let whiteboard: ClanWhiteboard = await cagebot.getClient().getClanWhiteboard();

  if (!whiteboard) {
    return;
  }

  if (!whiteboard.editable) {
    return;
  }

  const username = cagebot.getClient().getUsername() || "";
  const userid = cagebot.getClient().getUserID() || "";

  if (!username || !userid) {
    return;
  }

  const occupied = cagebot
    .getSettings()
    .whiteboardMessageCaged?.replaceAll("${name}", username)
    .replaceAll("${id}", userid);
  const unoccupied = cagebot
    .getSettings()
    .whiteboardMessageUncaged?.replaceAll("${name}", username)
    .replaceAll("${id}", userid);

  if (!occupied || !unoccupied) {
    return;
  }

  let text = whiteboard.text;

  if (setCaged) {
    if (!text.includes(unoccupied)) {
      return;
    }

    text = text.replaceAll(unoccupied, occupied);
    console.log("Editing basement whiteboard to reflect that we are being caged.");
  } else {
    if (!text.includes(occupied)) {
      return;
    }

    text = text.replaceAll(occupied, unoccupied);
    console.log("Editing basement whiteboard to reflect that we are not in a cage.");
  }

  await cagebot.getClient().setClanWhiteboard(text);
}

export async function readGratesAndValves(client: KoLClient): Promise<[number, number]> {
  const raidlogsResponse = (await client.visitUrl("clan_raidlogs.php")) as string;
  const regexGrates =
    raidlogsResponse.matchAll(
      /opened (?:a|(?:\d+)) sewer grates? (?:\d+ times )?\((\d+) turns?\)/g
    ) || [];
  const regexValves =
    raidlogsResponse.matchAll(/lowered the water level (?:\d+ times )?\((\d+) turns?\)/g) || [];

  let gratesOpened: number = 0;
  let valvesTwisted: number = 0;

  for (let g of regexGrates) {
    gratesOpened += parseInt(g[1]);
  }

  for (let v of regexValves) {
    valvesTwisted += parseInt(v[1]);
  }

  return [gratesOpened, valvesTwisted];
}

export function getManualDiet(): Diet[] {
  const diet: Diet[] = [];

  diet.push({
    type: "food",
    id: 7215,
    name: "Fleetwood mac 'n' cheese",
    level: 8,
    fullness: 6,
    estAdvs: 30,
  });

  diet.push({
    type: "food",
    id: 2767,
    name: "Crimbo pie",
    level: 7,
    fullness: 3,
    estAdvs: 11,
  });

  diet.push({
    type: "drink",
    id: 7370,
    name: "Psychotic Train wine",
    level: 11,
    fullness: 6,
    estAdvs: 19,
  });

  diet.push({
    type: "drink",
    id: 9948,
    name: "Middle of the Road™ brand whiskey",
    level: 1,
    fullness: 2,
    estAdvs: 4,
  });

  return diet;
}

export function getLilBarrelDiet(): Diet[] {
  const diet: Diet[] = [];
  // Awesome
  diet.push({
    type: "food",
    id: 319,
    name: "Insanely spicy enchanted bean burrito",
    level: 5,
    fullness: 3,
    estAdvs: 11,
  });
  diet.push({
    type: "food",
    id: 316,
    name: "Insanely spicy bean burrito",
    level: 4,
    fullness: 3,
    estAdvs: 10,
  });
  diet.push({
    type: "food",
    id: 1256,
    name: "Insanely spicy jumping bean burrito",
    level: 4,
    fullness: 3,
    estAdvs: 10,
  });

  // Good
  for (let [name, drinkId] of [
    ["Roll in the hay", 679],
    ["Slap and Tickle", 680],
    ["Slip 'n' slide", 681],
    ["A little sump'm sump'm", 682],
    ["Pink pony", 684],
    ["Rockin' wagon", 797],
    ["Fuzzbump", 799],
    ["Calle de miel", 1018],
  ]) {
    diet.push({
      type: "drink",
      id: drinkId as number,
      name: name as string,
      level: 4,
      fullness: 4,
      estAdvs: 11,
    });
  }

  // Good
  diet.push({
    type: "food",
    id: 318,
    name: "Spicy enchanted bean burrito",
    level: 4,
    fullness: 3,
    estAdvs: 9,
  });
  diet.push({
    type: "food",
    id: 315,
    name: "Spicy bean burrito",
    level: 3,
    fullness: 3,
    estAdvs: 8,
  });
  diet.push({
    type: "food",
    id: 1255,
    name: "Spicy jumping bean burrito",
    level: 3,
    fullness: 3,
    estAdvs: 8,
  });

  // Good
  for (let [name, drinkId] of [
    ["Gin and tonic", 1567],
    ["Gibson", 1570],
    ["Vodka and tonic", 1568],
    ["Mimosette", 1564],
    ["Tequila sunset", 1565],
    ["Zmobie", 1566],
  ]) {
    diet.push({
      type: "drink",
      id: drinkId as number,
      name: name as string,
      level: 3,
      fullness: 3,
      estAdvs: 7,
    });
  }

  // Decent
  diet.push({
    type: "food",
    id: 317,
    name: "Enchanted bean burrito",
    level: 2,
    fullness: 3,
    estAdvs: 6,
  });
  diet.push({
    type: "food",
    id: 314,
    name: "Bean burrito",
    level: 1,
    fullness: 3,
    estAdvs: 5,
  });
  diet.push({
    type: "food",
    id: 1254,
    name: "Jumping bean burrito",
    level: 1,
    fullness: 3,
    estAdvs: 5,
  });

  // Decent
  for (let [name, drinkId] of [
    ["Screwdriver", 250],
    ["Tequila sunrise", 1012],
    ["Martini", 251],
    ["Vodka martini", 1009],
    ["Strawberry daiquiri", 788],
    ["Margarita", 1013],
  ]) {
    diet.push({
      type: "drink",
      id: drinkId as number,
      name: name as string,
      level: 1,
      fullness: 3,
      estAdvs: 5,
    });
  }

  return diet;
}

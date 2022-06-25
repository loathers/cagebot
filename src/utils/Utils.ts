import { CageBot } from "../CageBot";
import { RequestStatus, RequestResponse, RequestStatusDetails } from "./JsonResponses";
import { KoLClient } from "./KoLClient";
import { CageTask, Diet, PrivateMessage, SavedSettings } from "./Typings";
import { readFileSync, writeFileSync } from "fs";

const savedFileName: string = "./runtime_state.json";

export function humanReadableTime(seconds: number): string {
  return `${Math.floor(seconds / 3600)}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export async function sendApiResponse(
  message: PrivateMessage,
  status: RequestStatus,
  details: RequestStatusDetails
) {
  const apiStatus: RequestResponse = {
    status: status,
    details: details,
  };

  message.reply(JSON.stringify(apiStatus));
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
        apiResponses: task["apiResponses"] == "true",
      };
    }

    return settings;
  } catch {
    console.log("Failed to read saved runtime state");
  }

  return undefined;
}

export async function updateWhiteboard(cagebot: CageBot, setCaged: boolean) {
  if (!cagebot.getClient().getUsername()) {
    return;
  }

  let whiteboard = await cagebot.getClient().getWriteableClanWhiteboard();

  if (!whiteboard) {
    return;
  }

  const username = cagebot.getClient().getUsername() || "";
  const userid = cagebot.getClient().getUserID() || "";

  if (!username) {
    return;
  }

  const occupied = cagebot
    .getSettings()
    .whiteboardCaged.replaceAll("${name}", username)
    .replaceAll("${id}", userid);
  const unoccupied = cagebot
    .getSettings()
    .whiteboardUncaged.replaceAll("${name}", username)
    .replaceAll("${id}", userid);

  if (setCaged) {
    if (!whiteboard.includes(unoccupied)) {
      return;
    }

    whiteboard = whiteboard.replaceAll(unoccupied, occupied);
  } else {
    if (!whiteboard.includes(occupied)) {
      return;
    }

    whiteboard = whiteboard.replaceAll(occupied, unoccupied);
  }

  await cagebot.getClient().setClanWhiteboard(whiteboard);
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

import { type Client, gameData } from "kol.js";
import type { Item } from "data-of-loathing";
import { CageBot } from "../CageBot.js";
import { RequestStatus, RequestResponse, RequestStatusDetails } from "./JsonResponses.js";
import {
  CageTask,
  ChatMessage,
  SavedSettings,
  KoLSkill,
  BuffySkill,
  KoLUser,
} from "./Typings.js";
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

export async function sendPrivateMessage(
  client: Client,
  recipient: KoLUser,
  message: string
): Promise<void> {
  for (const msg of splitMessage(message)) {
    await client.chat.send(recipient.id, msg);
  }
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

export function saveSettings(
  turnsPlayed: number,
  maxDrunk: number,
  knownSkills: KoLSkill[],
  task?: CageTask
) {
  writeFileSync(
    savedFileName,
    JSON.stringify({
      validAtTurn: turnsPlayed,
      maxDrunk: maxDrunk,
      cageTask: task,
      knownSkills: knownSkills.map((skill) => skill.skillId),
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
      knownSkills: ((json["knownSkills"] ?? []) as string[]).map((s) => parseInt(s)),
    };

    if (json["cageTask"]) {
      const task = json["cageTask"];

      settings.cageTask = {
        requester: { name: task["requester"]["name"], id: parseInt(task["requester"]["id"]) },
        clan: { name: task["clan"]["name"], id: parseInt(task["clan"]["id"]) },
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
    !cagebot.getClient().username ||
    !cagebot.getSettings().whiteboardMessageCaged ||
    !cagebot.getSettings().whiteboardMessageUncaged
  ) {
    return;
  }

  const whiteboard = await cagebot.getClan().readWhiteboard();

  if (!whiteboard.editable) {
    return;
  }

  const username = cagebot.getClient().username;
  const userid = cagebot.getClient().playerId;

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

  await cagebot.getClan().writeWhiteboard(text);
}

// The items the bot is willing to consume. Order is irrelevant — DietHandler
// sorts by yield at runtime. All per-item stats come from game data.
const MANUAL_DIET = [
  7215, // Fleetwood mac 'n' cheese
  2767, // Crimbo pie
  7370, // Psychotic Train wine
  9948, // Middle of the Road™ brand whiskey
];

const LIL_BARREL_DIET = [
  319, 316, 1256, // Insanely spicy [enchanted/plain/jumping] bean burrito
  318, 315, 1255, // Spicy [enchanted/plain/jumping] bean burrito
  317, 314, 1254, // [Enchanted/plain/jumping] bean burrito
  679, 680, 681, 682, 684, 797, 799, 1018, // Roll in the hay, Slap and Tickle, etc.
  1567, 1570, 1568, 1564, 1565, 1566, // Gin and tonic, Gibson, etc.
  250, 1012, 251, 1009, 788, 1013, // Screwdriver, Tequila sunrise, etc.
];

/**
 * Resolve a list of item ids into consumable items with their game data
 * loaded. Per-item stats (fullness, level, adventures) are derived from
 * `item.consumable` where needed, rather than duplicated here.
 */
async function resolveDiet(itemIds: number[]): Promise<Item[]> {
  const items: Item[] = [];

  for (const id of itemIds) {
    const item = await gameData.findItemWithDetailById(id);

    if (!item || !item.consumable) {
      throw new Error(`Diet item ${id} is missing or not consumable`);
    }

    items.push(item);
  }

  return items;
}

export function getManualDiet(): Promise<Item[]> {
  return resolveDiet(MANUAL_DIET);
}

export function getLilBarrelDiet(): Promise<Item[]> {
  return resolveDiet(LIL_BARREL_DIET);
}

export function getMinusCombatSkills(): KoLSkill[] {
  return [
    { name: "Smooth Movement", mpCost: 10, skillId: 5017, effectId: 165 },
    { name: "Musk of the Moose", mpCost: 10, skillId: 1019, effectId: 166 },
    { name: "The Sonata of Sneakiness", mpCost: 20, skillId: 6015, effectId: 162 },
  ];
}

/**
 * Skills we can request from buffy that are useful, ordered by usefulness.
 * We skip ode to booze because it takes far more MP and we'd rather not abuse buffy too much. Perhaps if we clean up our consuming to wait for ode in the future..
 * Though it makes cages slower?
 *
 * TODO: Need to somehow detect when we have too many songs
 */
export function getBuffySkills(): BuffySkill[] {
  return [
    { name: "The Sonata of Sneakiness", mpCost: 20, effectId: 162 },
    { name: "Paul's Passionate Pop Song", mpCost: 20, effectId: 2375 },
  ];
}

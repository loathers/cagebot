/**
 * Manual smoke test for the kol.js-backed client. Uses the credentials from
 * .env and spends no adventures.
 *
 * Run with: npm run build && node dist/smoke.js
 */
import * as dotenv from "dotenv";
import { Client } from "kol.js";
import { Clan } from "kol.js/domains/Clan";
import { HobopolisDungeon } from "kol.js/domains/Hobopolis";
import { getInventory, getKoLStatus, humanReadableTime } from "./utils/Utils.js";

dotenv.config();

if (!process.env.KOL_USER || !process.env.KOL_PASS) {
  console.log("Set KOL_USER and KOL_PASS in .env first.");
  process.exit(1);
}

const client = new Client(process.env.KOL_USER, process.env.KOL_PASS);
const clan = new Clan(client);
const hobopolis = new HobopolisDungeon(client);

if (!(await client.login())) {
  console.log(`Failed to log in${client.isRollover() ? " (rollover in progress)" : ""}.`);
  process.exit(1);
}

console.log(`Logged in as ${client.username} (#${client.playerId})`);

await client.loadGameData();
console.log("Game data loaded");

const status = await getKoLStatus(client);
console.log(
  `Level ${status.level}, ${status.adventures} adventures, ${status.full}/15 full, ${status.drunk} drunk, turns played ${status.turnsPlayed}`
);
console.log(`Equipment: ${JSON.stringify([...status.equipment])}`);
console.log(`Effects: ${status.effects.map((e) => `${e.name} (${e.duration})`).join(", ")}`);
console.log(`Rollover in ${humanReadableTime(await client.secondsToRollover())}`);

const skills = await client.charSheet.getSkills();
console.log(`Knows ${skills.size} skills`);

const inventory = await getInventory(client);
console.log(`Inventory contains ${inventory.size} distinct items`);

const whitelists = await client.getClanWhitelists();
console.log(`Whitelisted in ${whitelists.length} clans`);

const currentClanId = await clan.getCurrentClanId();
console.log(`Currently in clan #${currentClanId}`);

const whiteboard = await clan.readWhiteboard();
console.log(`Whiteboard (editable: ${whiteboard.editable}): ${whiteboard.text.slice(0, 80)}`);

const macros = await client.combatMacros.list();
console.log(`Combat macros: ${macros.map((m) => `${m.name} (#${m.id})`).join(", ")}`);

const autoattack = await client.account.getAutoattackMacro();
console.log(`Autoattack macro: ${autoattack ? `${autoattack.name} (#${autoattack.id})` : "none"}`);

console.log(`Caged: ${await hobopolis.isCaged()}`);
console.log(`Sewers open in current clan: ${await hobopolis.sewersOpen()}`);
console.log(`Sewer progress: ${JSON.stringify(await hobopolis.getSewerProgress())}`);

console.log("Smoke test complete.");
process.exit(0);

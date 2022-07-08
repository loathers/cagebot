import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { CageBot } from "./CageBot";
import { Settings } from "./utils/Typings";

dotenv.config();
console.log("  _____                 _           _   ");
console.log(" / ____|               | |         | |  ");
console.log("| |     __ _  __ _  ___| |__   ___ | |_ ");
console.log("| |    / _` |/ _` |/ _ \\ '_ \\ / _ \\| __|");
console.log("| |___| (_| | (_| |  __/ |_) | (_) | |_ ");
console.log(" \\_____\\__,_|\\__, |\\___|_.__/ \\___/ \\__|");
console.log("              __/ |               ");
console.log("             |___/  ");
console.log("Cagebot is an automatic hobopolis cagebaiting bot for Kingdom of Loathing");
console.log("operated wholly through ingame whispers.");
console.log();
console.log();
console.log("OUT OF GAME SETUP");
console.log("  In order to function, Cagebot requires exclusive access to a character");
console.log("  that is at least level 3 and has passed the trial of literacy. To give");
console.log("  Cagebot access to a character, put its username and password into the");
console.log("  file named '.env' in the root directory of this project (alongside");
console.log("  package.json). This file should be in the form:");
console.log();
console.log("  KOL_USER='Cagebot'");
console.log("  KOL_PASS='Cagebot P4ssw0rD'");
console.log();
console.log();
console.log("INGAME SETUP");
console.log("  To set up your multi, please have it idle with as much +adv rollover gear");
console.log("  on as possible, amd at least 1 hp regen/fight. Whatsian Ionic Pliers in");
console.log("  the offhand are recommended as a cheap and plentiful option for this.");
console.log();
console.log("  You will also require an autoattack with the name CAGEBOT (all caps) that");
console.log('  reads "runaway;repeat". If your account has means of running freely,');
console.log("  feel free to add them too, but I take no responsibility for failures.");
console.log("  If you need to tiebreak equipment, +noncombat rate is nice too.");
console.log();
console.log();
console.log();

if (!process.env.KOL_USER || !process.env.KOL_PASS) {
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("!!!WARNINGWARNINGWARNINGWARNINGWARNING!!!");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("!!! You have not supplied a username  !!!");
  console.log("!!! or a password for Cagebot. Please !!!");
  console.log("!!! Put them in .env as KOL_USER and  !!!");
  console.log("!!! KOL_PASS and rerun.               !!!");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("!!!WARNINGWARNINGWARNINGWARNINGWARNING!!!");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
} else {
  const settings = JSON.parse(readFileSync("./data/Settings.json", "utf-8") || "{}");

  for (let key of Object.keys(settings)) {
    if (!process.env[key]) {
      continue;
    }

    console.log(`Overriding setting '${key}=${process.env[key]}' as defined in .env`);
    (settings as any)[key] = process.env[key];
  }

  settings.maintainAdventures = parseInt(
    process.env["maintainAdventures"] || settings.maintainAdventures || "100"
  );
  settings.openEverything = settings.openEverything === "true" ? true : false;
  settings.openEverythingWhileAdventuresAbove = parseInt(
    settings.openEverythingWhileAdventuresAbove || "80"
  );

  const cageBot = new CageBot(process.env.KOL_USER, process.env.KOL_PASS, settings as Settings);
  cageBot.start();
}

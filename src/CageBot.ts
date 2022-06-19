import { KoLClan, KoLClient, KoLUser, PrivateMessage } from "./KoLClient";
import { Mutex } from "async-mutex";

type CagedStatus = {
  requester: KoLUser;
  clan: string;
  cagedAt: number;
};

type Diet = {
  type: "food" | "drink";
  id: number;
  name: string;
  level: number;
  fullness: number;
};

type JsonStatus = {
  adventures: number; // Adventures remaining
  full: number; // Current fullness used
  fullLimit?: number; // Max fullness, absent if we don't know
  liver: number; // Current liver used
  liverLimit?: number; // Max liver, absent if we don't know
  caged: boolean; // If currently caged
  cagedBy?: string; // Who requested the cage, absent if we don't know
  cagedClan?: string; // Clan we're trapped in, absent if not caged or we don't know
  cagedFor?: number; // Seconds in cage, absent if we don't know or not caged
  releasable?: boolean; // If the requester can release, absent if not caged
};

export type Settings = {
  maintainAdventures: number;
  openEverything: boolean;
  openEverythingWhileAdventuresAbove: number;
};

const mutex = new Mutex();

export class CageBot {
  private _privateMessages: PrivateMessage[] = [];
  private _client: KoLClient;
  private _amCaged: boolean = false;
  private _cageStatus?: CagedStatus;
  private _settings: Settings;
  private _diet: Diet[] = [];
  private _maxDrunk: number = 14;
  private _ownsTuxedo: boolean = false;
  private _usingBarrelMimic: boolean = false;
  private _doneInitialSetup: boolean = false;
  private _lastTestCage: number = Date.now() / 1000;

  constructor(username: string, password: string, settings: Settings) {
    this._client = new KoLClient(username, password);
    this._settings = settings;
  }

  start(): void {
    console.log("Starting Cagebot...");
    console.log("We're trying to maintain " + this._settings.maintainAdventures + " adventures");

    if (this._settings.openEverything) {
      console.log(
        "While adventures are above " +
          this._settings.openEverythingWhileAdventuresAbove +
          ", we're escaping the cage to open grates and twist valves."
      );
    }

    this._client.logIn().then(() =>
      this.initialSetup().then(async () => {
        const secondsToRollover = await this._client.getSecondsToRollover();

        console.log("The next rollover is in " + this.humanReadableTime(secondsToRollover));
        console.log("Initial setup complete. Polling messages.");

        setInterval(async () => {
          // Every 15 minutes, visit main.php to check if we're still caged.
          if (this._lastTestCage + 15 * 60 < Date.now() / 1000) {
            await this.testCaged();
          }

          this._privateMessages.push(...(await this._client.fetchNewWhispers()));
        }, 3000);
        this.processMessage();
      })
    );
  }

  async testCaged(): Promise<void> {
    this._lastTestCage = Date.now() / 1000;
    let page = await this._client.visitUrl("place.php");

    if (/Pop!/.test(page)) {
      page = await this._client.visitUrl("choice.php", {
        whichchoice: 296,
        option: 1,
      });
    }

    this._amCaged = /Despite All Your Rage/.test(page);

    if (!this._amCaged) {
      this._cageStatus = undefined;
    }
  }

  async sendJsonStatus(message: PrivateMessage) {
    const status = {
      full: 0,
      fullLimit: 15,
      liver: 0,
      liverLimit: 15,
      releasable: false,
      caged: false,
      cagedBy: "Me",
      cagedClan: "No idea",
      cagedFor: 500,
      adventures: 43,
    };
  }

  async initialSetup(): Promise<void> {
    await this.testCaged();

    if (!this._amCaged && !this._doneInitialSetup) {
      if (!/CAGEBOT/.test(await this._client.visitUrl("account_combatmacros.php"))) {
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.log("!!!WARNINGWARNINGWARNINGWARNINGWARNING!!!");
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.log("!!! In order to function, this account!!!");
        console.log("!!! MUST have a macro named CAGEBOT   !!!");
        console.log('!!! reading "runaway;repeat;". Please !!!');
        console.log("!!! make that now and rerun.          !!!");
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.log("!!!WARNINGWARNINGWARNINGWARNINGWARNING!!!");
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        throw "Macro required to continue.";
      }

      const combatTab = await this._client.visitUrl("account.php", {
        tab: "combat",
      });
      const macroId = combatTab.match(/value="(\d+)">CAGEBOT/)[1];
      await this._client.visitUrl("account.php", {
        am: 1,
        action: "flag_aabosses",
        value: 1,
        ajax: 1,
      });
      await this._client.visitUrl("account.php", {
        am: 1,
        action: "autoattack",
        value: macroId,
        ajax: 1,
      });

      if (/>Liver of Steel<\/a>/.test(await this._client.visitUrl("charsheet.php"))) {
        this._maxDrunk = 19;
      }

      this._doneInitialSetup = true;
    }

    this._ownsTuxedo =
      (await this._client.getInventory()).has(2489) ||
      (await this._client.getEquipment()).get("shirt") == 2489;

    this._usingBarrelMimic = (await this._client.getFamiliar()) == 198;

    if (this._usingBarrelMimic) {
      this.fillLilBarrelDietData();
    } else {
      this.fillDietData();
    }

    if (!this._amCaged) {
      await this.maintainAdventures();
    }
  }

  fillDietData() {
    this._diet.push({
      type: "food",
      id: 7215,
      name: "Fleetwood mac 'n' cheese",
      level: 8,
      fullness: 6,
    });
    this._diet.push({
      type: "food",
      id: 2767,
      name: "Crimbo pie",
      level: 7,
      fullness: 3,
    });
    this._diet.push({
      type: "drink",
      id: 7370,
      name: "Psychotic Train wine",
      level: 11,
      fullness: 6,
    });
    this._diet.push({
      type: "drink",
      id: 9948,
      name: "Middle of the Road™ brand whiskey",
      level: 1,
      fullness: 2,
    });
  }

  fillLilBarrelDietData() {
    // Awesome
    this._diet.push({
      type: "food",
      id: 319,
      name: "Insanely spicy enchanted bean burrito",
      level: 5,
      fullness: 3,
    });
    this._diet.push({
      type: "food",
      id: 316,
      name: "Insanely spicy bean burrito",
      level: 4,
      fullness: 3,
    });
    this._diet.push({
      type: "food",
      id: 1256,
      name: "Insanely spicy jumping bean burrito",
      level: 4,
      fullness: 3,
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
      this._diet.push({
        type: "drink",
        id: drinkId as number,
        name: name as string,
        level: 4,
        fullness: 4,
      });
    }

    // Good
    this._diet.push({
      type: "food",
      id: 318,
      name: "Spicy enchanted bean burrito",
      level: 4,
      fullness: 3,
    });
    this._diet.push({
      type: "food",
      id: 315,
      name: "Spicy bean burrito",
      level: 3,
      fullness: 3,
    });
    this._diet.push({
      type: "food",
      id: 1255,
      name: "Spicy jumping bean burrito",
      level: 3,
      fullness: 3,
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
      this._diet.push({
        type: "drink",
        id: drinkId as number,
        name: name as string,
        level: 3,
        fullness: 3,
      });
    }

    // Decent
    this._diet.push({
      type: "food",
      id: 317,
      name: "Enchanted bean burrito",
      level: 2,
      fullness: 3,
    });
    this._diet.push({
      type: "food",
      id: 314,
      name: "Bean burrito",
      level: 1,
      fullness: 3,
    });
    this._diet.push({
      type: "food",
      id: 1254,
      name: "Jumping bean burrito",
      level: 1,
      fullness: 3,
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
      this._diet.push({
        type: "drink",
        id: drinkId as number,
        name: name as string,
        level: 1,
        fullness: 3,
      });
    }
  }

  async processMessage(): Promise<void> {
    const message = this._privateMessages.shift();

    if (message) {
      await mutex.runExclusive(async () => {
        console.log(`Processing whisper from ${message.who.name} (#${message.who.id})`);
        const processedMsg = message.msg.toLowerCase();

        if (processedMsg.startsWith("status")) {
          await this.statusReport(message, true);
        } else if (processedMsg.startsWith("cage")) {
          await this.becomeCaged(message);
        } else if (processedMsg.startsWith("escape")) {
          await this.escapeCage(message);
        } else if (processedMsg.startsWith("release")) {
          await this.releaseCage(message);
        } else if (processedMsg.startsWith("help")) {
          await this.helpText(message);
        } else if (processedMsg.startsWith("diet")) {
          await this.sendDietReport(message);
        } else {
          await this.didntUnderstand(message);
        }
      });

      this.processMessage();
    } else {
      setTimeout(() => this.processMessage(), 1000);
    }
  }

  async sendDietReport(message: PrivateMessage) {
    const inventory: Map<number, number> = await this._client.getInventory();
    let food: number = 0;
    let drink: number = 0;

    for (let diet of this._diet) {
      if (!inventory.has(diet.id)) {
        continue;
      }

      if (diet.type == "food") {
        food += inventory.get(diet.id) || 0;
      } else {
        drink += inventory.get(diet.id) || 0;
      }
    }

    await this._client.sendPrivateMessage(
      message.who,
      `We have ${food} sticks of bread, ${drink} barrels of booze`
    );
  }

  async readGratesAndValves(): Promise<[number, number]> {
    const raidlogsResponse = (await this._client.visitUrl("clan_raidlogs.php")) as string;
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

  async becomeCaged(message: PrivateMessage): Promise<void> {
    await this.testCaged();

    // If rollover is less than 7 minutes away
    if ((await this._client.getSecondsToRollover()) < 7 * 60) {
      await this._client.sendPrivateMessage(
        message.who,
        `Rollover is in ${this.humanReadableTime(
          await this._client.getSecondsToRollover()
        )}, I do not wish to get into a bad state. Please try again after rollover.`
      );
      return;
    }

    const clanName = message.msg.slice(5);
    console.log(`${message.who.name} (#${message.who.id}) requested caging in clan "${clanName}"`);

    if (this._amCaged) {
      console.log(`Already caged. Sending status report instead.`);
      await this.statusReport(message);
    } else {
      const whitelists = (await this._client.getWhitelists()).filter((clan: KoLClan) =>
        clan.name.toLowerCase().includes(clanName.toLowerCase())
      );

      if (whitelists.length > 1) {
        console.log(`Clan name "${clanName}" ambiguous, aborting.`);

        this._client.sendPrivateMessage(
          message.who,
          `I'm in multiple clans named ${clanName}: ${whitelists.join(
            ", "
          )}. Please be more specific.`
        );
      } else if (whitelists.length < 1) {
        console.log(`Clan name "${clanName}" does not match any whitelists, aborting.`);

        this._client.sendPrivateMessage(
          message.who,
          `I'm not in any clans named ${clanName}. Check your spelling, or ensure I have a whitelist.`
        );
      } else {
        const targetClan = whitelists[0];

        console.log(
          `Clan name "${clanName}" matched to whitelisted clan "${targetClan.name}". Attempting to whitelist.`
        );

        await this._client.joinClan(targetClan);

        if ((await this._client.myClan()) !== targetClan.id) {
          console.log(`Whitelisting to clan "${targetClan.name}" failed, aborting.`);

          await this._client.sendPrivateMessage(
            message.who,
            `I tried to whitelist to ${targetClan.name}, but was unable to. Did I accidentally become a clan leader?`
          );
        } else {
          if (!/Old Sewers/.test(await this._client.visitUrl("clan_hobopolis.php"))) {
            console.log(`Sewers in clan "${targetClan.name}" inaccessible, aborting.`);

            await this._client.sendPrivateMessage(
              message.who,
              `I can't seem to access the sewers in ${targetClan.name}. Is Hobopolis open? Do I have the right permissions?`
            );
          } else {
            await this.attemptCage(message, targetClan);
          }
        }
      }
    }
  }

  async attemptCage(message: PrivateMessage, targetClan: KoLClan): Promise<void> {
    let gratesOpened = 0;
    let valvesTwisted = 0;
    const [gratesFoundOpen, valvesFoundTwisted]: [number, number] = this._settings.openEverything
      ? await this.readGratesAndValves()
      : [0, 0];
    let currentAdventures = await this._client.getAdvs();
    let estimatedTurnsSpent: number = 0;
    let totalTurnsSpent: number = 0;
    let failedToMaintain = false;

    if (this._settings.openEverything) {
      console.log(
        `${targetClan.name} has ${gratesFoundOpen} grates already opened, ${valvesFoundTwisted} valves already twisted`
      );
    }

    const escapeCageToOpenGratesAndValves: () => boolean = () => {
      if (!this._settings.openEverything) {
        return false;
      }

      // If we have less than this turns, lets not burn the adventures
      if (
        currentAdventures - estimatedTurnsSpent <=
        this._settings.openEverythingWhileAdventuresAbove
      ) {
        if (gratesOpened + gratesFoundOpen < 20) {
          console.log("We don't have enough adventures, so we're not escaping the cage.");
        }

        return false;
      }

      if (gratesOpened + gratesFoundOpen >= 20 && valvesTwisted + valvesFoundTwisted < 20) {
        // Only if we have a large surplus of adventures, do we burn turns on valves when grates are done.
        if (currentAdventures - estimatedTurnsSpent > 160) {
          return true;
        }
      }

      return gratesOpened + gratesFoundOpen < 20;
    };

    await this._client.sendPrivateMessage(
      message.who,
      `Attempting to get caged in ${targetClan.name}.`
    );

    console.log(`Beginning turns in ${targetClan.name} sewers.`);
    let currentDrunk: number = await this._client.getDrunk();

    while (
      !this._amCaged &&
      currentAdventures - estimatedTurnsSpent > 11 &&
      currentDrunk <= this._maxDrunk
    ) {
      // If we haven't failed to maintain our adventures yet
      if (!failedToMaintain) {
        // If we're at or lower than the amount of adventures we wish to maintain.
        if (currentAdventures - estimatedTurnsSpent <= this._settings.maintainAdventures) {
          let adventuresAtm = await this._client.getAdvs();

          // Add total turns spent as far
          totalTurnsSpent += currentAdventures - adventuresAtm;
          // Reset our estimated
          estimatedTurnsSpent = 0;

          // Function returns the new adventures remaining
          let adventuresRemaining = await this.maintainAdventures(message);
          // Update current drunk level
          currentDrunk = await this._client.getDrunk();

          // If the adventures remaining are at, or less than our estimated adventures remaining. Then we failed to maintain our diet.
          failedToMaintain = adventuresAtm >= adventuresRemaining;
          currentAdventures = adventuresRemaining;

          if (failedToMaintain) {
            console.log(
              "We failed to maintain our diet while adventuring in the sewers, will not attempt to maintain again."
            );
          }
        }
      }

      estimatedTurnsSpent += 1;

      const adventureResponse = await this._client.visitUrl("adventure.php", {
        snarfblat: 166,
      });
      if (/Despite All Your Rage/.test(adventureResponse)) {
        estimatedTurnsSpent--;
        this._amCaged = true;

        await this._client.visitUrl("choice.php", {
          whichchoice: 211,
          option: 2,
        });

        if (escapeCageToOpenGratesAndValves()) {
          await this.chewOut();
          estimatedTurnsSpent += 10;
          console.log(`Escaping cage to continue opening grates and twisting valves!`);
        } else {
          console.log(`Caged!`);
        }
      } else if (/Disgustin\' Junction/.test(adventureResponse)) {
        const choiceResponse = await this._client.visitUrl("choice.php", {
          whichchoice: 198,
          option: 3,
        });

        if (/too tired to explore the tunnel on the other side/i.test(choiceResponse)) {
          gratesOpened += 1;
          console.log(`Opened grate. Grate(s) so far: ${gratesOpened}.`);
        }
      } else if (/Somewhat Higher and Mostly Dry/.test(adventureResponse)) {
        const choiceResponse = await this._client.visitUrl("choice.php", {
          whichchoice: 197,
          option: 3,
        });

        if (/as the water level in the sewer lowers by a couple of inches/i.test(choiceResponse)) {
          valvesTwisted += 1;
          console.log(`Opened valve. Valve(s) so far: ${valvesTwisted}.`);
        }
      } else if (/The Former or the Ladder/.test(adventureResponse)) {
        await this._client.visitUrl("choice.php", {
          whichchoice: 199,
          option: 3,
        });
      } else if (/Pop!/.test(adventureResponse)) {
        await this._client.visitUrl("choice.php", {
          whichchoice: 296,
          option: 1,
        });
      }

      if (!this._amCaged && /whichchoice/.test(await this._client.visitUrl("place.php"))) {
        console.log(`Unexpectedly still in a choice after running possible choices. Aborting.`);

        break;
      }
    }

    if (this._amCaged) {
      this._cageStatus = {
        clan: targetClan.name,
        requester: message.who,
        cagedAt: Date.now(),
      };

      console.log(`Successfully caged in clan ${targetClan.name}. Reporting success.`);

      await this._client.sendPrivateMessage(
        message.who,
        `Clang! I am now caged in ${targetClan.name}. Release me later by whispering "escape" to me.`
      );
    } else {
      if (currentAdventures - estimatedTurnsSpent <= 11) {
        console.log(
          `Ran out of adventures attempting to get caged in clan ${targetClan.name}. Aborting.`
        );

        await this._client.sendPrivateMessage(
          message.who,
          `I ran out of adventures trying to get caged in ${targetClan.name}.`
        );
      } else {
        console.log(
          `Unexpected error occurred attempting to get caged in clan ${targetClan.name}. Aborting.`
        );

        await this._client.sendPrivateMessage(
          message.who,
          `Something unspecified went wrong while I was trying to get caged in ${targetClan.name}. Good luck.`
        );
      }
    }

    const endAdvs = await this._client.getAdvs();
    const spentAdvs = totalTurnsSpent + (currentAdventures - endAdvs);

    if (estimatedTurnsSpent + totalTurnsSpent != spentAdvs) {
      console.log(
        `We estimated ${estimatedTurnsSpent} + ${totalTurnsSpent} turns spent, ${spentAdvs} turns were actually spent.`
      );
    }

    await this._client.sendPrivateMessage(
      message.who,
      `I opened ${gratesOpened} grate${
        gratesOpened === 1 ? "" : "s"
      } and turned ${valvesTwisted} valve${
        valvesTwisted === 1 ? "" : "s"
      } on the way, and spent ${spentAdvs} adventure${
        spentAdvs === 1 ? "" : "s"
      } (${endAdvs} remaining).`
    );
    console.log(
      `They have ${gratesOpened + gratesFoundOpen} / 20 grates open, ${
        valvesTwisted + valvesFoundTwisted
      } / 20 valves twisted`
    );

    if (gratesOpened > 0 || valvesTwisted > 0) {
      await this._client.sendPrivateMessage(
        message.who,
        `Hobopolis has ${gratesOpened + gratesFoundOpen} / 20 grates open, ${
          valvesTwisted + valvesFoundTwisted
        } / 20 valves twisted`
      );
    }
  }

  async escapeCage(message: PrivateMessage): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) requested escape from cage.`);

    if (!this._amCaged || (this._cageStatus && this._cageStatus.requester.id !== message.who.id)) {
      if (!this._amCaged) {
        console.log(`Not currently caged, sending status report instead.`);
      } else {
        console.log(`User not authorised to initiate escape, sending status report instead.`);
      }

      await this.statusReport(message);
    } else {
      await this.chewOut();

      console.log(`Successfully chewed out of cage. Reporting success.`);

      await this._client.sendPrivateMessage(message.who, "Chewed out! I am now uncaged.");
    }
  }

  async releaseCage(message: PrivateMessage): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) requested release from cage.`);
    if (
      !this._amCaged ||
      (this._cageStatus && !this.releaseable() && message.who.id !== this._cageStatus.requester.id)
    ) {
      if (!this._amCaged) {
        console.log(`Not currently caged, sending status report instead.`);
      } else {
        console.log(`Release timer has not yet expired, sending status report instead.`);
      }

      await this.initialSetup();
      await this.statusReport(message);
    } else {
      const prevStatus = this._cageStatus;

      await this.chewOut();
      await this.initialSetup();

      console.log(`Successfully chewed out of cage. Reporting success.`);

      await this._client.sendPrivateMessage(message.who, "Chewed out! I am now uncaged.");

      if (prevStatus && prevStatus.requester.id !== message.who.id) {
        console.log(
          `Reporting release to original requester ${prevStatus.requester.name} (#${prevStatus.requester.id}).`
        );

        await this._client.sendPrivateMessage(
          prevStatus.requester,
          `I chewed out of the Hobopolis instance in ${prevStatus.clan} due to recieving a release command after being left in for more than an hour. YOUR CAGE IS NOW UNBAITED.`
        );
      }
    }
  }

  async helpText(message: PrivateMessage): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) requested help.`);

    await this._client.sendPrivateMessage(
      message.who,
      `Hi! I am ${this._client.getMe()?.name} (#${
        this._client.getMe()?.id
      }), and I am running Phillammon's Cagebot script.`
    );

    await this._client.sendPrivateMessage(message.who, `My commands:`);
    await this._client.sendPrivateMessage(message.who, `- status: Get my current status`);
    await this._client.sendPrivateMessage(
      message.who,
      `- cage [clanname]: Try to get caged in the specified clan's hobopolis instance`
    );
    await this._client.sendPrivateMessage(
      message.who,
      `- escape: If you're the person who requested I got caged, chews out of the cage I'm in`
    );
    await this._client.sendPrivateMessage(
      message.who,
      `- release: Chew out of the cage, REGARDLESS of who is responsible for the caging. Only usable if I've been caged for an hour or something's gone wrong.`
    );
    await this._client.sendPrivateMessage(message.who, `- help: Displays this message.`);
  }

  async statusReport(message: PrivateMessage, directlyRequested: boolean = false): Promise<void> {
    if (directlyRequested) {
      console.log(`${message.who.name} (#${message.who.id}) requested status report.`);
    }

    if (this._amCaged) {
      if (this._cageStatus) {
        const cageSecs = this.secondsInCage();

        await this._client.sendPrivateMessage(
          message.who,
          `I have been caged in ${this._cageStatus.clan} for ${this.humanReadableTime(
            cageSecs
          )}, at the request of ${this._cageStatus.requester.name} (#${
            this._cageStatus.requester.id
          }).`
        );

        if (this.releaseable()) {
          await this._client.sendPrivateMessage(
            message.who,
            `As I've been caged for at least an hour, anyone can release me by whispering "release" to me. I have ${await this._client.getAdvs()} adventures left.`
          );
        } else {
          await this._client.sendPrivateMessage(
            message.who,
            `They can release me at any time by whispering "escape" to me, or anyone can release me by whispering "release" to me in ${this.humanReadableTime(
              3600 - cageSecs
            )}. I have ${await this._client.getAdvs()} adventures left.`
          );
        }
      } else {
        await this._client.sendPrivateMessage(
          message.who,
          `I am caged, but I don't know where, when, or for how long. Anyone can release me by whispering "release" to me. I have ${await this._client.getAdvs()} adventures left.`
        );
      }
    } else {
      await this._client.sendPrivateMessage(
        message.who,
        `I am not presently caged and have ${await this._client.getAdvs()} adventures left.`
      );
    }
    //always send info on how full the bot is.
    //todo: assumes max valves. Should check for actual
    await this._client.sendPrivateMessage(
      message.who,
      `My current fullness is ${await this._client.getFull()}/15 and drunkeness is ${await this._client.getDrunk()}/${
        this._maxDrunk
      }.`
    );
  }

  async didntUnderstand(message: PrivateMessage): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) made an incomprehensible request.`);

    await this._client.sendPrivateMessage(
      message.who,
      `I'm afraid I didn't understand that. Whisper me "help" for details of how to use me.`
    );
  }

  humanReadableTime(seconds: number): string {
    return `${Math.floor(seconds / 3600)}:${Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0")}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0")}`;
  }

  secondsInCage(): number {
    if (!this._cageStatus) {
      throw "Tried to find time in cage with no cagestatus.";
    }

    return (Date.now() - this._cageStatus.cagedAt) / 1000;
  }

  releaseable(): boolean {
    return this.secondsInCage() > 3600;
  }

  async chewOut(): Promise<void> {
    await this.testCaged();

    const adventureResponse = await this._client.visitUrl("adventure.php", {
      snarfblat: 166,
    });

    if (/Despite All Your Rage/.test(adventureResponse)) {
      // We do a regex choice on the choice ID because there are two possible choices
      const chewResponse = await this._client.visitUrl("choice.php", {
        whichchoice: / value=211>/.test(adventureResponse) ? 211 : 212,
        option: 1,
      });

      if (!this._amCaged && /whichchoice/.test(chewResponse)) {
        console.log(`Unexpectedly still in a choice after chewing through cage.`);
        return;
      }
    } else if (/Pop!/.test(adventureResponse)) {
      await this._client.visitUrl("choice.php", {
        whichchoice: 296,
        option: 1,
      });
    }

    this._amCaged = false;
    this._cageStatus = undefined;
    await this.maintainAdventures();
  }

  async maintainAdventures(message?: PrivateMessage): Promise<number> {
    const beforeAdv = await this._client.getAdvs();

    if (beforeAdv > this._settings.maintainAdventures) {
      return beforeAdv;
    }

    const currentFull = await this._client.getFull();
    const currentDrunk = await this._client.getDrunk();
    const fullRemaining = 15 - currentFull;
    const drunkRemaining = this._maxDrunk - currentDrunk;

    if (fullRemaining <= 0 && drunkRemaining <= 0) {
      // have consumed as much as we can for the day and low on adventures
      return beforeAdv;
    }

    const currentLevel = await this._client.getLevel();
    const inventory: Map<number, number> = await this._client.getInventory();
    let itemConsumed;
    let itemsMissing: string[] = [];
    let consumeMessage: any;

    for (let diet of this._diet) {
      if (diet.level > currentLevel) {
        continue;
      }

      if (diet.fullness > (diet.type == "food" ? fullRemaining : drunkRemaining)) {
        continue;
      }

      if ((inventory.get(diet.id) || 0) <= 0) {
        itemsMissing.push(diet.name);
        continue;
      }

      if (diet.type == "food") {
        console.log(`Attempting to eat ${diet.name}, of which we have ${inventory.get(diet.id)}`);
        consumeMessage = await this._client.eat(diet.id);
      } else {
        console.log(`Attempting to drink ${diet.name}, of which we have ${inventory.get(diet.id)}`);

        if (this._usingBarrelMimic && this._ownsTuxedo) {
          const priorShirt = (await this._client.getEquipment()).get("shirt") || 0;

          if (priorShirt != 2489) {
            await this._client.equip(2489);
          }

          consumeMessage = this._client.drink(diet.id);

          if (priorShirt > 0 && priorShirt != 2489) {
            await this._client.equip(priorShirt);
          }
        } else {
          consumeMessage = await this._client.drink(diet.id);
        }
      }

      itemConsumed = diet.name;
      break;
    }

    const afterAdv = await this._client.getAdvs();

    if (beforeAdv === afterAdv) {
      if (itemConsumed) {
        console.log(`Failed to consume ${itemConsumed}.`);
        console.log(consumeMessage);
      } else if (this._usingBarrelMimic) {
        console.log(`I am out of Lil' Barrel Mimic consumables.`);

        if (message !== undefined) {
          this._client.sendPrivateMessage(
            message.who,
            `Please tell my operator that I am out of consumables.`
          );
        }
      } else {
        console.log(`I am out of ${itemsMissing.join(", ")}.`);

        if (message !== undefined) {
          this._client.sendPrivateMessage(
            message.who,
            `Please tell my operator that I am out of ${itemsMissing.join(", ")}.`
          );
        }
      }
    }

    return afterAdv;
  }
}

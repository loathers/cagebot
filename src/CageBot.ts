import { KoLClan, KoLClient, KoLStatus, KoLUser, PrivateMessage } from "./KoLClient";
import { Mutex } from "async-mutex";

type CageTask = {
  requester: KoLUser;
  clan: KoLClan;
  started: number;
  api: boolean;
};

type Diet = {
  type: "food" | "drink";
  id: number; // Item ID
  name: string; // Name
  level: number; // Level required to consume
  fullness: number; // Full/Drunk of the item
  estAdvs: number; // Underestimate of the adventures given
};

type HoboStatus = "Diving" | "Caged" | "Releasable";
type RequestStatus = "Accepted" | "Busy" | "Error" | "Seen" | "Issue" | "Notification";

type BusyStatus = {
  elapsed?: number; // Seconds in current task, absent if we don't know
  player?: number; // Who requested the task, absent if we don't know
  clan?: number; // Clan we're trapped in, absent if not caged or we don't know
  state: HoboStatus; // If we're currently sewer diving, caged and requester can't release, or releasable
};

type JsonStatus = {
  advs: number; // Adventures remaining
  full: number; // Current fullness used
  maxFull: number; // Max fullness, absent if we don't know
  drunk: number; // Current liver used
  maxDrunk?: number; // Max liver, absent if we don't know
  status?: BusyStatus; // If absent, means not doing anything
};

type DietStatus = {
  possibleAdvsToday: number; // Possible adventures we can get from our diet
  food: number; // Count of total fullness our current supply can provide
  fullnessAdvs: number; // Total adventures our food would give
  drink: number; // Count of total drunkness our current supply can provide
  totalDrunkness: number; // Total adventures our drinks would give
};

type RequestResponse = {
  status: RequestStatus; // Used when its a request that is possibly blocking
  details: string;
};

type ExploredStatus = {
  caged: boolean; // If we're caged in the end
  advsUsed: number; // Adventures taken
  advsLeft: number;
  grates: number; // Grates opened
  totalGrates: number; // Total grates open
  valves: number; // Valves twisted
  totalValves: number; // Total valves twisted
  chews: number; // Amount of cages chewed out
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
  private cageTask?: CageTask;
  private _settings: Settings;
  private _diet: Diet[] = [];
  private _maxDrunk?: number;
  private _ownsTuxedo: boolean = false;
  private _usingBarrelMimic: boolean = false;
  private _doneInitialSetup: boolean = false;
  private _lastTestCage: number = Date.now();

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
          this._privateMessages.push(...(await this._client.fetchNewWhispers()));
        }, 3000);
        this.processMessage();
      })
    );
  }

  async testCaged(): Promise<void> {
    this._lastTestCage = Date.now();
    let page = await this._client.visitUrl("place.php");

    if (/Pop!/.test(page)) {
      page = await this._client.visitUrl("choice.php", {
        whichchoice: 296,
        option: 1,
      });
    }

    this._amCaged = /Despite All Your Rage/.test(page);

    if (!this._amCaged) {
      this.cageTask = undefined;
    }
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
        throw "\nCombat Macro not found, Combat Macro required to continue.\n";
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
      } else {
        this._maxDrunk = 14;
      }

      this._doneInitialSetup = true;
    }

    if (this._diet.length == 0) {
      const status = await this._client.getStatus();

      this._ownsTuxedo =
        (await this._client.getInventory()).has(2489) || status?.equipment.get("shirt") == 2489;

      this._usingBarrelMimic = status?.familiar == 198;

      if (this._usingBarrelMimic) {
        this.fillLilBarrelDietData();
      } else {
        this.fillDietData();
      }
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
      estAdvs: 30,
    });
    this._diet.push({
      type: "food",
      id: 2767,
      name: "Crimbo pie",
      level: 7,
      fullness: 3,
      estAdvs: 11,
    });
    this._diet.push({
      type: "drink",
      id: 7370,
      name: "Psychotic Train wine",
      level: 11,
      fullness: 6,
      estAdvs: 19,
    });
    this._diet.push({
      type: "drink",
      id: 9948,
      name: "Middle of the Road™ brand whiskey",
      level: 1,
      fullness: 2,
      estAdvs: 4,
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
      estAdvs: 11,
    });
    this._diet.push({
      type: "food",
      id: 316,
      name: "Insanely spicy bean burrito",
      level: 4,
      fullness: 3,
      estAdvs: 10,
    });
    this._diet.push({
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
      this._diet.push({
        type: "drink",
        id: drinkId as number,
        name: name as string,
        level: 4,
        fullness: 4,
        estAdvs: 11,
      });
    }

    // Good
    this._diet.push({
      type: "food",
      id: 318,
      name: "Spicy enchanted bean burrito",
      level: 4,
      fullness: 3,
      estAdvs: 9,
    });
    this._diet.push({
      type: "food",
      id: 315,
      name: "Spicy bean burrito",
      level: 3,
      fullness: 3,
      estAdvs: 8,
    });
    this._diet.push({
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
      this._diet.push({
        type: "drink",
        id: drinkId as number,
        name: name as string,
        level: 3,
        fullness: 3,
        estAdvs: 7,
      });
    }

    // Decent
    this._diet.push({
      type: "food",
      id: 317,
      name: "Enchanted bean burrito",
      level: 2,
      fullness: 3,
      estAdvs: 6,
    });
    this._diet.push({
      type: "food",
      id: 314,
      name: "Bean burrito",
      level: 1,
      fullness: 3,
      estAdvs: 5,
    });
    this._diet.push({
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
      this._diet.push({
        type: "drink",
        id: drinkId as number,
        name: name as string,
        level: 1,
        fullness: 3,
        estAdvs: 5,
      });
    }
  }

  getPossibleAdventuresFromDiet(status: KoLStatus, inv: Map<number, number>): number {
    if (this._diet.length == 0) {
      return 0;
    }

    let drunkRemaining: number = (this._maxDrunk || 14) - status.drunk;
    let fullRemaining: number = 14 - status.full;
    let advs: number = 0;

    for (let diet of this._diet) {
      if (diet.level > status.level) {
        continue;
      }

      let amount = inv.get(diet.id) || 0;

      while (
        amount > 0 &&
        (diet.type == "food" ? fullRemaining : drunkRemaining) >= diet.fullness
      ) {
        advs += diet.estAdvs;
        amount--;

        if (diet.type == "food") {
          fullRemaining += diet.fullness;
        } else {
          drunkRemaining += diet.fullness;
        }
      }
    }

    return advs;
  }

  isBusy(): boolean {
    return this.cageTask != undefined && !this._amCaged;
  }

  async tryRunBlocking(
    message: PrivateMessage,
    toCall: (message: PrivateMessage, apiRequest: boolean) => Promise<any>,
    apiRequest: boolean = false
  ) {
    if (this.isBusy() || mutex.isLocked()) {
      if (apiRequest) {
        await this.sendApiResponse(message, "Busy", "already_in_use");
      } else {
        await this._client.sendPrivateMessage(
          message.who,
          "Sorry, I am currently busy processing a request. Please wait, or send a status request."
        );
      }

      return;
    }

    await mutex.runExclusive(async () => {
      await toCall.call(this, message, apiRequest);
    });
  }

  async processMessage(): Promise<void> {
    const message = this._privateMessages.shift();

    if (message) {
      console.log(`Processing whisper from ${message.who.name} (#${message.who.id})`);
      const processedMsg = message.msg.toLowerCase();

      if (processedMsg.startsWith("status.api")) {
        await this.sendApiStatus(message);
      } else if (processedMsg.startsWith("diet.api")) {
        await this.sendDietApi(message);
      } else if (processedMsg.startsWith("cage.api")) {
        await this.tryRunBlocking(message, this.becomeCaged, true);
      } else if (processedMsg.startsWith("release.api")) {
        await this.tryRunBlocking(message, this.releaseCage, true);
      } else if (processedMsg.startsWith("escape.api")) {
        await this.tryRunBlocking(message, this.escapeCage, true);
      } else if (processedMsg.startsWith("status")) {
        await this.statusReport(message, true);
      } else if (processedMsg.startsWith("cage")) {
        await this.tryRunBlocking(message, this.becomeCaged);
      } else if (processedMsg.startsWith("escape")) {
        await this.tryRunBlocking(message, this.escapeCage);
      } else if (processedMsg.startsWith("release")) {
        await this.tryRunBlocking(message, this.releaseCage);
      } else if (processedMsg.startsWith("help")) {
        await this.helpText(message);
      } else if (processedMsg.startsWith("diet")) {
        await this.sendDietReport(message);
      } else {
        await this.didntUnderstand(message);
      }

      this.processMessage();
    } else {
      setTimeout(() => this.processMessage(), 1000);
    }
  }

  async sendApiStatus(message: PrivateMessage): Promise<void> {
    // If 15min has elapsed from last caged check
    if (
      this._amCaged &&
      !mutex.isLocked() &&
      !this.isBusy() &&
      this._lastTestCage + 15 * 60 < Date.now()
    ) {
      await mutex.runExclusive(async () => {
        await this.testCaged();
      });
    }

    const apiStatus = await this._client.getStatus();
    let busyStatus: BusyStatus | undefined;

    if (this._amCaged || this.cageTask) {
      busyStatus = {
        state: !this._amCaged
          ? "Diving"
          : this.releaseable() || !this.cageTask || this.cageTask.requester.id === message.who.id
          ? "Releasable"
          : "Caged",
      };

      if (this.cageTask) {
        busyStatus.elapsed = this.secondsInTask();
        busyStatus.player = parseInt(this.cageTask.requester.id);
        busyStatus.clan = parseInt(this.cageTask.clan.id);
      }
    }

    // The status is ideally one that we can replace all spaces and no data is broke
    const status: JsonStatus = {
      advs: apiStatus?.adventures,
      full: apiStatus.full,
      maxFull: 15,
      drunk: apiStatus.drunk,
      maxDrunk: this._maxDrunk,
      status: busyStatus,
    };

    await this._client.sendPrivateMessage(message.who, JSON.stringify(status));
  }

  async sendDietApi(message: PrivateMessage) {
    const inventory: Map<number, number> = await this._client.getInventory();
    const status = await this._client.getStatus();
    const level = status.level;
    let food: number = 0;
    let drink: number = 0;
    let fullAdvs: number = 0;
    let drunkAdvs: number = 0;
    let advs: number = this.getPossibleAdventuresFromDiet(status, inventory);

    for (let diet of this._diet) {
      if (!inventory.has(diet.id) || diet.level > level) {
        continue;
      }

      let count = inventory.get(diet.id) || 0;

      if (diet.type == "food") {
        food += count * diet.fullness;
        fullAdvs += count * diet.fullness * diet.estAdvs;
      } else {
        drink += count * diet.fullness;
        drunkAdvs += count * diet.fullness * diet.estAdvs;
      }
    }

    const dietStatus: DietStatus = {
      possibleAdvsToday: advs,
      food: food,
      fullnessAdvs: fullAdvs,
      drink: drink,
      totalDrunkness: drunkAdvs,
    };

    await this._client.sendPrivateMessage(message.who, JSON.stringify(dietStatus));
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

  async becomeCaged(message: PrivateMessage, apiRequest: boolean): Promise<void> {
    await this.testCaged();

    // If rollover is less than 7 minutes away
    if ((await this._client.getSecondsToRollover()) < 7 * 60) {
      if (apiRequest) {
        await this.sendApiResponse(message, "Error", "rollover");
      } else {
        await this._client.sendPrivateMessage(
          message.who,
          `Rollover is in ${this.humanReadableTime(
            await this._client.getSecondsToRollover()
          )}, I do not wish to get into a bad state. Please try again after rollover.`
        );
      }

      return;
    }

    if (!message.msg.includes(" ")) {
      console.log("Received a cage request, with no clan name included.");

      if (apiRequest) {
        this.sendApiResponse(message, "Error", "invalid_clan");
      } else {
        await this._client.sendPrivateMessage(
          message.who,
          "Please provide the name of a clan I am whitelisted in."
        );
      }

      return;
    }

    const clanName = message.msg.slice(message.msg.indexOf(" ") + 1);
    console.log(`${message.who.name} (#${message.who.id}) requested caging in clan "${clanName}"`);

    if (this._amCaged) {
      if (apiRequest) {
        console.log(`Already caged. Sending invalid response instead.`);
        await this.sendApiResponse(message, "Error", "already_caged");
      } else {
        console.log(`Already caged. Sending status report instead.`);
        await this.statusReport(message);
      }

      return;
    }

    const whitelists = (await this._client.getWhitelists()).filter((clan: KoLClan) =>
      clan.name.toLowerCase().includes(clanName.toLowerCase())
    );

    if (whitelists.length > 1) {
      console.log(`Clan name "${clanName}" ambiguous, aborting.`);

      if (apiRequest) {
        await this.sendApiResponse(message, "Error", "clan_ambiguous");
      } else {
        this._client.sendPrivateMessage(
          message.who,
          `I'm in multiple clans named ${clanName}: ${whitelists.join(
            ", "
          )}. Please be more specific.`
        );
      }

      return;
    }

    if (whitelists.length < 1) {
      console.log(`Clan name "${clanName}" does not match any whitelists, aborting.`);

      if (apiRequest) {
        await this.sendApiResponse(message, "Error", "not_whitelisted");
      } else {
        this._client.sendPrivateMessage(
          message.who,
          `I'm not in any clans named ${clanName}. Check your spelling, or ensure I have a whitelist.`
        );
      }

      return;
    }

    const targetClan = whitelists[0];

    console.log(
      `Clan name "${clanName}" matched to whitelisted clan "${targetClan.name}". Attempting to whitelist.`
    );

    await this._client.joinClan(targetClan);

    if ((await this._client.myClan()) !== targetClan.id) {
      console.log(`Whitelisting to clan "${targetClan.name}" failed, aborting.`);

      if (apiRequest) {
        await this.sendApiResponse(message, "Error", "unsuccessful_whitelist");
      } else {
        await this._client.sendPrivateMessage(
          message.who,
          `I tried to whitelist to ${targetClan.name}, but was unable to. Did I accidentally become a clan leader?`
        );
      }

      return;
    }

    if (!/Old Sewers/.test(await this._client.visitUrl("clan_hobopolis.php"))) {
      console.log(`Sewers in clan "${targetClan.name}" inaccessible, aborting.`);

      if (apiRequest) {
        await this.sendApiResponse(message, "Error", "no_hobo_access");
      } else {
        await this._client.sendPrivateMessage(
          message.who,
          `I can't seem to access the sewers in ${targetClan.name}. Is Hobopolis open? Do I have the right permissions?`
        );
      }

      return;
    }

    await this.attemptCage(message, targetClan, apiRequest);
  }

  async sendApiResponse(message: PrivateMessage, status: RequestStatus, details: string) {
    const apiStatus: RequestResponse = {
      status: status,
      details: details,
    };

    this._client.sendPrivateMessage(message.who, JSON.stringify(apiStatus));
  }

  async attemptCage(
    message: PrivateMessage,
    targetClan: KoLClan,
    apiRequest: boolean
  ): Promise<void> {
    this.cageTask = {
      clan: targetClan,
      requester: message.who,
      started: Date.now(),
      api: apiRequest,
    };

    let status = await this._client.getStatus();

    let gratesOpened = 0;
    let valvesTwisted = 0;
    let timesChewedOut = 0;
    const [gratesFoundOpen, valvesFoundTwisted]: [number, number] = this._settings.openEverything
      ? await this.readGratesAndValves()
      : [0, 0];
    let currentAdventures = status.adventures;
    let currentDrunk: number = status.drunk;
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

    if (apiRequest) {
      await this.sendApiResponse(message, "Accepted", "doing_cage");
    } else {
      await this._client.sendPrivateMessage(
        message.who,
        `Attempting to get caged in ${targetClan.name}.`
      );
    }

    console.log(`Beginning turns in ${targetClan.name} sewers.`);

    while (
      !this._amCaged &&
      currentAdventures - estimatedTurnsSpent > 11 &&
      currentDrunk <= (this._maxDrunk || 14)
    ) {
      // If we haven't failed to maintain our adventures yet
      if (!failedToMaintain) {
        // If we're at or lower than the amount of adventures we wish to maintain.
        if (currentAdventures - estimatedTurnsSpent <= this._settings.maintainAdventures) {
          status = await this._client.getStatus();
          let adventuresPreDiet = status.adventures;

          // Add total turns spent as far
          totalTurnsSpent += currentAdventures - adventuresPreDiet;
          // Reset our estimated
          estimatedTurnsSpent = 0;

          // Function returns the new adventures remaining
          let adventuresAfterDiet = await this.maintainAdventures(message);
          // Update current drunk level
          currentDrunk = status.drunk;
          // If the adventures remaining are at, or less than our estimated adventures remaining. Then we failed to maintain our diet.
          failedToMaintain =
            adventuresPreDiet == adventuresAfterDiet &&
            adventuresAfterDiet <= this._settings.maintainAdventures;
          currentAdventures = adventuresAfterDiet;

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
          timesChewedOut++;
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
        } else {
          estimatedTurnsSpent--; // Free turn
        }
      } else if (/Somewhat Higher and Mostly Dry/.test(adventureResponse)) {
        const choiceResponse = await this._client.visitUrl("choice.php", {
          whichchoice: 197,
          option: 3,
        });

        if (/as the water level in the sewer lowers by a couple of inches/i.test(choiceResponse)) {
          valvesTwisted += 1;
          console.log(`Opened valve. Valve(s) so far: ${valvesTwisted}.`);
        } else {
          estimatedTurnsSpent--; // Free turn
        }
      } else if (/The Former or the Ladder/.test(adventureResponse)) {
        // Funny enough, this is not a free turn. But we're going to try release our clanmate even though the water means another fight.
        // Why? Because we will never leave a clanmate to suffer.
        // I'm looking at you. You leave the bot to cry in a cage.
        // This bot knows how bad it feels, this bot will never left someone suffer as it does.

        await this._client.visitUrl("choice.php", {
          whichchoice: 199,
          option: 3,
        });
      } else if (/Pop!/.test(adventureResponse)) {
        estimatedTurnsSpent--; // Free turn

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
      this.cageTask = {
        clan: targetClan,
        requester: message.who,
        started: Date.now(),
        api: apiRequest,
      };

      console.log(`Successfully caged in clan ${targetClan.name}. Reporting success.`);

      if (!apiRequest) {
        await this._client.sendPrivateMessage(
          message.who,
          `Clang! I am now caged in ${targetClan.name}. Release me later by whispering "escape" to me.`
        );
      }
    } else {
      this.cageTask = undefined;

      if (currentAdventures - estimatedTurnsSpent <= 11) {
        console.log(
          `Ran out of adventures attempting to get caged in clan ${targetClan.name}. Aborting.`
        );

        // API doesn't send a message here, but sends it later
        if (!apiRequest) {
          await this._client.sendPrivateMessage(
            message.who,
            `I ran out of adventures trying to get caged in ${targetClan.name}.`
          );
        }
      } else {
        console.log(
          `Unexpected error occurred attempting to get caged in clan ${targetClan.name}. Aborting.`
        );

        // API doesn't send a message here, but sends it later
        if (!apiRequest) {
          await this._client.sendPrivateMessage(
            message.who,
            `Something unspecified went wrong while I was trying to get caged in ${targetClan.name}. Good luck.`
          );
        }
      }
    }

    const endAdvs = status.adventures;
    const spentAdvs = totalTurnsSpent + (currentAdventures - endAdvs);

    if (estimatedTurnsSpent + totalTurnsSpent != spentAdvs) {
      console.log(
        `We estimated ${estimatedTurnsSpent} + ${totalTurnsSpent} turns spent, ${spentAdvs} turns were actually spent.`
      );
    }

    console.log(
      `The clan has ${gratesOpened + gratesFoundOpen} / 20 grates open, ${
        valvesTwisted + valvesFoundTwisted
      } / 20 valves twisted.`
    );

    if (apiRequest) {
      const hoboStatus: ExploredStatus = {
        caged: this._amCaged,
        advsUsed: spentAdvs,
        advsLeft: endAdvs,
        grates: gratesOpened,
        totalGrates: gratesOpened + gratesFoundOpen,
        valves: valvesTwisted,
        totalValves: valvesTwisted + valvesFoundTwisted,
        chews: timesChewedOut,
      };

      await this._client.sendPrivateMessage(message.who, JSON.stringify(hoboStatus));
    } else {
      await this._client.sendPrivateMessage(
        message.who,
        `I opened ${gratesOpened} grate${
          gratesOpened === 1 ? "" : "s"
        } and turned ${valvesTwisted} valve${valvesTwisted === 1 ? "" : "s"} on the way,${
          timesChewedOut > 0 ? ` caged yet escaped ${timesChewedOut} times,` : ``
        } and spent ${spentAdvs} adventure${spentAdvs === 1 ? "" : "s"} (${endAdvs} remaining).`
      );

      if (gratesOpened > 0 || valvesTwisted > 0) {
        await this._client.sendPrivateMessage(
          message.who,
          `Hobopolis has ${gratesOpened + gratesFoundOpen} / 20 grates open, ${
            valvesTwisted + valvesFoundTwisted
          } / 20 valves twisted.`
        );
      }
    }
  }

  async escapeCage(message: PrivateMessage, apiRequest: boolean = false): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) requested escape from cage.`);

    if (!this._amCaged || (this.cageTask && this.cageTask.requester.id !== message.who.id)) {
      if (!this._amCaged) {
        console.log(`Not currently caged, sending status report instead.`);
      } else {
        console.log(`User not authorised to initiate escape, sending status report instead.`);
      }

      if (apiRequest) {
        if (this._amCaged) {
          await this.sendApiResponse(message, "Error", "unauthorised");
        } else {
          await this.sendApiResponse(message, "Error", "not_caged");
        }
      } else {
        await this.statusReport(message);
      }
    } else {
      await this.chewOut();

      console.log(`Successfully chewed out of cage. Reporting success.`);

      if (apiRequest) {
        await this.sendApiStatus(message);
      } else {
        await this._client.sendPrivateMessage(message.who, "Chewed out! I am now uncaged.");
      }
    }
  }

  async releaseCage(message: PrivateMessage, apiRequest: boolean): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) requested release from cage.`);

    if (
      !this._amCaged ||
      (this.cageTask && !this.releaseable() && message.who.id !== this.cageTask.requester.id)
    ) {
      if (!this._amCaged) {
        console.log(`Not currently caged, sending status report instead.`);
      } else {
        console.log(`Release timer has not yet expired, sending status report instead.`);
      }

      await this.initialSetup();

      if (apiRequest) {
        if (this._amCaged) {
          await this.sendApiResponse(message, "Error", "timer_not_expired");
        } else {
          await this.sendApiResponse(message, "Error", "not_caged");
        }
      } else {
        await this.statusReport(message);
      }
    } else {
      const prevStatus = this.cageTask;

      await this.chewOut();
      await this.initialSetup();

      console.log(`Successfully chewed out of cage. Reporting success.`);

      if (apiRequest) {
        await this.sendApiStatus(message);
      } else {
        await this._client.sendPrivateMessage(message.who, "Chewed out! I am now uncaged.");
      }

      if (prevStatus && prevStatus.requester.id !== message.who.id) {
        console.log(
          `Reporting release to original requester ${prevStatus.requester.name} (#${prevStatus.requester.id}).`
        );

        if (prevStatus.api) {
          await this.sendApiResponse(message, "Notification", "released_from_cage");
        } else {
          await this._client.sendPrivateMessage(
            prevStatus.requester,
            `I chewed out of the Hobopolis instance in ${prevStatus.clan.name} due to recieving a release command after being left in for more than an hour. YOUR CAGE IS NOW UNBAITED.`
          );
        }
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

    const status = await this._client.getStatus();

    if (this._amCaged) {
      if (this.cageTask) {
        const cageSecs = this.secondsInTask();

        await this._client.sendPrivateMessage(
          message.who,
          `I have been caged in ${this.cageTask.clan.name} for ${this.humanReadableTime(
            cageSecs
          )}, at the request of ${this.cageTask.requester.name} (#${this.cageTask.requester.id}).`
        );

        if (this.releaseable()) {
          await this._client.sendPrivateMessage(
            message.who,
            `As I've been caged for at least an hour, anyone can release me by whispering "release" to me. I have ${status.adventures} adventures left.`
          );
        } else {
          await this._client.sendPrivateMessage(
            message.who,
            `They can release me at any time by whispering "escape" to me, or anyone can release me by whispering "release" to me in ${this.humanReadableTime(
              3600 - cageSecs
            )}. I have ${status.adventures} adventures left.`
          );
        }
      } else {
        await this._client.sendPrivateMessage(
          message.who,
          `I am caged, but I don't know where, when, or for how long. Anyone can release me by whispering "release" to me. I have ${status.adventures} adventures left.`
        );
      }
    } else {
      await this._client.sendPrivateMessage(
        message.who,
        `I am not presently caged and have ${status.adventures} adventures left.`
      );
    }
    //always send info on how full the bot is.
    //todo: assumes max valves. Should check for actual
    await this._client.sendPrivateMessage(
      message.who,
      `My current fullness is ${status.full}/15 and drunkeness is ${status.drunk}/${
        this._maxDrunk || "???"
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

  secondsInTask(): number {
    if (!this.cageTask) {
      throw "Tried to find time in cage with no cagestatus.";
    }

    return (Date.now() - this.cageTask.started) / 1000;
  }

  releaseable(): boolean {
    return this.secondsInTask() > 3600;
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
    this.cageTask = undefined;
    await this.maintainAdventures();
  }

  async maintainAdventures(message?: PrivateMessage, apiRequest: boolean = false): Promise<number> {
    const status = await this._client.getStatus();
    const beforeAdv = status.adventures;

    if (beforeAdv > this._settings.maintainAdventures) {
      return beforeAdv;
    }

    const currentFull = status.full;
    const currentDrunk = status.drunk;
    const fullRemaining = 15 - currentFull;
    const drunkRemaining = (this._maxDrunk || 14) - currentDrunk;

    if (fullRemaining <= 0 && drunkRemaining <= 0) {
      // have consumed as much as we can for the day and low on adventures
      return beforeAdv;
    }

    const currentLevel = status.level;
    const inventory: Map<number, number> = await this._client.getInventory();
    let itemConsumed;
    let itemsMissing: string[] = [];
    let itemIdsMissing: string[] = [];
    let consumeMessage: any;

    for (let diet of this._diet) {
      if (diet.level > currentLevel) {
        continue;
      }

      if ((inventory.get(diet.id) || 0) <= 0) {
        itemsMissing.push(diet.name);
        itemIdsMissing.push(diet.id.toString());
        continue;
      }

      if (diet.fullness > (diet.type == "food" ? fullRemaining : drunkRemaining)) {
        continue;
      }

      if (diet.type == "food") {
        console.log(`Attempting to eat ${diet.name}, of which we have ${inventory.get(diet.id)}`);
        consumeMessage = await this._client.eat(diet.id);
      } else {
        console.log(`Attempting to drink ${diet.name}, of which we have ${inventory.get(diet.id)}`);

        if (this._usingBarrelMimic && this._ownsTuxedo) {
          const priorShirt = status.equipment.get("shirt") || 0;

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

    const afterAdv = status.adventures;

    if (beforeAdv === afterAdv) {
      if (itemConsumed) {
        console.log(`Failed to consume ${itemConsumed}.`);
        console.log(consumeMessage);
      } else if (this._usingBarrelMimic) {
        console.log(`I am out of Lil' Barrel Mimic consumables.`);

        if (message !== undefined) {
          if (apiRequest) {
            await this.sendApiResponse(message, "Issue", "lack_barrel_edibles");
          } else {
            this._client.sendPrivateMessage(
              message.who,
              `Please tell my operator that I am out of consumables.`
            );
          }
        }
      } else {
        console.log(`I am out of ${itemsMissing.join(", ")}.`);

        if (message !== undefined) {
          if (apiRequest) {
            await this.sendApiResponse(
              message,
              "Issue",
              "lack_edibles:" + itemIdsMissing.join(",")
            );
          } else {
            this._client.sendPrivateMessage(
              message.who,
              `Please tell my operator that I am out of ${itemsMissing.join(", ")}.`
            );
          }
        }
      }
    } else {
      console.log(
        `Diet success! We previously had ${beforeAdv} adventures, now we have ${afterAdv} adventures!`
      );
    }

    return afterAdv;
  }
}

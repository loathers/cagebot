import { Mutex } from "async-mutex";
import { DietHandler } from "./handlers/DietHandler";
import { CagingHandler } from "./handlers/CagingHandler";
import { UncageHandler } from "./handlers/UncageHandler";
import { BusyResponse, StatusResponse } from "./utils/JsonResponses";
import { KoLClient } from "./utils/KoLClient";
import { ChatMessage, CageTask, Settings } from "./utils/Typings";
import {
  humanReadableTime,
  updateWhiteboard,
  sendApiResponse,
  saveSettings,
  loadSettings,
  toJson,
  createApiResponse,
} from "./utils/Utils";
import { readFileSync } from "fs";

const mutex = new Mutex();

export class CageBot {
  private _privateMessages: ChatMessage[] = [];
  private _client: KoLClient;
  private _amCaged: boolean = false;
  private _cageTask?: CageTask;
  private _settings: Settings;
  private _lastCheckForThirdPartyUncaging: number = Date.now();
  private _diet: DietHandler;
  private _cageHandler: CagingHandler;
  private _uncageHandler: UncageHandler;

  constructor(username: string, password: string, settings: Settings) {
    this._client = new KoLClient(username, password);
    this._settings = settings;

    this._diet = new DietHandler(this);
    this._cageHandler = new CagingHandler(this);
    this._uncageHandler = new UncageHandler(this);
  }

  getClient(): KoLClient {
    return this._client;
  }

  getSettings(): Settings {
    return this._settings;
  }

  getCageTask(): CageTask | undefined {
    return this._cageTask;
  }

  getDietHandler(): DietHandler {
    return this._diet;
  }

  setCagedStatus(caged: boolean, task?: CageTask) {
    this._amCaged = caged;
    this._cageTask = task;
  }

  async saveSettings() {
    if (!this.getDietHandler().getMaxDrunk()) {
      return;
    }

    const status = await this.getClient().getStatus();

    saveSettings(status.turnsPlayed, this.getDietHandler().getMaxDrunk() || 14, this.getCageTask());
  }

  async loadSettings() {
    // If the bot is not caged, or its busy, or it has a cage task already
    if (!this.isCaged() || this.isBusy() || this._cageTask) {
      return;
    }

    const settings = loadSettings();

    if (!settings || !settings.validAtTurn) {
      console.log("Unable to load valid runstate");
      return;
    }

    const status = await this.getClient().getStatus();

    // If this was saved at turn X, but the current turn has differed
    if (settings.validAtTurn != status.turnsPlayed) {
      console.log("Runstate differs from expected, not loading.");
      return;
    }

    this.getDietHandler().setMaxDrunk(settings.maxDrunk);
    this._cageTask = settings.cageTask;

    console.log("Loaded previous state from saved file");
  }

  start(): void {
    console.log("Starting Cagebot...");
    console.log(`We're trying to maintain ${this._settings.maintainAdventures} adventures`);

    if (this._settings.openEverything) {
      console.log(
        `While adventures are above ${this._settings.openEverythingWhileAdventuresAbove}, we're escaping the cage to open grates and twist valves.`
      );
    }

    this._client.logIn().then(() =>
      this.doInitialSetup().then(async () => {
        const secondsToRollover = await this._client.getSecondsToRollover();

        console.log(`The next rollover is in ${humanReadableTime(secondsToRollover)}`);
        console.log("Initial setup complete. Polling messages.");

        setInterval(async () => {
          this._privateMessages.push(...(await this._client.fetchNewWhispers()));
        }, 3000);
        this.processMessage();
      })
    );
  }

  async testForThirdPartyUncaging(): Promise<void> {
    this._lastCheckForThirdPartyUncaging = Date.now();
    let page = await this._client.visitUrl("place.php");

    if (/Pop!/.test(page)) {
      page = await this._client.visitUrl("choice.php", {
        whichchoice: 296,
        option: 1,
      });
    }

    this._amCaged = /Despite All Your Rage/.test(page);

    if (!this._amCaged) {
      this._cageTask = undefined;
      await updateWhiteboard(this, this._amCaged);
    }
  }

  async doInitialSetup(): Promise<void> {
    await this.doSetup();
    await this.getClient().useChatMacro("/listenon Hobopolis");

    if (this.isCaged()) {
      console.log("We appear to be caged.");
      await this.loadSettings();
      return;
    }

    let macro = (await this.getClient().getCombatMacros()).find((m) => m.name === "CAGEBOT");
    const macroText = readFileSync("./data/CombatMacro.txt", "utf-8");

    if (!macro) {
      console.log("Combat Macro not found, we will be saving the default!");

      await this.getClient().createCombatMacro("CAGEBOT", macroText);
      macro = (await this.getClient().getCombatMacros()).find((m) => m.name === "CAGEBOT");

      if (!macro) {
        throw "Failed to create the CAGEBOT macro!";
      }
    } else {
      const theirMacro = await this.getClient().getCombatMacro(macro);

      if (theirMacro !== macroText) {
        console.log("Custom CAGEBOT macro detected! This is probably fine.");
      }
    }

    const currentMacro = await this.getClient().getAutoAttackMacro();

    if (!currentMacro || currentMacro.name !== "CAGEBOT") {
      if (!currentMacro) {
        console.log("AutoAttack macro is missing, changing that to CAGEBOT");
        await this.getClient().setAutoAttackMacro(macro);
      } else {
        console.log(
          "AutoAttack Macro is not CAGEBOT, will leave untouched but this may be an error."
        );
      }
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
  }

  async doSetup(): Promise<void> {
    await this.testForThirdPartyUncaging();

    await this.getDietHandler().doSetup();

    if (!this._amCaged) {
      await this._diet.maintainAdventures();
    }
  }

  isCaged(): boolean {
    return this._amCaged;
  }

  isBusy(): boolean {
    return this._cageTask != undefined && !this._amCaged;
  }

  async runBlockingRequest(message: ChatMessage, toCall: () => Promise<any>) {
    if (this.isBusy() || mutex.isLocked()) {
      if (message.apiRequest) {
        await sendApiResponse(message, "Busy", "already_in_use");
      } else {
        await message.reply(
          "Sorry, I am currently busy processing a request. Please wait, or send a status request."
        );
      }

      return;
    }

    mutex.runExclusive(async () => {
      await toCall();
    });
  }

  async processHobopolisMessage(message: ChatMessage): Promise<void> {
    // If not a clan dungeon announcement
    if (!message.who || message.who.id !== "-2") {
      return;
    }

    const task = this._cageTask;

    if (!this._amCaged || !task || !task.requester) {
      return;
    }

    let rescued = message.msg.match(/(.*?) has rescued (.*?) from the C. H. U. M.s./);

    if (rescued != null) {
      if (rescued[2].toLowerCase() != this._client.getMe()?.name) {
        return;
      }

      if (this._cageTask) {
        console.log(`${rescued[1]} rescued me from the C. H. U. M.s cage, that was nice of them.`);

        // No API responses for this, a script likely would leave the cagebot in.
        this._client.useChatMacro(
          `/w ${rescued[1].replaceAll(
            " ",
            "_"
          )} Thank you for rescuing me! You didn't have to though!`
        );
      }

      return;
    }

    if (
      message.msg.toLowerCase() !==
      `${task.requester.name.toLowerCase()} has made it through the sewer.`
    ) {
      return;
    }

    if (!task.autoRelease) {
      console.log(`${task.requester.name} (#${task.requester.id}) has made it through the sewers.`);

      setTimeout(() => {
        // If not the same cage task, aka they were released. Return
        if (this._cageTask != task) {
          return;
        }

        console.log(
          `A minute has passed, asking ${task.requester.name} (#${task.requester.id}) if they'd like me to escape.`
        );

        if (task.apiResponses) {
          this.getClient().sendPrivateMessage(
            task.requester,
            createApiResponse("Notification", "remember_to_unbait")
          );
        } else {
          this._client.sendPrivateMessage(
            task.requester,
            `You've made it through the sewers! If cagebait is no longer required, whisper me "escape".`
          );
        }
      }, 60000);

      return;
    }

    console.log(
      `${task.requester.name} (#${task.requester.id}) has made it through the sewers. Requesting escape as per whiteboard.`
    );

    // Requester made it through the sewers. Add to private messages.
    const fakeMessage: ChatMessage = {
      private: true,
      who: task.requester,
      msg: `escape${task.apiResponses ? ".api" : ""}`,
      apiRequest: task.apiResponses,
      reply: async (message: string) =>
        await this.getClient().sendPrivateMessage(task.requester, message),
    };

    await this.runBlockingRequest(fakeMessage, () => this._uncageHandler.escapeCage(fakeMessage));
  }

  async processMessage(): Promise<void> {
    const message = this._privateMessages.shift();

    if (message) {
      if (!message.private) {
        await this.processHobopolisMessage(message);
      } else {
        console.log(
          `Processing whisper${message.apiRequest ? ".api" : ""} from ${message.who.name} (#${
            message.who.id
          })`
        );
        const processedMsg = message.msg.toLowerCase();

        if (processedMsg.startsWith("cage")) {
          await this.runBlockingRequest(message, () => this._cageHandler.becomeCaged(message));
        } else if (processedMsg.startsWith("release")) {
          await this.runBlockingRequest(message, () => this._uncageHandler.releaseCage(message));
        } else if (processedMsg.startsWith("escape")) {
          await this.runBlockingRequest(message, () => this._uncageHandler.escapeCage(message));
        } else if (processedMsg.startsWith("status")) {
          await this.sendStatus(message, true);
        } else if (processedMsg.startsWith("diet")) {
          await this._diet.sendDiet(message);
        } else if (processedMsg.startsWith("help")) {
          await this.sendHelp(message);
        } else {
          await this.didntUnderstand(message);
        }
      }

      this.processMessage();
    } else {
      setTimeout(() => this.processMessage(), 1000);
    }
  }

  async safelyTestForThirdPartyUncaging() {
    // If 15min has elapsed from last caged check
    if (
      this._amCaged &&
      !mutex.isLocked() &&
      !this.isBusy() &&
      this._lastCheckForThirdPartyUncaging + 15 * 60 < Date.now()
    ) {
      await mutex.runExclusive(async () => {
        await this.testForThirdPartyUncaging();
      });
    }
  }

  async sendHelp(message: ChatMessage): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) requested help.`);

    await message.reply(
      `Hi! I am ${this._client.getMe()?.name} (#${
        this._client.getMe()?.id
      }), and I am running Phillammon's Cagebot script.`
    );

    await message.reply(`My commands:`);
    await message.reply(`- status: Get my current status`);
    await message.reply(
      `- cage [clanname]: Try to get caged in the specified clan's hobopolis instance`
    );
    await message.reply(
      `- escape: If you're the person who requested I got caged, chews out of the cage I'm in`
    );
    await message.reply(
      `- release: Chew out of the cage, REGARDLESS of who is responsible for the caging. Only usable if I've been caged for an hour or something's gone wrong.`
    );
    await message.reply(`- help: Displays this message.`);
  }

  async sendStatus(message: ChatMessage, directlyRequested: boolean = false): Promise<void> {
    if (directlyRequested) {
      console.log(`${message.who.name} (#${message.who.id}) requested status report.`);
    }

    await this.safelyTestForThirdPartyUncaging();

    if (message.apiRequest) {
      await this.statusReportByApi(message);
    } else {
      await this.statusReportByNonApi(message);
    }
  }

  private async statusReportByNonApi(message: ChatMessage) {
    const status = await this._client.getStatus();

    if (this._amCaged) {
      if (this._cageTask) {
        const cageSecs = this.secondsInTask();

        await message.reply(
          `I have been caged in ${this._cageTask.clan.name} for ${humanReadableTime(
            cageSecs
          )}, at the request of ${this._cageTask.requester.name} (#${this._cageTask.requester.id}).`
        );

        if (this.releaseable()) {
          await message.reply(
            `As I've been caged for at least an hour, anyone can release me by whispering "release" to me. I have ${status.adventures} adventures left.`
          );
        } else {
          await message.reply(
            `They can release me at any time by whispering "escape" to me, or anyone can release me by whispering "release" to me in ${humanReadableTime(
              3600 - cageSecs
            )}. I have ${status.adventures} adventures left.`
          );
        }
      } else {
        await message.reply(
          `I am caged, but I don't know where, when, or for how long. Anyone can release me by whispering "release" to me. I have ${status.adventures} adventures left.`
        );
      }
    } else {
      await message.reply(
        `I am not presently caged and have ${status.adventures} adventures left.`
      );
    }
    //always send info on how full the bot is.
    //todo: assumes max valves. Should check for actual
    await message.reply(
      `My current fullness is ${status.full}/15 and drunkeness is ${status.drunk}/${
        this._diet.getMaxDrunk() || "???"
      }.`
    );
  }

  private async statusReportByApi(message: ChatMessage) {
    const status = await this.getClient().getStatus();
    let busyStatus: BusyResponse | undefined;

    if (this._amCaged || this._cageTask) {
      busyStatus = {
        state: !this._amCaged
          ? "Diving"
          : this.releaseable() || !this._cageTask || this._cageTask.requester.id === message.who.id
          ? "Releasable"
          : "Caged",
      };

      if (this._cageTask) {
        busyStatus.elapsed = this.secondsInTask();
        busyStatus.player = parseInt(this._cageTask.requester.id);
        busyStatus.clan = parseInt(this._cageTask.clan.id);
      }
    }

    // The status is ideally one that you can strip all spaces from, and remain parsable
    const apiStatus: StatusResponse = {
      type: "status",
      advs: status.adventures,
      full: status.full,
      maxFull: 15,
      drunk: status.drunk,
      maxDrunk: this._diet.getMaxDrunk(),
      caged: this._amCaged,
      status: busyStatus,
    };

    await message.reply(toJson(apiStatus));
  }

  async didntUnderstand(message: ChatMessage): Promise<void> {
    console.log(`${message.who.name} (#${message.who.id}) made an incomprehensible request.`);

    await message.reply(
      `I'm afraid I didn't understand that. Whisper me "help" for details of how to use me.`
    );
  }

  secondsInTask(): number {
    if (!this._cageTask) {
      throw "Tried to find time in cage with no cagestatus.";
    }

    return Math.floor((Date.now() - this._cageTask.started) / 1000);
  }

  releaseable(): boolean {
    return this.secondsInTask() > 3600;
  }

  async chewOut(skipWhiteboard?: boolean): Promise<void> {
    await this.testForThirdPartyUncaging();

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
    this._cageTask = undefined;

    if (!skipWhiteboard) {
      await updateWhiteboard(this, this._amCaged);
    }
  }
}

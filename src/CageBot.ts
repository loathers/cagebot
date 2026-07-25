import { Mutex } from "async-mutex";
import { Client } from "kol.js";
import type { ChatMessage as KolChatMessage } from "kol.js/domains/ChatMailbox";
import { decode } from "html-entities";
import { DietHandler } from "./handlers/DietHandler.js";
import { CagingHandler } from "./handlers/CagingHandler.js";
import { UncageHandler } from "./handlers/UncageHandler.js";
import { Clan } from "kol.js/domains/Clan";
import { HobopolisDungeon } from "kol.js/domains/Hobopolis";
import { BusyResponse, RequestResponse, StatusResponse } from "./utils/JsonResponses.js";
import {
  ChatMessage,
  CageTask,
  Settings,
  KoLUser,
  KoLClan,
  LastClanRequest as CageCooldown,
  KoLSkill,
} from "./utils/Typings.js";
import {
  humanReadableTime,
  updateWhiteboard,
  sendApiResponse,
  saveSettings,
  loadSettings,
  toJson,
  createApiResponse,
  getMinusCombatSkills,
  sendPrivateMessage,
  useChatMacro,
} from "./utils/Utils.js";
import { readFileSync } from "fs";

const mutex = new Mutex();

export class CageBot {
  private _privateMessages: ChatMessage[] = [];
  private _client: Client;
  private _clan: Clan;
  private _hobopolis: HobopolisDungeon;
  private _amCaged: boolean = false;
  private _cageTask?: CageTask;
  private _settings: Settings;
  private _lastCheckForThirdPartyUncaging: number = Date.now();
  private _diet: DietHandler;
  private _cageHandler: CagingHandler;
  private _uncageHandler: UncageHandler;
  private _recentCages: CageCooldown[] = [];
  private _knownSkills: KoLSkill[] = [];

  constructor(username: string, password: string, settings: Settings) {
    this._client = new Client(username, password);
    this._clan = new Clan(this._client);
    this._hobopolis = new HobopolisDungeon(this._client);
    this._settings = settings;

    this._diet = new DietHandler(this);
    this._cageHandler = new CagingHandler(this);
    this._uncageHandler = new UncageHandler(this);
  }

  getKnownSkills() {
    return this._knownSkills;
  }

  getPendingWhisperCount(): number {
    return this._privateMessages.length;
  }

  addClanCooldown(user: KoLUser, clan: KoLClan) {
    this._recentCages.push({
      user: user,
      clan: clan,
      date: Date.now(),
      expiresAfter: (this._settings.delayBetweenClanRepeats || 3600) * 1000,
    });
  }

  getClanCooldown(clan: KoLClan): CageCooldown | undefined {
    // While array has entries, and while entry has expired.
    while (
      this._recentCages.length > 0 &&
      this._recentCages[0].date + this._recentCages[0].expiresAfter < Date.now()
    ) {
      // Remove the first element
      this._recentCages.shift();
    }

    return this._recentCages.find((c) => c.clan.id === clan.id);
  }

  getClient(): Client {
    return this._client;
  }

  getClan(): Clan {
    return this._clan;
  }

  getHobopolis(): HobopolisDungeon {
    return this._hobopolis;
  }

  getMe(): KoLUser | undefined {
    if (!this._client.playerId) {
      return undefined;
    }

    return { id: parseInt(this._client.playerId), name: this._client.username };
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

    const status = await this._client.fetchStatus();

    saveSettings(
      status.turnsplayed,
      this.getDietHandler().getMaxDrunk() || 14,
      this._knownSkills,
      this.getCageTask()
    );
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

    const status = await this._client.fetchStatus();

    // If this was saved at turn X, but the current turn has differed
    if (settings.validAtTurn != status.turnsplayed) {
      console.log("Runstate differs from expected, not loading.");
      return;
    }

    this.getDietHandler().setMaxDrunk(settings.maxDrunk);
    this._cageTask = settings.cageTask;
    this._knownSkills = getMinusCombatSkills().filter((skill) =>
      settings.knownSkills.includes(skill.skillId)
    );

    console.log("Loaded previous state from saved file");
  }

  async start(): Promise<void> {
    console.log("Starting Cagebot...");
    console.log(`We're trying to maintain ${this._settings.maintainAdventures} adventures`);

    while (!(await this._client.login())) {
      if (this._client.isRollover()) {
        console.log("Rollover is in progress, waiting for it to end.");
        await this._client.waitForRolloverEnd();
      } else {
        console.log("Login failed, retrying in 60 seconds.");
        await new Promise((resolve) => setTimeout(resolve, 60_000));
      }
    }

    await this._client.loadGameData();
    await this.performLoginTasks();
  }

  async performLoginTasks(): Promise<void> {
    await this.doInitialSetup();

    const secondsToRollover = await this._client.secondsToRollover();

    console.log(`The next rollover is in ${humanReadableTime(secondsToRollover)}`);

    if (this._knownSkills.length > 0) {
      console.log(
        `We know the skill${this._knownSkills.length != 1 ? "s" : ""}: ${this._knownSkills
          .map((s) => `'${s.name}'`)
          .join(", ")} and will attempt to maintain them.`
      );
    }

    console.log("Initial setup complete. Polling messages.");

    this._client.on("whisper", (message) => this.enqueueChatMessage(message, true));
    this._client.on("public", (message) => this.enqueueChatMessage(message, false));

    // Fired when the first request after a rollover has ended goes through
    this._client.on("rollover", async () => {
      await this.testForThirdPartyUncaging();

      if (!this.isCaged()) {
        await this._diet.maintainAdventures();
      }
    });

    let checkingChat = false;

    setInterval(async () => {
      if (checkingChat || this._client.isRollover()) {
        return;
      }

      checkingChat = true;

      try {
        await this._client.chat.check();
      } catch (error) {
        console.log(`Failed to poll chat: ${error}`);
      } finally {
        checkingChat = false;
      }
    }, 3000);

    this.processMessage();
  }

  private enqueueChatMessage(message: KolChatMessage, isPrivate: boolean) {
    const who: KoLUser = { id: message.who.id, name: message.who.name };
    const chatMessage: ChatMessage = {
      private: isPrivate,
      who: who,
      msg: message.msg,
      apiRequest: message.msg.includes(".api"),
      reply: async (text: string) => {
        if (isPrivate) {
          await sendPrivateMessage(this._client, who, text);
        } else {
          await useChatMacro(this._client, `/w Hobopolis ${text}`);
        }
      },
    };

    if (isPrivate) {
      if (chatMessage.apiRequest) {
        void chatMessage.reply(toJson({ type: "notify", status: "Seen" } as RequestResponse));
      } else {
        void chatMessage.reply("Message acknowledged.");
      }
    }

    this._privateMessages.push(chatMessage);
  }

  async testForThirdPartyUncaging(): Promise<void> {
    this._lastCheckForThirdPartyUncaging = Date.now();

    this._amCaged = await this._hobopolis.isCaged();

    if (!this._amCaged) {
      this._cageTask = undefined;
      await updateWhiteboard(this, this._amCaged);
    }
  }

  async doInitialSetup(): Promise<void> {
    await this.doSetup();
    await useChatMacro(this._client, "/listenon Hobopolis");

    if (this.isCaged()) {
      console.log("We appear to be caged.");
      await this.loadSettings();
      return;
    }

    // Ensure the "Area might be too tough for you" warning is disabled
    await this._client.account.setFlag("ignorezonewarnings", 1);

    let macro = (await this._client.combatMacros.list()).find((m) => m.name === "CAGEBOT");
    const macroText = readFileSync("./data/CombatMacro.txt", "utf-8");

    if (!macro) {
      console.log("Combat Macro not found, we will be saving the default!");

      const saved = await this._client.combatMacros.save("CAGEBOT", macroText);

      if (!saved.success) {
        throw "Failed to create the CAGEBOT macro!";
      }

      macro = { id: saved.id, name: "CAGEBOT" };
    } else {
      const theirMacro = decode(await this._client.combatMacros.getText(macro.id));

      if (theirMacro !== macroText) {
        console.log("Custom CAGEBOT macro detected! This is probably fine.");
      }
    }

    const currentMacro = await this._client.account.getAutoattackMacro();

    if (!currentMacro || currentMacro.name !== "CAGEBOT") {
      if (!currentMacro) {
        console.log("AutoAttack macro is missing, changing that to CAGEBOT");
      } else {
        console.log(
          "AutoAttack Macro is not CAGEBOT, will leave untouched but this may be an error."
        );
      }
    }

    const autoattackMacro = (await this._client.account.getAutoattackMacros()).find(
      (m) => m.name === "CAGEBOT"
    );

    if (!autoattackMacro) {
      throw "Failed to find the CAGEBOT macro in the autoattack options!";
    }

    await this._client.account.setFlag("aabosses", 1);
    await this._client.account.setAutoattack(autoattackMacro.id);
  }

  async doSetup(): Promise<void> {
    await this.testForThirdPartyUncaging();

    await this.getDietHandler().doSetup();

    if (!this.isCaged()) {
      const skills = await this._client.charSheet.getSkills();
      const knownSkillIds = [...skills.keys()].map((skill) => skill.id);

      this._knownSkills = getMinusCombatSkills().filter((skill) =>
        knownSkillIds.includes(skill.skillId)
      );

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
      try {
        await toCall();
      } catch (error) {
        console.log(`Error while processing request: ${error}`);
      }
    });
  }

  async processHobopolisMessage(message: ChatMessage): Promise<void> {
    // If not a clan dungeon announcement
    if (!message.who || message.who.id !== -2) {
      return;
    }

    const task = this._cageTask;

    if (!this._amCaged || !task || !task.requester) {
      return;
    }

    let rescued = message.msg.match(/(.*?) has rescued (.*?) from the C. H. U. M.s./);

    if (rescued != null) {
      if (rescued[2].toLowerCase() != this._client.username.toLowerCase()) {
        return;
      }

      if (this._cageTask) {
        console.log(`${rescued[1]} rescued me from the C. H. U. M.s cage, that was nice of them.`);

        // No API responses for this, a script likely would leave the cagebot in.
        useChatMacro(
          this._client,
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
          sendPrivateMessage(
            this._client,
            task.requester,
            createApiResponse("Notification", "remember_to_unbait")
          );
        } else {
          sendPrivateMessage(
            this._client,
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
        await sendPrivateMessage(this._client, task.requester, message),
    };

    await this.runBlockingRequest(fakeMessage, () => this._uncageHandler.escapeCage(fakeMessage));
  }

  async processMessage(): Promise<void> {
    const message = this._privateMessages.shift();

    if (message) {
      try {
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
      } catch (error) {
        console.log(`Error while processing message: ${error}`);
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
      `Hi! I am ${this.getMe()?.name} (#${
        this.getMe()?.id
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
    const status = await this._client.fetchStatus();

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
      if (this._cageTask) {
        await message.reply(
          `I am currently processing a cage request and have ${status.adventures} adventures left.`
        );
      } else {
        await message.reply(
          `I am not presently caged and have ${status.adventures} adventures left.`
        );
      }
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
    const status = await this._client.fetchStatus();
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
        busyStatus.player = this._cageTask.requester.id;
        busyStatus.clan = this._cageTask.clan.id;
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

    const encounter = await this._hobopolis.exploreSewer();

    if (encounter.type === "cage") {
      const { stillInChoice } = await this._hobopolis.chewThroughCage(encounter.whichchoice);

      if (!this._amCaged && stillInChoice) {
        console.log(`Unexpectedly still in a choice after chewing through cage.`);
        return;
      }
    } else if (encounter.type === "gnawedCage") {
      await this._hobopolis.squeezeOut();
    }

    this._amCaged = false;
    this._cageTask = undefined;

    if (!skipWhiteboard) {
      await updateWhiteboard(this, this._amCaged);
    }
  }
}

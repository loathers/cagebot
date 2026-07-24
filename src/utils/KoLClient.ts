import axios, { AxiosInstance } from "axios";
import {
  KoLUser,
  KoLStatus,
  ChatMessage as ChatMessage,
  KOLMessage,
  KoLClan,
  MallResult,
  ClanWhiteboard,
  CombatMacro,
  KoLEffect,
  LoginResult,
  OrganSize,
} from "./Typings";
import { RequestResponse } from "./JsonResponses";
import { decode } from "html-entities";
import { splitMessage, toJson } from "./Utils";
import { HttpCookieAgent, HttpsCookieAgent } from "http-cookie-agent/http";
import { CookieJar } from "tough-cookie";

const FOR_WHO = "Cagesitter (Maintained by Irrat @ https://github.com/loathers/cagebot)";

export class KoLClient {
  private _loginParameters;
  private _lastFetchedMessages: string = "0";
  private _player?: KoLUser;
  private _axios: AxiosInstance;
  private _pwd: string | undefined;

  constructor(username: string, password: string) {
    this._loginParameters = new URLSearchParams();
    this._loginParameters.append("loggingin", "Yup.");
    this._loginParameters.append("loginname", username);
    this._loginParameters.append("password", password);
    this._loginParameters.append("secure", "0");
    this._loginParameters.append("submitbutton", "Log In");

    const jar = new CookieJar();

    this._axios = axios.create({
      timeout: 30000,
      headers: { "User-Agent": FOR_WHO },
      baseURL: "https://www.kingdomofloathing.com/",
      httpAgent: new HttpCookieAgent({ cookies: { jar } }),
      httpsAgent: new HttpsCookieAgent({ cookies: { jar } }),
    });
  }

  getUsername() {
    return this._player?.name;
  }

  getUserID() {
    return this._player?.id;
  }

  async getSkills(): Promise<number[]> {
    const response = (await this.visitUrl("charsheet.php")) as string;

    if (!response) {
      return [];
    }

    const matches = response.matchAll(/"desc_skill\.php\?whichskill=(\d+)&self=true"/g);
    const skills: number[] = [];

    for (const [, skillId] of matches) {
      skills.push(parseInt(skillId));
    }

    return skills;
  }

  setLoggedOut() {
    this._pwd = undefined;
  }

  isLoggedIn(): boolean {
    return this._pwd !== undefined;
  }

  async loginWithBackoff() {
    let loginAttempts = 0;

    while (true) {
      loginAttempts++;
      const result = await this.logIn();

      if (result == "Success") {
        console.log("Logged in.");
        return;
      }

      let minutesToWait = 1;
      let message: string;

      switch (result) {
        case "Bad Login":
          // Could be wrong pass, could be immediately logged out, who knows.
          // But we should back off exponentially.
          minutesToWait = loginAttempts ^ 2;
          message = `Bad login, will sleep ${minutesToWait} before trying again.`;
          break;
        case "Error":
        case "Unknown":
          // We should be backing off if we're encountering unknown errors
          minutesToWait = loginAttempts;
          message = `Unknown error, will sleep ${minutesToWait} before trying again.`;
          break;
        case "Maint":
          minutesToWait = 1;
          message = `Rollover in progress, will sleep ${minutesToWait} before trying again.`;
          break;
        default:
          minutesToWait = 10;
          message = `Unknown issue, will sleep ${minutesToWait} before trying again.`;
          break;
      }

      await new Promise((res) => setTimeout(res, minutesToWait * 60_000));
    }
  }

  async logIn(): Promise<LoginResult> {
    this._pwd = undefined;

    console.log(`Not logged in. Logging in as ${this._loginParameters.get("loginname")}`);

    try {
      const loginResponse = await this._axios("login.php", {
        method: "POST",
        data: this._loginParameters,
      });

      const location = loginResponse.headers.location || "";

      if (location.includes("maint.php")) {
        return "Maint";
      }

      if (location.includes("login.php")) {
        return "Bad Login";
      }

      const status = await this.getStatus();

      if (!status.pwd) {
        return "Unknown";
      }

      return "Success";
    } catch (e) {
      console.error(e);
      return "Error";
    }
  }

  async visitUrl(
    url: string,
    parameters: Record<string, any> = {},
    pwd: boolean = true,
    data?: any,
  ): Promise<any> {
    try {
      const page = await this._axios(url, {
        method: "POST",
        params: {
          ...(pwd && this._pwd ? { pwd: this._pwd } : {}),
          ...parameters,
        },
        data: data,
      });

      return page.data;
    } catch {
      return null;
    }
  }

  async useChatMacro(macro: string): Promise<void> {
    await this.visitUrl("submitnewchat.php", {
      graf: `/clan ${macro}`,
      j: 1,
    });
  }

  async sendPrivateMessage(recipient: KoLUser, message: string): Promise<void> {
    for (let msg of splitMessage(message)) {
      await this.useChatMacro(`/w ${recipient.id} ${msg}`);
    }
  }

  async eat(foodID: number): Promise<void> {
    await this.visitUrl("inv_eat.php", {
      which: 1,
      whichitem: foodID,
    });
  }

  async drink(drinkID: number): Promise<any> {
    return await this.visitUrl("inv_booze.php", {
      which: 1,
      whichitem: drinkID,
    });
  }

  async equip(itemId: number): Promise<void> {
    await this.visitUrl(
      `inv_equip.php?pwd=${this._pwd}&which=2&action=equip&whichitem=${itemId}&ajax=1`,
    );
  }

  async castSkill(skill: number, amount: number = 1) {
    await this.visitUrl(
      `runskillz.php?action=Skillz&whichskill=${skill}&targetplayer=${this._player?.id}&pwd=${this._pwd}&quantity=${amount}&ajax=1`,
    );
  }

  async getStatus(): Promise<KoLStatus> {
    const apiResponse = await this.visitUrl("api.php", {
      what: "status",
      for: FOR_WHO,
    });

    if (!apiResponse || !apiResponse["equipment"]) {
      return {
        level: 1,
        adventures: 10,
        meat: 0,
        drunk: 15,
        full: 14,
        hp: 1,
        mp: 1,
        maxHP: 1,
        maxMP: 1,
        equipment: new Map(),
        rollover: Date.now(),
        turnsPlayed: 0,
        effects: [],
        pwd: undefined,
        flag_config: {
          fullnesscounter: "0",
        },
      };
    }

    this._player = {
      id: apiResponse["playerid"],
      name: apiResponse["name"],
    };

    this._pwd = apiResponse["pwd"];

    const equipment = new Map();
    const equips = apiResponse["equipment"];
    const effects: KoLEffect[] = [];

    for (let [key, value] of Object.entries(equips)) {
      if (typeof value != "string" || !/^\d+$/.test(key) || !/^\d+$/.test(value)) continue;

      equipment.set(key, parseInt(value));
    }

    if (apiResponse["effects"]) {
      for (const apiEffect of Object.values(apiResponse["effects"]) as string[][]) {
        // description-UUID[Name, Duration, Shorthand ID, source, Effect ID]
        const effect: KoLEffect = {
          name: apiEffect[0],
          duration: parseInt(apiEffect[1]),
          id: parseInt(apiEffect[4]),
        };

        if (effect.duration <= 0) {
          continue;
        }

        effects.push(effect);
      }
    }

    return {
      level: parseInt(apiResponse["level"]) || 1,
      adventures: parseInt(apiResponse["adventures"]) || 10,
      meat: parseInt(apiResponse["meat"]) || 0,
      drunk: parseInt(apiResponse["drunk"]) || 0,
      full: parseInt(apiResponse["full"]) || 0,
      hp: parseInt(apiResponse["hp"]) || 0,
      mp: parseInt(apiResponse["mp"]) || 0,
      maxHP: parseInt(apiResponse["maxhp"]) || 0,
      maxMP: parseInt(apiResponse["maxmp"]) || 0,
      familiar: apiResponse["familiar"] ? parseInt(apiResponse["familiar"]) : undefined,
      equipment: equipment,
      rollover: parseInt(apiResponse["rollover"]),
      turnsPlayed: parseInt(apiResponse["turnsplayed"]) || 0,
      effects: effects,
      pwd: apiResponse["pwd"],
      flag_config: {
        fullnesscounter: apiResponse["flag_config"]["fullnesscounter"] || "0",
      },
    };
  }

  async parseCharpaneForOrganCapacity(status: KoLStatus): Promise<OrganSize | undefined> {
    // Only attempt when both would display
    if (status.drunk <= 0 || status.full <= 0) {
      return undefined;
    }

    // If fullness counter isn't turned on as per status, enable it
    if (status.flag_config.fullnesscounter !== "1") {
      await this.visitUrl(`account.php`, {
        am: 1,
        action: "flag_fullnesscounter",
        value: 1,
        ajax: 1,
      });
    }

    const charpane = (await this.visitUrl(`charpane.php`)) as string;

    if (!charpane) {
      return undefined;
    }

    const organsMatch = charpane.match(
      />(?:(\d+)\s*\/\s*(\d+))<.*?(?:>(\d+)\s*\/\s*(\d+)<)(?=.*hp\.gif)/,
    );

    if (!organsMatch || organsMatch.length != 5) {
      console.log(`Unable to parse organ capacity, has there been some backend changes?`);
      return undefined;
    }

    const currentFull = parseInt(organsMatch[1]);
    const fullLimit = parseInt(organsMatch[2]);
    const currentDrunk = parseInt(organsMatch[3]);
    const drunkLimit = parseInt(organsMatch[4]);

    // Attempt to validate it against the status

    if (status.full != currentFull || status.drunk != currentDrunk) {
      console.log(`Unable to parse organ capacity, has there been some backend changes?`);
      return undefined;
    }

    return {
      stomach: fullLimit,
      liver: drunkLimit,
    };
  }

  async fetchNewWhispers(): Promise<ChatMessage[]> {
    const newChatMessagesResponse = await this.visitUrl("newchatmessages.php", {
      j: 1,
      lasttime: this._lastFetchedMessages,
    });

    if (!newChatMessagesResponse) return [];

    this._lastFetchedMessages = newChatMessagesResponse["last"];

    const newWhispers: ChatMessage[] = newChatMessagesResponse["msgs"]
      .filter(
        (msg: KOLMessage) =>
          msg["type"] === "private" || (msg["type"] === "public" && msg["channel"] === "hobopolis"),
      )
      .map(
        (msg: KOLMessage) =>
          ({
            private: msg.type === "private",
            who: msg.who,
            msg: msg.msg,
            apiRequest: msg.msg?.includes(".api"),
            reply: async (message: string) => {
              if (!msg.who) {
                return;
              }

              if (msg.type === "private") {
                await this.sendPrivateMessage(msg.who, message);
              } else {
                for (let msg of splitMessage(message)) {
                  await this.useChatMacro(`/w Hobopolis ${msg}`);
                }
              }
            },
          }) as ChatMessage,
      );

    newWhispers.forEach((message) => {
      if (!message.private) {
        return;
      }

      if (message.apiRequest) {
        message.reply(toJson({ type: "notify", status: "Seen" } as RequestResponse));
      } else {
        message.reply("Message acknowledged.");
      }
    });

    return newWhispers;
  }

  async getClanLeader(clanId: string): Promise<string | undefined> {
    const page = await this.visitUrl("showclan.php", { whichclan: clanId });

    if (!page) {
      return;
    }

    const match = page.match(
      />Leader:<\/td><td valign=top><b><a href="showplayer\.php\?who=(\d+)">/,
    );

    if (!match) {
      return;
    }

    return match[1];
  }

  async getInactiveMember(): Promise<string | undefined> {
    const members = (await this.visitUrl("clan_members.php")) as string;

    if (!members) {
      return;
    }

    const match = members.match(
      /href="showplayer\.php\?who=(\d+)">[^<]+?<\/a><font color=gray><b> \(inactive\)<\/b>/,
    );

    if (!match) {
      return;
    }

    return match[1];
  }

  async transferClanLeadership(newLeader: string): Promise<boolean> {
    const response = (await this.visitUrl("clan_admin.php", {
      action: "changeleader",
      newleader: newLeader,
      confirm: "on",
    })) as string;

    return /Leadership of clan transferred. A leader is no longer you./.test(response);
  }

  async getWhitelists(): Promise<KoLClan[]> {
    const clanRecuiterResponse = await this.visitUrl(`clan_signup.php?place=managewhitelists`);

    if (!clanRecuiterResponse) {
      return [];
    }

    const clans: KoLClan[] = [];

    for (const [, clanId, clanName] of clanRecuiterResponse.matchAll(
      /<a href=showclan\.php\?whichclan=(\d+) class=nounder><b>([^>]*?)<\/b>(?=.*>Apply to a Clan<\/b><\/td><\/tr>)/gm,
    )) {
      clans.push({
        id: clanId,
        name: clanName,
      });
    }

    return clans;
  }

  async myClan(): Promise<string> {
    const myClanResponse = await this.visitUrl("showplayer.php", {
      who: this._player?.id ?? 0,
    });

    return ((myClanResponse as string).match(
      /\<b\>\<a class=nounder href=\"showclan\.php\?whichclan=(\d+)/,
    ) ?? ["", ""])[1];
  }

  async joinClan(clan: KoLClan): Promise<void> {
    await this.visitUrl("showclan.php", {
      whichclan: clan.id,
      action: "joinclan",
      confirm: "on",
      recruiter: 1,
    });
  }

  getMe(): KoLUser | undefined {
    return this._player;
  }

  async getInventory(): Promise<Map<number, number>> {
    const apiResponse = await this.visitUrl("api.php", {
      what: "inventory",
      for: FOR_WHO,
    });

    const map: Map<number, number> = new Map();

    if (!apiResponse) {
      return map;
    }

    for (let [key, value] of Object.entries(apiResponse)) {
      if (typeof value != "string" || !/^\d+$/.test(key) || !/^\d+$/.test(value)) continue;

      map.set(parseInt(key), parseInt(value));
    }

    return map;
  }

  async getCombatMacros(): Promise<CombatMacro[]> {
    const apiResponse = (await this.visitUrl("account_combatmacros.php")) as string;

    if (!apiResponse) {
      return [];
    }

    const macros: CombatMacro[] = [];

    const match = apiResponse.matchAll(/<option value="(\d+)">(.*?)<\/option>/g);

    for (let [, id, name] of match) {
      macros.push({ id: id, name: name });
    }

    return macros;
  }

  async getCombatMacro(macro: CombatMacro): Promise<string> {
    const apiResponse = await this.visitUrl(
      "account_combatmacros.php",
      {},
      false,
      `macroid=${macro.id}&action=edit&what=Edit`,
    );

    if (!apiResponse) {
      return "";
    }

    return decode(apiResponse.match(/">([^>]*?)<\/textarea>/s)[1]);
  }

  async createCombatMacro(name: string, macro: string): Promise<void> {
    await this.visitUrl("account_combatmacros.php", {
      macroid: "0",
      name: name,
      macrotext: macro,
      action: "save",
    });
  }

  async setAutoAttackMacro(macro?: CombatMacro): Promise<void> {
    await this.visitUrl("account.php", {
      am: "1",
      action: "autoattack",
      value: macro ? macro?.id : "0",
    });
  }

  async getAutoAttackMacro(): Promise<CombatMacro | undefined> {
    const apiResponse = await this.visitUrl(
      `account.php?action=loadtab&value=combat&pwd=${this._pwd}`,
    );

    if (!apiResponse) {
      return undefined;
    }

    // Will only match on a combat macro, not a skill
    const match = apiResponse.match(
      /<option selected="selected" value="(\d+)">([^<]*?) \(Combat Macro\)<\/option>/,
    );

    if (!match) {
      return undefined;
    }

    return {
      id: match[1],
      name: match[2],
    };
  }

  async searchMall(itemName: string): Promise<MallResult[]> {
    const apiResponse = (await this.visitUrl(
      `mall.php?justitems=0&pudnuggler="${encodeURI(itemName)}"`,
    )) as string;

    const matches = apiResponse.matchAll(
      /href="mallstore\.php\?whichstore=(\d+)&searchitem=(\d+)&searchprice=(\d+)"><b>.+?"small stock">([\d,]+)<\/td>.*?<td class="small">(?:(\d+)&nbsp;\/&nbsp;day&nbsp;&nbsp;&nbsp;<\/td>)?/g,
    );

    let results: MallResult[] = [];

    for (let result of matches) {
      const storeId = parseInt(result[1]);
      const itemId = parseInt(result[2]);
      const price = parseInt(result[3]);
      const stockLevel = parseInt(result[4].replaceAll(",", ""));
      const limit = result[5] ? undefined : parseInt(result[5].replaceAll(",", ""));

      results.push({
        storeId: storeId,
        itemId: itemId,
        price: price,
        stock: stockLevel,
        limit: limit,
      });
    }

    return results;
  }

  async buyMall(mallResult: MallResult, amount: number): Promise<void> {
    let itemId = mallResult.price.toString();

    // Pad with zeros
    while (itemId.length < 9) {
      itemId = `0${itemId}`;
    }

    itemId = mallResult.itemId + itemId;

    await this.visitUrl(
      `mallstore.php?buying=1&quantity=${amount}&whichitem=${itemId}&ajax=1&pwd=${this._pwd}&whichstore=${mallResult.storeId}`,
    );
  }

  async buyFromNPC(shopName: string, row: number, amount: number): Promise<void> {
    await this.visitUrl(
      `shop.php?whichshop=${shopName}&action=buyitem&quantity=${amount}&whichrow=${row}&pwd=${this._pwd}`,
    );
  }

  async multiUse(item: number, amount: number): Promise<void> {
    await this.visitUrl(
      `multiuse.php?whichitem=${item}&action=useitem&ajax=1&quantity=${amount}&pwd=${this._pwd}`,
    );
  }

  async buyFromHermit(item: number, amount: number): Promise<void> {
    await this.visitUrl("hermit.php", {
      action: "trade",
      whichitem: item,
      quantity: amount,
    });
  }

  async setClanWhiteboard(text: string): Promise<void> {
    await this.visitUrl("clan_basement.php", {
      action: "whitewrite",
      whiteboard: text,
    });
  }

  /**
   * This will return undefined if we can not write to a whiteboard.
   *
   * It will also return the text encoded in html entities, namely an issue for characters such as < or >
   */
  async getClanWhiteboard(): Promise<ClanWhiteboard> {
    const response: string = await this.visitUrl("clan_basement.php?whiteboard=1");

    let editable = true;
    let match = response.match(
      /<textarea maxlength=5000 name=whiteboard rows=15 cols=60>(.*?)<\/textarea><br>/s,
    );
    let text: string = "";

    if (match) {
      text = match[1];
    } else {
      editable = false;
      match = response.match(/border: 1px solid black;'>(.*?)<\/td>/);

      if (match) {
        text = match[1]
          .replaceAll("\n", "")
          .replaceAll("<br>", "\n")
          .replace("<i>(nothing)</i>", ""); // What the whiteboard is when its empty;
      }
    }

    return {
      editable: editable,
      text: decode(text.replaceAll("\r", "")),
    };
  }
}

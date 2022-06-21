import axios from "axios";
import { select } from "xpath";
import { DOMParser as dom } from "xmldom";
import { Agent as httpsAgent } from "https";
import { Agent as httpAgent } from "http";

axios.defaults.timeout = 30000;
axios.defaults.httpAgent = new httpAgent({ keepAlive: true });
axios.defaults.httpsAgent = new httpsAgent({ keepAlive: true });

const parser = new dom({
  errorHandler: {
    warning: () => {},
    error: () => {},
    fatalError: console.log,
  },
});

type KOLCredentials = {
  sessionCookies: string;
  pwdhash: string;
};

export type KoLUser = {
  name: string;
  id: string;
};

type KOLMessage = {
  who?: KoLUser;
  type?: string;
  msg?: string;
  link?: string;
  time: string;
};

export type PrivateMessage = {
  who: KoLUser;
  msg: string;
};

export type KoLClan = {
  name: string;
  id: string;
};

export type MallResult = {
  storeId: number;
  itemId: number;
  stock: number;
  limit?: number;
  price: number;
};

export type EquipSlot =
  | "hat"
  | "shirt"
  | "pants"
  | "weapon"
  | "offhand"
  | "acc1"
  | "acc2"
  | "acc3"
  | "fakehands"
  | "cardsleeve";

export type KoLStatus = {
  adventures: number;
  full: number;
  drunk: number;
  rollover: number;
  equipment: Map<EquipSlot, number>;
  familiar?: number;
  meat: number;
  level: number;
};

export class KoLClient {
  private _loginParameters;
  private _credentials?: KOLCredentials;
  private _lastFetchedMessages: string = "0";
  private _player?: KoLUser;
  private _isRollover: boolean = false;
  private _rolloverAt?: number;

  constructor(username: string, password: string) {
    this._loginParameters = new URLSearchParams();
    this._loginParameters.append("loggingin", "Yup.");
    this._loginParameters.append("loginname", username);
    this._loginParameters.append("password", password);
    this._loginParameters.append("secure", "0");
    this._loginParameters.append("submitbutton", "Log In");
  }

  async getSecondsToRollover(): Promise<number> {
    if (this._isRollover) {
      return 0;
    }

    const now = Math.floor(Date.now() / 1000);

    // If rollover has not been set, or it's claiming it's expired
    if (this._rolloverAt == undefined || this._rolloverAt <= now) {
      this._rolloverAt = undefined;

      await this.loggedIn();
    }

    if (this._rolloverAt === undefined) {
      return 0;
    }

    return this._rolloverAt - now;
  }

  async loggedIn(): Promise<boolean> {
    if (!this._credentials || this._isRollover) return false;

    try {
      const apiResponse = await axios("https://www.kingdomofloathing.com/api.php", {
        maxRedirects: 0,
        withCredentials: true,
        headers: {
          cookie: this._credentials?.sessionCookies || "",
        },
        params: {
          what: "status",
          for: "Cagesitter (Maintained by Phillammon)",
        },
        validateStatus: (status) => status === 302 || status === 200,
      });

      if (apiResponse.status === 200) {
        this._rolloverAt = parseInt(apiResponse.data["rollover"]);
        return true;
      }

      return false;
    } catch {
      console.log("Login check failed, returning false to be safe.");
      return false;
    }
  }

  async logIn(): Promise<boolean> {
    if (await this.loggedIn()) return true;

    this._credentials = undefined;

    try {
      this._isRollover = /The system is currently down for nightly maintenance/.test(
        (await axios("https://www.kingdomofloathing.com/")).data
      );

      if (this._isRollover) {
        console.log("Rollover appears to be in progress. Checking again in one minute.");
      }
    } catch {
      this._isRollover = true;
      console.log("Login failed.. Rollover? Checking again in one minute.");
    }

    if (this._isRollover) {
      setTimeout(() => this.logIn(), 60000);
      return false;
    }

    console.log(`Not logged in. Logging in as ${this._loginParameters.get("loginname")}`);
    try {
      const loginResponse = await axios("https://www.kingdomofloathing.com/login.php", {
        method: "POST",
        data: this._loginParameters,
        maxRedirects: 0,
        validateStatus: (status) => status === 302,
      });
      const sessionCookies = loginResponse.headers["set-cookie"]
        .map((cookie: string) => cookie.split(";")[0])
        .join("; ");
      const apiResponse = await axios("https://www.kingdomofloathing.com/api.php", {
        withCredentials: true,
        headers: {
          cookie: sessionCookies,
        },
        params: {
          what: "status",
          for: "Cagesitter (Maintained by Phillammon)",
        },
      });
      this._credentials = {
        sessionCookies: sessionCookies,
        pwdhash: apiResponse.data.pwd,
      };
      this._player = {
        id: apiResponse.data.playerid,
        name: apiResponse.data.name,
      };
      return true;
    } catch {
      console.log("Login failed..");
      return false;
    }
  }

  async visitUrl(
    url: string,
    parameters: Record<string, any> = {},
    pwd: Boolean = true
  ): Promise<any> {
    if (this._isRollover || (await this.getSecondsToRollover()) <= 1) {
      return null;
    }

    try {
      const page = await axios(`https://www.kingdomofloathing.com/${url}`, {
        method: "POST",
        withCredentials: true,
        headers: {
          cookie: this._credentials?.sessionCookies || "",
        },
        params: {
          ...(pwd ? { pwd: this._credentials?.pwdhash } : {}),
          ...parameters,
        },
      });

      if (page.headers["set-cookie"] && this._credentials != null) {
        const cookies: any = {};

        for (let [name, cookie] of this._credentials.sessionCookies
          .split("; ")
          .map((s) => s.split("="))) {
          if (!cookie) {
            continue;
          }

          cookies[name] = cookie;
        }

        const sessionCookies = page.headers["set-cookie"].map((cookie: string) =>
          cookie.split(";")[0].trim().split("=")
        );

        for (let [name, cookie] of sessionCookies) {
          cookies[name] = cookie;
        }

        this._credentials.sessionCookies = Object.entries(cookies)
          .map(([key, value]) => key + "=" + value)
          .join("; ");
      }

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
    await this.useChatMacro(`/w ${recipient.id} ${message}`);
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
      `inv_equip.php?pwd=${this._credentials?.pwdhash}&which=2&action=equip&whichitem=${itemId}&ajax=1`
    );
  }

  async getStatus(): Promise<KoLStatus> {
    const apiResponse = await this.visitUrl("api.php", {
      what: "status",
      for: "Cagesitter (Maintained by Phillammon)",
    });

    if (!apiResponse) {
      return {
        level: 1,
        adventures: 10,
        meat: 0,
        drunk: 19,
        full: 14,
        equipment: new Map(),
        rollover: Date.now(),
      };
    }

    const equipment = new Map();
    const equips = apiResponse["equipment"];

    for (let key of Object.keys(equips)) {
      equipment.set(key, parseInt(equips[key]));
    }

    return {
      level: parseInt(apiResponse["level"]) || 1,
      adventures: parseInt(apiResponse["adventures"]) || 10,
      meat: parseInt(apiResponse["meat"]) || 0,
      drunk: parseInt(apiResponse["drunk"]) || 0,
      full: parseInt(apiResponse["full"]) || 0,
      familiar: apiResponse["familiar"] ? parseInt(apiResponse["familiar"]) : undefined,
      equipment: equipment,
      rollover: parseInt(apiResponse["rollover"]),
    };
  }

  async fetchNewWhispers(): Promise<PrivateMessage[]> {
    if (this._isRollover || !(await this.logIn())) {
      return [];
    }

    const newChatMessagesResponse = await this.visitUrl("newchatmessages.php", {
      j: 1,
      lasttime: this._lastFetchedMessages,
    });

    if (!newChatMessagesResponse) return [];

    this._lastFetchedMessages = newChatMessagesResponse["last"];

    const newWhispers: PrivateMessage[] = newChatMessagesResponse["msgs"]
      .filter((msg: KOLMessage) => msg["type"] === "private")
      .map((msg: KOLMessage) => ({
        who: msg.who,
        msg: msg.msg,
      }));

    newWhispers.forEach((message) => {
      if (message.msg.endsWith(".api")) {
        this.sendPrivateMessage(message.who, '{"status":"seen"}');
      } else {
        this.sendPrivateMessage(message.who, "Message acknowledged.");
      }
    });

    return newWhispers;
  }

  async getWhitelists(): Promise<KoLClan[]> {
    const clanRecuiterResponse = await this.visitUrl("clan_signup.php");
    if (!clanRecuiterResponse) return [];
    const clanIds = select(
      '//select[@name="whichclan"]/option/@value',
      parser.parseFromString(clanRecuiterResponse, "text/xml")
    ).map((s) => (s.toString().match(/\d+/) ?? ["0"])[0]);
    const clanNames = select(
      '//select[@name="whichclan"]/option/text()',
      parser.parseFromString(clanRecuiterResponse, "text/xml")
    );
    return clanNames.map((element, index) => ({
      name: element.toString(),
      id: clanIds[index].toString(),
    }));
  }

  async myClan(): Promise<string> {
    const myClanResponse = await this.visitUrl("showplayer.php", {
      who: this._player?.id ?? 0,
    });
    return ((myClanResponse as string).match(
      /\<b\>\<a class=nounder href=\"showclan\.php\?whichclan=(\d+)/
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
      for: "Cagesitter (Maintained by Phillammon)",
    });

    const map: Map<number, number> = new Map();

    if (!apiResponse) {
      return map;
    }

    for (let key of Object.keys(apiResponse)) {
      map.set(parseInt(key), parseInt(apiResponse[key]));
    }

    return map;
  }

  async createMacro(name: string, macro: string): Promise<void> {
    await this.visitUrl("account_combatmacros.php", {
      macroid: "0",
      name: name,
      macrotext: macro,
      action: "save",
    });
  }

  async searchMall(itemName: string): Promise<MallResult[]> {
    const apiResponse = (await this.visitUrl(
      `mall.php?justitems=0&pudnuggler="${encodeURI(itemName)}"`
    )) as string;

    const matches = apiResponse.matchAll(
      /href="mallstore\.php\?whichstore=(\d+)&searchitem=(\d+)&searchprice=(\d+)"><b>.+?"small stock">([\d,]+)<\/td>.*?<td class="small">(?:(\d+)&nbsp;\/&nbsp;day&nbsp;&nbsp;&nbsp;<\/td>)?/
    );

    let results: MallResult[] = [];

    for (let result of matches) {
      const storeId = parseInt(result[0]);
      const itemId = parseInt(result[1]);
      const price = parseInt(result[2]);
      const stockLevel = parseInt(result[3].replaceAll(",", ""));
      const limit = result[4] == null ? undefined : parseInt(result[4].replaceAll(",", ""));

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
      itemId = "0" + itemId;
    }

    itemId = mallResult.itemId + itemId;

    await this.visitUrl(
      `mallstore.php?buying=1&quantity=${amount}&whichitem=${itemId}&ajax=1&pwd=${this._credentials?.pwdhash}&whichstore=${mallResult.storeId}`
    );
  }

  async buyFromNPC(shopName: string, row: number, amount: number): Promise<void> {
    await this.visitUrl(
      `shop.php?whichshop=${shopName}&action=buyitem&quantity=${amount}&whichrow=${row}&pwd=${this._credentials?.pwdhash}`
    );
  }

  async multiUse(item: number, amount: number): Promise<void> {
    await this.visitUrl(
      `multiuse.php?whichitem=${item}&action=useitem&ajax=1&quantity=${amount}&pwd=${this._credentials?.pwdhash}`
    );
  }

  async buyFromHermit(item: number, amount: number): Promise<void> {
    await this.visitUrl("hermit.php", {
      action: "trade",
      whichitem: item,
      quantity: amount,
    });
  }
}

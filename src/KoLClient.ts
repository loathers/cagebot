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

export class KoLClient {
  private _loginParameters;
  private _credentials?: KOLCredentials;
  private _lastFetchedMessages: string = "0";
  private _player?: KoLUser;
  private _messageQueue: PrivateMessage[] = [];

  constructor(username: string, password: string) {
    this._loginParameters = new URLSearchParams();
    this._loginParameters.append("loggingin", "Yup.");
    this._loginParameters.append("loginname", username);
    this._loginParameters.append("password", password);
    this._loginParameters.append("secure", "0");
    this._loginParameters.append("submitbutton", "Log In");
  }

  async loggedIn(): Promise<boolean> {
    if (!this._credentials) return false;
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
    return apiResponse.status === 200;
  }

  async logIn(): Promise<void> {
    if (await this.loggedIn()) return;
    console.log(`Not logged in. Logging in as ${this._loginParameters.get("loginname")}`);
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
  }

  async visitUrl(
    url: string,
    parameters: Record<string, any> = {},
    pwd: Boolean = true
  ): Promise<any> {
    await this.logIn();
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
    return page.data;
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

  async addToPrivateMessageQueue(recipient: KoLUser, message: string): Promise<void> {
    this._messageQueue.push({ who: recipient, msg: message });
  }

  async sendNextMessage(): Promise<void> {
    const nextMessage = this._messageQueue.shift();
    if (nextMessage) await this.sendPrivateMessage(nextMessage.who, nextMessage.msg);
  }

  async fetchNewWhispers(): Promise<PrivateMessage[]> {
    const newChatMessagesResponse = await this.visitUrl("newchatmessages.php", {
      j: 1,
      lasttime: this._lastFetchedMessages,
    });
    this._lastFetchedMessages = newChatMessagesResponse["last"];
    const newWhispers: PrivateMessage[] = newChatMessagesResponse["msgs"]
      .filter((msg: KOLMessage) => msg["type"] === "private")
      .map((msg: KOLMessage) => ({
        who: msg.who,
        msg: msg.msg,
      }));
    newWhispers.forEach(({ who }) => this.addToPrivateMessageQueue(who, "Message acknowledged."));
    return newWhispers;
  }

  async getWhitelists(): Promise<KoLClan[]> {
    const clanRecuiterResponse = await this.visitUrl("clan_signup.php");
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

  async getAdvs(): Promise<number> {
    const apiResponse = await this.visitUrl("api.php", {
      what: "status",
      for: "Cagesitter (Maintained by Phillammon)",
    });
    return parseInt(apiResponse["adventures"], 10);
  }
}

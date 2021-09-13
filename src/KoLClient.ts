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
  private _isRollover: boolean = false;

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
      return apiResponse.status === 200;
    } catch {
      console.log("Login check failed, returning false to be safe.")
      return false;
    }
  }

  async logIn(): Promise<boolean> {
    if (await this.loggedIn()) return true;
    if (this._isRollover) return false;
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
      return true
    } catch {
      console.log("Login failed. Checking if it's because of rollover.")
      await this.rolloverCheck()
      return false
    }
  }

  async rolloverCheck() {
    this._isRollover = /The system is currently down for nightly maintenance\./.test((await axios("https://www.kingdomofloathing.com/")).data);
    if (this._isRollover) {
      console.log("Rollover appears to be in progress. Checking again in one minute.")
      setTimeout(() => this.rolloverCheck(), 60000)
    }
  }

  async visitUrl(
    url: string,
    parameters: Record<string, any> = {},
    pwd: Boolean = true
  ): Promise<any> {
    if (this._isRollover || !await this.logIn()) return null;
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

  async fetchNewWhispers(): Promise<PrivateMessage[]> {
    const newChatMessagesResponse = await this.visitUrl("newchatmessages.php", {
      j: 1,
      lasttime: this._lastFetchedMessages,
    });
    if (!newChatMessagesResponse) return []
    this._lastFetchedMessages = newChatMessagesResponse["last"];
    const newWhispers: PrivateMessage[] = newChatMessagesResponse["msgs"]
      .filter((msg: KOLMessage) => msg["type"] === "private")
      .map((msg: KOLMessage) => ({
        who: msg.who,
        msg: msg.msg,
      }));
    newWhispers.forEach(({ who }) => this.sendPrivateMessage(who, "Message acknowledged."));
    return newWhispers;
  }

  async getWhitelists(): Promise<KoLClan[]> {
    const clanRecuiterResponse = await this.visitUrl("clan_signup.php");
    if (!clanRecuiterResponse) return []
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
    if (apiResponse) return parseInt(apiResponse["adventures"], 10);
    return 0;
  }
}

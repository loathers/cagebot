import { DietResponse } from "../utils/JsonResponses";
import { CageBot } from "../CageBot";
import { KoLClient } from "../utils/KoLClient";
import { Diet, Settings, ChatMessage, KoLStatus } from "../utils/Typings";
import { getLilBarrelDiet, getManualDiet, sendApiResponse, toJson } from "../utils/Utils";

export class DietHandler {
  private _diet?: Diet[];
  private _cagebot: CageBot;
  private _maxDrunk?: number;
  private _usingBarrelMimic: boolean = false;
  private _ownsTuxedo: boolean = false;

  constructor(cagebot: CageBot) {
    this._cagebot = cagebot;
  }

  getClient(): KoLClient {
    return this._cagebot.getClient();
  }

  getSettings(): Settings {
    return this._cagebot.getSettings();
  }

  getMaxDrunk(): number | undefined {
    return this._maxDrunk;
  }

  setMaxDrunk(maxDrunk: number) {
    this._maxDrunk = maxDrunk;
  }

  async doSetup() {
    if (!this._cagebot.isCaged() && !this._maxDrunk) {
      if (/>Liver of Steel<\/a>/.test(await this.getClient().visitUrl("charsheet.php"))) {
        this._maxDrunk = 19;
      } else {
        this._maxDrunk = 14;
      }
    }

    if (this._diet) {
      return;
    }

    const status = await this.getClient().getStatus();

    this._ownsTuxedo =
      (await this.getClient().getInventory()).has(2489) || status?.equipment.get("shirt") == 2489;

    this._usingBarrelMimic = status?.familiar == 198;

    if (this._usingBarrelMimic) {
      this._diet = getLilBarrelDiet();
    } else {
      this._diet = getManualDiet();
    }

    await this.sortDiet();
  }

  async sortDiet() {
    if (!this._diet) {
      return;
    }

    const inv: Map<number, number> = await this.getClient().getInventory();

    // Sort our diet so that the best foods and drinks that are available are pushed to the very top.
    // This is so we can try even the spread of our consumed items between drink and food.
    this._diet.sort((d1, d2) => {
      let advs1 = d1.estAdvs / d1.fullness;
      let advs2 = d2.estAdvs / d2.fullness;

      if (advs1 == advs2 || d1.type != d2.type) {
        advs1 *= inv.get(d1.id) || 0;
        advs2 *= inv.get(d2.id) || 0;
      }

      return advs1 > advs2 ? -1 : 1;
    });
  }

  async maintainAdventures(message?: ChatMessage): Promise<number> {
    const status = await this.getClient().getStatus();
    const beforeAdv = status.adventures;

    if (beforeAdv > this.getSettings().maintainAdventures) {
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
    const inventory: Map<number, number> = await this.getClient().getInventory();
    let itemConsumed;
    let itemsMissing: string[] = [];
    let itemIdsMissing: string[] = [];
    let consumeMessage: any;
    let hasStomachSpace: boolean = false;

    for (let diet of this._diet || []) {
      if (diet.level > currentLevel) {
        continue;
      }

      if (diet.fullness > (diet.type == "food" ? fullRemaining : drunkRemaining)) {
        continue;
      }

      hasStomachSpace = true;

      if ((inventory.get(diet.id) || 0) <= 0) {
        itemsMissing.push(diet.name);
        itemIdsMissing.push(diet.id.toString());
        continue;
      }

      if (diet.type == "food") {
        console.log(`Attempting to eat ${diet.name}, of which we have ${inventory.get(diet.id)}`);
        consumeMessage = await this.getClient().eat(diet.id);
      } else {
        console.log(`Attempting to drink ${diet.name}, of which we have ${inventory.get(diet.id)}`);

        if (this._usingBarrelMimic && this._ownsTuxedo) {
          const priorShirt = status.equipment.get("shirt") || 0;

          if (priorShirt != 2489) {
            await this.getClient().equip(2489);
          }

          consumeMessage = this.getClient().drink(diet.id);

          if (priorShirt > 0 && priorShirt != 2489) {
            await this.getClient().equip(priorShirt);
          }
        } else {
          consumeMessage = await this.getClient().drink(diet.id);
        }
      }

      itemConsumed = diet.name;
      break;
    }

    if (!hasStomachSpace) {
      return beforeAdv;
    }

    const afterAdv = (await this.getClient().getStatus()).adventures;

    if (beforeAdv === afterAdv) {
      if (itemConsumed) {
        console.log(`Failed to consume ${itemConsumed}.`);
        console.log(consumeMessage);
      } else if (this._usingBarrelMimic) {
        console.log(`I am out of Lil' Barrel Mimic consumables.`);

        if (message !== undefined) {
          if (message.apiRequest) {
            await sendApiResponse(message, "Issue", "lack_barrel_edibles");
          } else {
            await message.reply(`Please tell my operator that I am out of consumables.`);
          }
        }
      } else {
        console.log(`I am out of ${itemsMissing.join(", ")}.`);

        if (message !== undefined) {
          if (message.apiRequest) {
            await sendApiResponse(
              message,
              "Issue",
              `lack_edibles:${itemIdsMissing.join(",")}` as any
            );
          } else {
            await this.getClient().sendPrivateMessage(
              message.who,
              `Please tell my operator that I am out of ${itemsMissing.join(", ")}.`
            );
          }
        }
      }
    } else {
      const advsGained = afterAdv - beforeAdv;

      // If it didn't restore enough adventures and we definitely did gain adventures
      if (beforeAdv < afterAdv && afterAdv <= this.getSettings().maintainAdventures) {
        console.log(
          `Diet success! We gained ${advsGained} adventures! However we're below our threshold so we're going to call this again.`
        );

        return this.maintainAdventures(message);
      }

      console.log(
        `Diet success! Gained ${advsGained} adventures! Sastified with ${afterAdv} total adventures!`
      );
    }

    await this.sortDiet();
    return afterAdv;
  }

  async sendDiet(message: ChatMessage) {
    console.log(
      `${message.who.name} (#${message.who.id}) requested diet information${
        message.apiRequest ? " in json format" : ""
      }.`
    );

    const inventory: Map<number, number> = await this.getClient().getInventory();
    const status = await this.getClient().getStatus();
    const level = status.level;
    let food: number = 0;
    let drink: number = 0;
    let fullAdvs: number = 0;
    let drunkAdvs: number = 0;
    let advs: number = this.getPossibleAdventuresFromDiet(status, inventory);

    for (let diet of this._diet || []) {
      if (!inventory.has(diet.id) || diet.level > level) {
        continue;
      }

      let count = inventory.get(diet.id) || 0;

      if (diet.type == "food") {
        food += count * diet.fullness;
        fullAdvs += count * diet.estAdvs;
      } else {
        drink += count * diet.fullness;
        drunkAdvs += count * diet.estAdvs;
      }
    }

    if (message.apiRequest) {
      const dietStatus: DietResponse = {
        type: "diet",
        possibleAdvsToday: advs,
        food: food,
        fullnessAdvs: fullAdvs,
        drink: drink,
        drunknessAdvs: drunkAdvs,
      };

      await this.getClient().sendPrivateMessage(message.who, toJson(dietStatus));
    } else {
      await message.reply(`My remaining diet today has an expected outcome of ${advs} adventures.`);
      await message.reply(`I have enough food for ${food} fullness and ${fullAdvs} adventures.`);
      await message.reply(
        `I have enough drinks for another ${drink} inebriety and ${drunkAdvs} adventures.`
      );
    }
  }

  getPossibleAdventuresFromDiet(status: KoLStatus, inv: Map<number, number>): number {
    if (!this._diet) {
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
          fullRemaining -= diet.fullness;
        } else {
          drunkRemaining -= diet.fullness;
        }
      }
    }

    return advs;
  }
}

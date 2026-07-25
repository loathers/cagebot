import { type Client, gameData } from "kol.js";
import type { ApiStatus } from "kol.js/domains/ApiStatus";
import type { Item } from "data-of-loathing";
import { DietResponse } from "../utils/JsonResponses.js";
import { CageBot } from "../CageBot.js";
import { Settings, ChatMessage } from "../utils/Typings.js";
import {
  getLilBarrelDiet,
  getManualDiet,
  sendApiResponse,
  sendPrivateMessage,
  toJson,
} from "../utils/Utils.js";

const TUXEDO_SHIRT = 2489;
const BARREL_MIMIC = 198;
const LIVER_OF_STEEL = 1;

export class DietHandler {
  private _diet?: Item[];
  private _cagebot: CageBot;
  private _maxDrunk?: number;
  private _usingBarrelMimic: boolean = false;
  private _ownsTuxedo: boolean = false;

  constructor(cagebot: CageBot) {
    this._cagebot = cagebot;
  }

  private get client(): Client {
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

  // Per-item diet stats, derived from game data at the point of use.
  private isFood(item: Item): boolean {
    return item.consumable!.stomach > 0;
  }

  private fullnessOf(item: Item): number {
    const consumable = item.consumable!;
    return consumable.stomach > 0 ? consumable.stomach : consumable.liver;
  }

  private levelOf(item: Item): number {
    return item.consumable!.levelRequirement;
  }

  // Floor the average yield to stay on the conservative side.
  private estAdvsOf(item: Item): number {
    return Math.floor(item.consumable!.adventures);
  }

  async doSetup() {
    if (!this._cagebot.isCaged() && !this._maxDrunk) {
      const skills = await this.client.charSheet.getSkills();

      if ([...skills.keys()].some((skill) => skill.id === LIVER_OF_STEEL)) {
        this._maxDrunk = 19;
      } else {
        this._maxDrunk = 14;
      }
    }

    if (this._diet) {
      return;
    }

    const status = await this.client.fetchStatus();
    const inventory = await this.client.inventory.get.refresh();
    const tuxedo = await gameData.findItemById(TUXEDO_SHIRT);

    this._ownsTuxedo =
      (tuxedo !== null && inventory.has(tuxedo)) || status.equipment?.shirt === TUXEDO_SHIRT;

    this._usingBarrelMimic = status.familiar === BARREL_MIMIC;

    this._diet = this._usingBarrelMimic ? await getLilBarrelDiet() : await getManualDiet();

    await this.sortDiet();
  }

  async sortDiet() {
    if (!this._diet) {
      return;
    }

    const inv = await this.client.inventory.get.refresh();

    // Sort our diet so that the best foods and drinks that are available are pushed to the very top.
    // This is so we can try even the spread of our consumed items between drink and food.
    this._diet.sort((a, b) => {
      let advsA = this.estAdvsOf(a) / this.fullnessOf(a);
      let advsB = this.estAdvsOf(b) / this.fullnessOf(b);

      if (advsA == advsB || this.isFood(a) != this.isFood(b)) {
        advsA *= inv.get(a) || 0;
        advsB *= inv.get(b) || 0;
      }

      return advsA > advsB ? -1 : 1;
    });
  }

  async maintainAdventures(message?: ChatMessage): Promise<number> {
    const status = await this.client.fetchStatus();
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
    const inventory = await this.client.inventory.get.refresh();
    let itemConsumed;
    let itemsMissing: string[] = [];
    let itemIdsMissing: string[] = [];
    let consumeMessage: any;
    let hasStomachSpace: boolean = false;

    for (const item of this._diet || []) {
      if (this.levelOf(item) > currentLevel) {
        continue;
      }

      const isFood = this.isFood(item);

      if (this.fullnessOf(item) > (isFood ? fullRemaining : drunkRemaining)) {
        continue;
      }

      hasStomachSpace = true;

      if ((inventory.get(item) || 0) <= 0) {
        itemsMissing.push(item.name);
        itemIdsMissing.push(item.id.toString());
        continue;
      }

      if (isFood) {
        console.log(`Attempting to eat ${item.name}, of which we have ${inventory.get(item)}`);
        consumeMessage = await this.client.consumption.eat(item);
      } else {
        console.log(`Attempting to drink ${item.name}, of which we have ${inventory.get(item)}`);

        if (this._usingBarrelMimic && this._ownsTuxedo) {
          const priorShirt = status.equipment?.shirt || 0;

          if (priorShirt != TUXEDO_SHIRT) {
            await this.client.equipment.equip(TUXEDO_SHIRT);
          }

          consumeMessage = await this.client.consumption.drink(item);

          if (priorShirt > 0 && priorShirt != TUXEDO_SHIRT) {
            await this.client.equipment.equip(priorShirt);
          }
        } else {
          consumeMessage = await this.client.consumption.drink(item);
        }
      }

      itemConsumed = item.name;
      break;
    }

    if (!hasStomachSpace) {
      return beforeAdv;
    }

    const afterAdv = (await this.client.fetchStatus()).adventures;

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
            // await message.reply(`Please tell my operator that I am out of consumables.`);
            this.cryAboutDiet(message);
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
            await sendPrivateMessage(
              this.client,
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

    const dietStatus = await this.getDietStatus();

    if (message.apiRequest) {
      await sendPrivateMessage(this.client, message.who, toJson(dietStatus));
    } else {
      await message.reply(
        `My remaining diet today has an expected outcome of ${dietStatus.possibleAdvsToday} adventures.`
      );
      await message.reply(
        `I have enough food for ${dietStatus.food} fullness and ${dietStatus.fullnessAdvs} adventures.`
      );
      await message.reply(
        `I have enough drinks for another ${dietStatus.drink} inebriety and ${dietStatus.drunknessAdvs} adventures.`
      );

      await this.cryAboutDiet(message);
    }
  }

  async getDietStatus(): Promise<DietResponse> {
    const inventory = await this.client.inventory.get.refresh();
    const status = await this.client.fetchStatus();
    const level = status.level;
    let food: number = 0;
    let drink: number = 0;
    let fullAdvs: number = 0;
    let drunkAdvs: number = 0;
    let advs: number = this.getPossibleAdventuresFromDiet(status, inventory);

    for (const item of this._diet || []) {
      if (!inventory.has(item) || this.levelOf(item) > level) {
        continue;
      }

      const count = inventory.get(item) || 0;

      if (this.isFood(item)) {
        food += count * this.fullnessOf(item);
        fullAdvs += count * this.estAdvsOf(item);
      } else {
        drink += count * this.fullnessOf(item);
        drunkAdvs += count * this.estAdvsOf(item);
      }
    }

    const dietStatus: DietResponse = {
      type: "diet",
      possibleAdvsToday: advs,
      food: food,
      fullnessAdvs: fullAdvs,
      drink: drink,
      drunknessAdvs: drunkAdvs,
    };

    return dietStatus;
  }

  async cryAboutDiet(message?: ChatMessage) {
    if (!message || !this._diet || message.apiRequest) return;

    const status = await this.getDietStatus();

    for (const type of ["food", "drink"]) {
      if ((type == "food" ? status.fullnessAdvs : status.drunknessAdvs) >= 1000) continue;

      const diet = this._diet
        .filter((item) => (this.isFood(item) ? "food" : "drink") == type)
        .map((item) => item.name);

      message
        .reply(`I am running low on ${type}, are you able to send me some of the following?`)
        .then(() => {
          message.reply(diet.join(", "));
        });
    }
  }

  getPossibleAdventuresFromDiet(status: ApiStatus, inv: Map<Item, number>): number {
    if (!this._diet) {
      return 0;
    }

    let drunkRemaining: number = (this._maxDrunk || 14) - status.drunk;
    let fullRemaining: number = 14 - status.full;
    let advs: number = 0;

    for (const item of this._diet) {
      if (this.levelOf(item) > status.level) {
        continue;
      }

      let amount = inv.get(item) || 0;
      const isFood = this.isFood(item);
      const fullness = this.fullnessOf(item);
      const estAdvs = this.estAdvsOf(item);

      while (amount > 0 && (isFood ? fullRemaining : drunkRemaining) >= fullness) {
        advs += estAdvs;
        amount--;

        if (isFood) {
          fullRemaining -= fullness;
        } else {
          drunkRemaining -= fullness;
        }
      }
    }

    return advs;
  }
}

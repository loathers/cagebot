import { CageBot } from "../CageBot";
import { ChatMessage } from "../utils/Typings";
import { sendApiResponse } from "../utils/Utils";

export class UncageHandler {
  private _cagebot: CageBot;

  constructor(cagebot: CageBot) {
    this._cagebot = cagebot;
  }

  async escapeCage(message: ChatMessage, apiRequest: boolean = false): Promise<void> {
    console.log(
      `${message.who.name} (#${message.who.id}) requested escape from cage${
        message.apiRequest ? " in json format" : ""
      }.`
    );

    await this._cagebot.testForThirdPartyUncaging();

    if (
      !this._cagebot.isCaged() ||
      (this._cagebot.getCageTask() && this._cagebot.getCageTask()?.requester.id !== message.who.id)
    ) {
      if (!this._cagebot.isCaged()) {
        console.log(`Not currently caged, sending status report instead.`);
      } else {
        console.log(`User not authorised to initiate escape, sending status report instead.`);
      }

      await this._cagebot.sendStatus(message);
    } else {
      await this._cagebot.chewOut();

      console.log(`Successfully chewed out of cage. Reporting success.`);

      if (apiRequest) {
        await this._cagebot.sendStatus(message);
      } else {
        await message.reply("Chewed out! I am now uncaged.");
      }

      await this._cagebot.getDietHandler().maintainAdventures(message);
    }
  }

  async releaseCage(message: ChatMessage): Promise<void> {
    console.log(
      `${message.who.name} (#${message.who.id}) requested release from cage${
        message.apiRequest ? " in json format" : ""
      }.`
    );

    await this._cagebot.testForThirdPartyUncaging();

    if (
      !this._cagebot.isCaged() ||
      (this._cagebot.getCageTask() &&
        !this._cagebot.releaseable() &&
        message.who.id !== this._cagebot.getCageTask()?.requester.id)
    ) {
      if (!this._cagebot.isCaged()) {
        console.log(`Not currently caged, sending status report instead.`);
      } else {
        console.log(`Release timer has not yet expired, sending status report instead.`);
      }

      await this._cagebot.sendStatus(message);
    } else {
      const prevStatus = this._cagebot.getCageTask();

      await this._cagebot.chewOut();

      console.log(`Successfully chewed out of cage. Reporting success.`);

      if (message.apiRequest) {
        await this._cagebot.sendStatus(message);
      } else {
        await message.reply("Chewed out! I am now uncaged.");
      }

      if (prevStatus && prevStatus.requester.id !== message.who.id) {
        console.log(
          `Reporting release to original requester ${prevStatus.requester.name} (#${prevStatus.requester.id}).`
        );

        if (prevStatus.apiResponses) {
          await sendApiResponse(message, "Notification", "your_clan_unbaited");
        } else {
          await this._cagebot
            .getClient()
            .sendPrivateMessage(
              prevStatus.requester,
              `I chewed out of the Hobopolis instance in ${prevStatus.clan.name} due to recieving a release command after being left in for more than an hour. YOUR CAGE IS NOW UNBAITED.`
            );
        }
      }

      await this._cagebot.getDietHandler().maintainAdventures(message);
    }
  }
}

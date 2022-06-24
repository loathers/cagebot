import { CageBot } from "../CageBot";
import { KoLClient } from "../KoLClient";
import { Settings, PrivateMessage, KoLClan, ExploredStatus } from "../Typings";
import {
  sendApiResponse,
  humanReadableTime,
  readGratesAndValves,
  updateWhiteboard,
} from "../Utils";

export class CagingHandler {
  private _cagebot: CageBot;

  constructor(cagebot: CageBot) {
    this._cagebot = cagebot;
  }

  getClient(): KoLClient {
    return this._cagebot.getClient();
  }

  getSettings(): Settings {
    return this._cagebot.getSettings();
  }

  async becomeCaged(message: PrivateMessage): Promise<void> {
    console.log(
      `${message.who.name} (#${message.who.id}) requested a caging${
        message.apiRequest ? " in json format" : ""
      }.`
    );
    await this._cagebot.testForThirdPartyUncaging();

    // If rollover is less than 7 minutes away
    if ((await this.getClient().getSecondsToRollover()) < 7 * 60) {
      if (message.apiRequest) {
        await sendApiResponse(message, "Error", "rollover");
      } else {
        await this.getClient().sendPrivateMessage(
          message.who,
          `Rollover is in ${humanReadableTime(
            await this.getClient().getSecondsToRollover()
          )}, I do not wish to get into a bad state. Please try again after rollover.`
        );
      }

      return;
    }

    if (!message.msg.includes(" ")) {
      console.log("Received a cage request, with no clan name included.");

      if (message.apiRequest) {
        sendApiResponse(message, "Error", "invalid_clan");
      } else {
        await this.getClient().sendPrivateMessage(
          message.who,
          "Please provide the name of a clan I am whitelisted in."
        );
      }

      return;
    }

    const clanName = message.msg.slice(message.msg.indexOf(" ") + 1);
    console.log(`${message.who.name} (#${message.who.id}) requested caging in clan "${clanName}"`);

    if (this._cagebot.isCaged()) {
      if (message.apiRequest) {
        console.log(`Already caged. Sending invalid response instead.`);
        await sendApiResponse(message, "Error", "already_caged");
      } else {
        console.log(`Already caged. Sending status report instead.`);
        await this._cagebot.sendStatus(message);
      }

      return;
    }

    const whitelists = (await this.getClient().getWhitelists()).filter((clan: KoLClan) =>
      clan.name.toLowerCase().includes(clanName.toLowerCase())
    );

    if (whitelists.length > 1) {
      console.log(`Clan name "${clanName}" ambiguous, aborting.`);

      if (message.apiRequest) {
        await sendApiResponse(message, "Error", "clan_ambiguous");
      } else {
        this.getClient().sendPrivateMessage(
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

      if (message.apiRequest) {
        await sendApiResponse(message, "Error", "not_whitelisted");
      } else {
        this.getClient().sendPrivateMessage(
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

    await this.getClient().joinClan(targetClan);

    if ((await this.getClient().myClan()) !== targetClan.id) {
      console.log(`Whitelisting to clan "${targetClan.name}" failed, aborting.`);

      if (message.apiRequest) {
        await sendApiResponse(message, "Error", "unsuccessful_whitelist");
      } else {
        await this.getClient().sendPrivateMessage(
          message.who,
          `I tried to whitelist to ${targetClan.name}, but was unable to. Did I accidentally become a clan leader?`
        );
      }

      return;
    }

    if (!/Old Sewers/.test(await this.getClient().visitUrl("clan_hobopolis.php"))) {
      console.log(`Sewers in clan "${targetClan.name}" inaccessible, aborting.`);

      if (message.apiRequest) {
        await sendApiResponse(message, "Error", "no_hobo_access");
      } else {
        await this.getClient().sendPrivateMessage(
          message.who,
          `I can't seem to access the sewers in ${targetClan.name}. Is Hobopolis open? Do I have the right permissions?`
        );
      }

      return;
    }

    await this.attemptCage(message, targetClan);
  }

  async attemptCage(message: PrivateMessage, targetClan: KoLClan): Promise<void> {
    this._cagebot.setCagedStatus(false, {
      clan: targetClan,
      requester: message.who,
      started: Date.now(),
      apiResponses: message.apiRequest,
    });

    let status = await this.getClient().getStatus();

    let gratesOpened = 0;
    let valvesTwisted = 0;
    let timesChewedOut = 0;
    const [gratesFoundOpen, valvesFoundTwisted]: [number, number] = this.getSettings()
      .openEverything
      ? await readGratesAndValves(this.getClient())
      : [0, 0];
    let currentAdventures = status.adventures;
    let currentDrunk: number = status.drunk;
    let estimatedTurnsSpent: number = 0;
    let totalTurnsSpent: number = 0;
    let failedToMaintain = false;
    updateWhiteboard(this._cagebot, true);

    if (this.getSettings().openEverything) {
      console.log(
        `${targetClan.name} has ${gratesFoundOpen} grates already opened, ${valvesFoundTwisted} valves already twisted`
      );
    }

    const escapeCageToOpenGratesAndValves: () => boolean = () => {
      if (!this.getSettings().openEverything) {
        return false;
      }

      // If we have less than this turns, lets not burn the adventures
      if (
        currentAdventures - estimatedTurnsSpent <=
        this.getSettings().openEverythingWhileAdventuresAbove
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

    if (message.apiRequest) {
      await sendApiResponse(message, "Accepted", "doing_cage");
    } else {
      await this.getClient().sendPrivateMessage(
        message.who,
        `Attempting to get caged in ${targetClan.name}.`
      );
    }

    console.log(`Beginning turns in ${targetClan.name} sewers.`);
    let caged = this._cagebot.isCaged();

    while (
      !caged &&
      currentAdventures - estimatedTurnsSpent > 11 &&
      currentDrunk <= (this._cagebot.getDietHandler().getMaxDrunk() || 14)
    ) {
      // If we haven't failed to maintain our adventures yet
      if (!failedToMaintain) {
        // If we're at or lower than the amount of adventures we wish to maintain.
        if (currentAdventures - estimatedTurnsSpent <= this.getSettings().maintainAdventures) {
          status = await this.getClient().getStatus();
          let adventuresPreDiet = status.adventures;

          // Add total turns spent as far
          totalTurnsSpent += currentAdventures - adventuresPreDiet;
          // Reset our estimated
          estimatedTurnsSpent = 0;

          // Function returns the new adventures remaining
          let adventuresAfterDiet = await this._cagebot
            .getDietHandler()
            .maintainAdventures(message);
          // Update current drunk level
          currentDrunk = status.drunk;
          // If the adventures remaining are at, or less than our estimated adventures remaining. Then we failed to maintain our diet.
          failedToMaintain =
            adventuresPreDiet == adventuresAfterDiet &&
            adventuresAfterDiet <= this.getSettings().maintainAdventures;
          currentAdventures = adventuresAfterDiet;

          if (failedToMaintain) {
            console.log(
              "We failed to maintain our diet while adventuring in the sewers, will not attempt to maintain again."
            );
          }
        }
      }

      estimatedTurnsSpent += 1;

      const adventureResponse = await this.getClient().visitUrl("adventure.php", {
        snarfblat: 166,
      });

      if (/Despite All Your Rage/.test(adventureResponse)) {
        estimatedTurnsSpent--;
        caged = true;

        await this.getClient().visitUrl("choice.php", {
          whichchoice: 211,
          option: 2,
        });

        if (escapeCageToOpenGratesAndValves()) {
          await this._cagebot.chewOut();
          estimatedTurnsSpent += 10;
          timesChewedOut++;
          console.log(`Escaping cage to continue opening grates and twisting valves!`);
        } else {
          console.log(`Caged!`);
        }
      } else if (/Disgustin\' Junction/.test(adventureResponse)) {
        const choiceResponse = await this.getClient().visitUrl("choice.php", {
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
        const choiceResponse = await this.getClient().visitUrl("choice.php", {
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

        await this.getClient().visitUrl("choice.php", {
          whichchoice: 199,
          option: 3,
        });
      } else if (/Pop!/.test(adventureResponse)) {
        estimatedTurnsSpent--; // Free turn

        await this.getClient().visitUrl("choice.php", {
          whichchoice: 296,
          option: 1,
        });
      }

      if (!caged && /whichchoice/.test(await this.getClient().visitUrl("place.php"))) {
        console.log(`Unexpectedly still in a choice after running possible choices. Aborting.`);

        break;
      }
    }

    if (caged) {
      this._cagebot.setCagedStatus(true, {
        clan: targetClan,
        requester: message.who,
        started: Date.now(),
        apiResponses: message.apiRequest,
      });

      console.log(`Successfully caged in clan ${targetClan.name}. Reporting success.`);

      if (!message.apiRequest) {
        await this.getClient().sendPrivateMessage(
          message.who,
          `Clang! I am now caged in ${targetClan.name}. Release me later by whispering "escape" to me.`
        );
      }
    } else {
      // Also clears working task
      this._cagebot.setCagedStatus(false);

      if (currentAdventures - estimatedTurnsSpent <= 11) {
        console.log(
          `Ran out of adventures attempting to get caged in clan ${targetClan.name}. Aborting.`
        );

        // API doesn't send a message here, but sends it later
        if (!message.apiRequest) {
          await this.getClient().sendPrivateMessage(
            message.who,
            `I ran out of adventures trying to get caged in ${targetClan.name}.`
          );
        }
      } else {
        console.log(
          `Unexpected error occurred attempting to get caged in clan ${targetClan.name}. Aborting.`
        );

        // API doesn't send a message here, but sends it later
        if (!message.apiRequest) {
          await this.getClient().sendPrivateMessage(
            message.who,
            `Something unspecified went wrong while I was trying to get caged in ${targetClan.name}. Good luck.`
          );
        }
      }

      updateWhiteboard(this._cagebot, this._cagebot.isCaged());
    }

    const endAdvs = (await this.getClient().getStatus()).adventures;
    const spentAdvs = totalTurnsSpent + (currentAdventures - endAdvs);

    if (estimatedTurnsSpent + totalTurnsSpent != spentAdvs) {
      console.log(
        `We estimated ${estimatedTurnsSpent} + ${totalTurnsSpent} turns spent, ${spentAdvs} turns were actually spent.`
      );
    } else {
      console.log(`We spent ${spentAdvs} in the process, we have ${endAdvs} turns remaining`);
    }

    console.log(
      `The clan has ${gratesOpened + gratesFoundOpen} / 20 grates open, ${
        valvesTwisted + valvesFoundTwisted
      } / 20 valves twisted.`
    );

    if (message.apiRequest) {
      const hoboStatus: ExploredStatus = {
        caged: this._cagebot.isCaged(),
        advsUsed: spentAdvs,
        advsLeft: endAdvs,
        grates: gratesOpened,
        totalGrates: gratesOpened + gratesFoundOpen,
        valves: valvesTwisted,
        totalValves: valvesTwisted + valvesFoundTwisted,
        chews: timesChewedOut,
      };

      await this.getClient().sendPrivateMessage(message.who, JSON.stringify(hoboStatus));
    } else {
      await this.getClient().sendPrivateMessage(
        message.who,
        `I opened ${gratesOpened} grate${
          gratesOpened === 1 ? "" : "s"
        } and turned ${valvesTwisted} valve${valvesTwisted === 1 ? "" : "s"} on the way,${
          timesChewedOut > 0 ? ` caged yet escaped ${timesChewedOut} times,` : ``
        } and spent ${spentAdvs} adventure${spentAdvs === 1 ? "" : "s"} (${endAdvs} remaining).`
      );

      if (gratesOpened > 0 || valvesTwisted > 0) {
        await this.getClient().sendPrivateMessage(
          message.who,
          `Hobopolis has ${gratesOpened + gratesFoundOpen} / 20 grates open, ${
            valvesTwisted + valvesFoundTwisted
          } / 20 valves twisted.`
        );
      }
    }
  }
}

import { ExploredResponse } from "../utils/JsonResponses";
import { CageBot } from "../CageBot";
import { KoLClient } from "../utils/KoLClient";
import { Settings, ChatMessage, KoLClan } from "../utils/Typings";
import {
  sendApiResponse,
  humanReadableTime,
  readGratesAndValves,
  updateWhiteboard,
  toJson,
} from "../utils/Utils";

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

  async becomeCaged(message: ChatMessage): Promise<void> {
    console.log(
      `${message.who.name} (#${message.who.id}) requested a caging${
        message.apiRequest ? " in json format" : ""
      }.`
    );

    await this._cagebot.testForThirdPartyUncaging();

    const timeToRollover = await this.getClient().getSecondsToRollover();

    // If rollover is less than 7 minutes away
    if (timeToRollover < 7 * 60) {
      if (message.apiRequest) {
        await sendApiResponse(message, "Error", "rollover");
      } else {
        await this.getClient().sendPrivateMessage(
          message.who,
          `Rollover is in ${humanReadableTime(
            timeToRollover
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

    // Sort clans by name length so that we can simply check the first clan for equality
    whitelists.sort((c1, c2) => c1.name.length - c2.name.length);

    // If there are multiple clans, and the shortest clan name isn't an exact match in name
    if (whitelists.length > 1 && whitelists[0].name.toLowerCase() != clanName.toLowerCase()) {
      console.log(`Clan name "${clanName}" ambiguous, aborting.`);

      if (message.apiRequest) {
        await sendApiResponse(message, "Error", "clan_ambiguous");
      } else {
        await this.getClient().sendPrivateMessage(
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
        await this.getClient().sendPrivateMessage(
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

    if (!(await this.attemptClanSwitch(targetClan))) {
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

  async attemptClanSwitch(targetClan: KoLClan): Promise<boolean> {
    await this.getClient().joinClan(targetClan);

    if ((await this.getClient().myClan()) === targetClan.id) {
      return true;
    }

    console.log(
      `Whitelisting to clan "${targetClan.name}" failed, checking if we can transfer leadership.`
    );

    const currentClanLeader = await this.getClient().getClanLeader(await this.getClient().myClan());

    if (!currentClanLeader || currentClanLeader !== this.getClient().getMe()?.id) {
      console.log(`We do not appear to have leadership of the clan ${targetClan.name}.`);

      return false;
    }

    // If we fetched the current clan leader, and we are the leader
    const inactiveMember = await this.getClient().getInactiveMember();

    // If we found an inactive clan member
    if (!inactiveMember) {
      console.log(`Failed to find an inactive clan member in our current clan.`);
      return false;
    }

    console.log(`Now attempting to transfer clan leadership to inactive member ${inactiveMember}`);
    // If clan leadership transfer was successful
    const switchedLeadership = await this.getClient().transferClanLeadership(inactiveMember);

    console.log(`Clan leadership transfer was ${switchedLeadership ? "" : "un"}successfully`);

    if (!switchedLeadership) {
      return false;
    }

    // If clan leadership transfer was successful
    await this.getClient().joinClan(targetClan);

    return (await this.getClient().myClan()) === targetClan.id;
  }

  async attemptCage(message: ChatMessage, targetClan: KoLClan): Promise<void> {
    const autoEscapeMessage = this.getSettings().whiteboardMessageAutoEscape;

    this._cagebot.setCagedStatus(false, {
      clan: targetClan,
      requester: message.who,
      started: Date.now(),
      apiResponses: message.apiRequest,
      autoRelease:
        autoEscapeMessage &&
        (await this._cagebot.getClient().getClanWhiteboard()).text.includes(autoEscapeMessage)
          ? true
          : false,
    });

    await this.getClient().useChatMacro("/listenon Hobopolis");
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
    let triedToRescue: boolean = false;
    await updateWhiteboard(this._cagebot, true);

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

        // Here we simply choose a choice, which I believe adds our caging to the clan logs which isn't really noteworthy.
        await this.getClient().visitUrl("choice.php", {
          whichchoice: 211,
          option: 2,
        });

        if (escapeCageToOpenGratesAndValves()) {
          console.log(`Escaping cage to continue opening grates and twisting valves!`);
          await this._cagebot.chewOut(true);
          estimatedTurnsSpent += 10;
          timesChewedOut++;
          caged = false;
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
        // Funny enough, this is not a free turn. But we're going to try once to release any trapped clanmates.

        // 2 = Fight a C. H. U. M.
        // 3 = Rescue
        const option = triedToRescue ? 2 : 3;
        // Always set this to true so follow up encounters to this NC will result in a fight.
        triedToRescue = true;

        await this.getClient().visitUrl("choice.php", {
          whichchoice: 199,
          option: option,
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
        autoRelease:
          this._cagebot.getCageTask() && this._cagebot.getCageTask()?.autoRelease ? true : false,
      });

      console.log(`Successfully caged in clan ${targetClan.name}. Reporting success.`);

      if (!message.apiRequest) {
        let toSend = `Clang! I am now caged in ${targetClan.name}.`;

        if (this._cagebot.getCageTask() && this._cagebot.getCageTask()?.autoRelease) {
          toSend +=
            ' I will escape when you pass through the sewers, or you can release me later by whispering "escape" to me.';
        } else {
          toSend += ' Release me later by whispering "escape" to me.';
        }

        await this.getClient().sendPrivateMessage(message.who, toSend);
      }

      await this._cagebot.saveSettings();
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

      await updateWhiteboard(this._cagebot, this._cagebot.isCaged());
    }

    const endAdvs = (await this.getClient().getStatus()).adventures;
    const spentAdvs = totalTurnsSpent + (currentAdventures - endAdvs);

    if (estimatedTurnsSpent + totalTurnsSpent != spentAdvs) {
      console.log(
        `We estimated ${estimatedTurnsSpent} + ${totalTurnsSpent} turns spent, ${spentAdvs} turns were actually spent.`
      );
    } else {
      console.log(`We spent ${spentAdvs} turns in the process, we have ${endAdvs} turns remaining`);
    }

    console.log(
      `The clan has ${gratesOpened + gratesFoundOpen} / 20 grates open, ${
        valvesTwisted + valvesFoundTwisted
      } / 20 valves twisted.`
    );

    if (message.apiRequest) {
      const hoboStatus: ExploredResponse = {
        type: "explored",
        caged: this._cagebot.isCaged(),
        advsUsed: spentAdvs,
        advsLeft: endAdvs,
        grates: gratesOpened,
        totalGrates: gratesOpened + gratesFoundOpen,
        valves: valvesTwisted,
        totalValves: valvesTwisted + valvesFoundTwisted,
        chews: timesChewedOut,
      };

      await this.getClient().sendPrivateMessage(message.who, toJson(hoboStatus));
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

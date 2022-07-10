```
  _____                 _           _
 / ____|               | |         | |
| |     __ _  __ _  ___| |__   ___ | |_
| |    / _` |/ _` |/ _ \ '_ \ / _ \| __|
| |___| (_| | (_| |  __/ |_) | (_) | |_
 \_____\__,_|\__, |\___|_.__/ \___/ \__|
              __/ |
             |___/
```

Cagebot is an automatic hobopolis cagebaiting bot for Kingdom of Loathing
operated wholly through ingame whispers.

## IMPORTANT NOTE

**HEED THE NOTICE ON THE FOURTH WALL**. If you are operating Cagebot, do NOT, under any circumstances, enter any hobopolis instance to which it has a whitelist on any other account. Failure to heed this warning may result in your accounts being disabled. You have been warned.

## INSTALLATION

In order to install cagebot, you will need node.js and npm installed.
These can be found [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm).
Once you have those, navigate to the root directory of this project and
execute the following:

```
npm ci
npm run build
```

## OUT OF GAME SETUP

In order to function, Cagebot requires exclusive access to a character
that is at least level 3 and has passed the trial of literacy. To give
Cagebot access to a character, put its username and password into the
file named '.env' in the root directory of this project (alongside
package.json). This file should be in the form:

```
  KOL_USER='Cagebot'
  KOL_PASS='Cagebot P4ssw0rD'
```

You will also want the `Settings.json` file, however you can override the settings in the .env file, such as `maintainAdventures='80'`

## AUTOATTACK MACRO

You will require an autoattack with the name CAGEBOT (all caps) that at the minimum, reads runaway;repeat

The CombatMacro.txt included in this project has a combat macro you're recommended to use, especially if you're going for the complicated setup.

If your account has means of running freely, feel free to add them too, but I take no responsibility for failures.
If you need to tiebreak equipment, +noncombat rate is nice too.

## INGAME SETUP COMPLICATED

This takes longer to setup, but is more rewarding as the bot can become fully self sustaining.
This is also the recommended setup if you set the bot to open all grates and valves.

The minimum here is to grab the familiar Lil' Barrel Mimic, regenerate at least 10 MP/fight, and to have the cleesh skill.
This requires level 9 at minumum.

You then have the option to run -combat gear, this is optional but is great for opening grates and valves while trying to be caged.
It is also extremely recommended, if you're enabling the option to open everything. You'll run into issues if you don't run some source of -combat.

For MP Regeneration, an easy source is nurse's hat for 10-15.

Combat %, three accessories are: Bram's Choker, Ring of Conflict, Red Shoe
Weapon: Rusted-out Shooting' Iron

The last piece of equipment isn't so easy, but you can pick up another -5% combat in the Haunted Ballroom NC for a total of -25%.
https://kol.coldfront.net/thekolwiki/index.php/Strung-Up_Quartet

If you don't want to do that, or want that extra -1% combat. Then the best solution here would be acquiring the shirt or pants from the outfit Xiblaxian Stealth Suit.
This however, can be expensive to acquire.

You will also optionally want to pick up a Tuxedo Shirt for more adventures from booze.

And finally, you want to get as much +adv as you can.
A clockwork maid (Recommended to buy from a no-limit store), and perhaps a pagoda. Equipment wise, you have the offhand 'ancient calendar', and shirt 'Shoe Ad T-Shirt'

## INGAME SETUP SIMPLE

To set up your multi, please have it idle with as much +adv rollover gear
on as possible, and at least 1 hp regen/fight. Whatsian Ionic Pliers in
the offhand are recommended as a cheap and plentiful option for this.

Manually stock bot with the items below for consumption.
Bot must be at least the associated level to consume these items.
Currently bot will not buy these, only uses from inventory.

- Fleetwood mac 'n' cheese (Level 8)
- Crimbo pie (Level 7)
- Psychotic Train wine (Level 11)
- Middle of the Road™ brand whiskey (No level requirement)

## RUNNING

To run cagebot, either run `npm run start` in the root directory, or just `node dist/index.js`, both are equivalent.

## USAGE

Cagebot is used by sending in-game whispers to the account with which it is associated. (To do this, enter `/w [accountname] [command]` into the in-game chat.) The commands understood by Cagebot are as follows:

- `cage [clanname]`: If cagebot is whitelisted to a clan with the supplied name and not presently caged, it whitelists into that clan and attempts to get caged in its hobopolis. This command will fail if:
  - Cagebot is already in a cage
  - Cagebot does not have a whitelist to any clans with the supplied name.
  - Cagebot is whitelisted to multiple clans with the supplied name (for example, if it is provided `Phill` and has whitelists to both `Phill's Good Clan` and `Phill's Bad Clan`
  - Cagebot does not have sufficient clan permissions to adventure in hobopolis in the specified clan.
  - Hobopolis is not open in the specified clan.
  - Cagebot falls to eleven or fewer adventures remaining.
- `escape`: If cagebot is presently caged, and the person sending the `escape` command is the one who sent the original `cage` command, it attempts to free itself from the cage. If it has been released via The Former Or The Ladder, it will escape without spending turns, otherwise, it spends ten adventures to chew out of the cage.
- `release`: As escape, attempts to escape from the cage it is presently in, however this can be used by anyone, not just the original sender of the `cage` command. The `release` command can only be used if cagebot has been caged for at least an hour (to prevent cagebot getting stuck due to the original cager logging off for the day, for example), or if cagebot cannot ascertain who initially caged it (for example, because the bot was restarted while in a cage)
- `status`: Returns the current status of cagebot. Specifically:
  - Whether it is in a cage.
  - If so, at whose request, and for how long.
  - Whether the release command is usable, and if not, how long until it will be.
  - How many adventures it has remaining.
- `help`: Returns a help message detailing all of the above commands.
- `diet`: More of a debug command, this tells the requester the current status of the bot's diet. How much food and drink it has remaining. Currently, the api response will return more information.

## APIs

Cagebot has as part of its extra functionality the ability to respond to messages in a json format which is easier for scripts to manage.

Each response should not have any spaces in them, which sidesteps the issue with KoL injecting spaces into long strings as an interesting workaround for wrapped messages.
So to parse a json response, the user is expected to strip any spaces from the message before attempting to parse it.

A json response can be requested by use of appending .api to the following, `cage, status, escape, release, diet`
The different responses can be seen in utils/JsonResponses.ts

If a caging is requested through an .api request, then the unbaited by a third party warning will be sent as a json string.

## Whiteboard

If the bot has write access to the clan dungeon's whiteboard, then it will edit the whiteboard if it detects the whiteboard cage/uncage strings as defined in the cagebot's config.

Be aware however that if you modify the default whiteboard messages of the bot, you will need to account for html entity encoding, which would need a third party library introduced.

So editing the clan's whiteboard to contain the uncaged message, will have the cagebot edit the whiteboard when a caging is requested to note that it's been caged. And edit again to the uncaged message when it fails to be caged, or is released.

The whiteboard message does not need to consist solely of the cagebot message, but the exact message is case sensitive.

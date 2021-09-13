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

## INSTALLATION
In order to install cagebot, you will need node.js and npm installed. 
These can be found [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm). 
Once you have those, navigate to the root directory of this project and
execute the following:

```
npm install
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

## INGAME SETUP
To set up your multi, please have it idle with as much +adv rollover gear
on as possible, amd at least 1 hp regen/fight. Whatsian Ionic Pliers in
the offhand are recommended as a cheap and plentiful option for this.

You will also require an autoattack with the name CAGEBOT (all caps) that
reads "runaway;repeat". If your account has means of running freely,
feel free to add them too, but I take no responsibility for failures.
If you need to tiebreak equipment, +noncombat rate is nice too.

## RUNNING
To run cagebot, either run `npm run start` in the root directory, or just `node dist/index.js`, both are equivalent.

export type CageTask = {
  requester: KoLUser;
  clan: KoLClan;
  started: number;
  apiResponses: boolean;
};

export type Diet = {
  type: "food" | "drink";
  id: number; // Item ID
  name: string; // Name
  level: number; // Level required to consume
  fullness: number; // Full/Drunk of the item
  estAdvs: number; // Underestimate of the adventures given
};

export type HoboStatus = "Diving" | "Caged" | "Releasable";
export type RequestStatus = "Accepted" | "Busy" | "Error" | "Seen" | "Issue" | "Notification";

export type BusyStatus = {
  elapsed?: number; // Seconds in current task, absent if we don't know
  player?: number; // Who requested the task, absent if we don't know
  clan?: number; // Clan we're trapped in, absent if not caged or we don't know
  state: HoboStatus; // If we're currently sewer diving, caged and requester can't release, or releasable
};

export type JsonStatus = {
  advs: number; // Adventures remaining
  full: number; // Current fullness used
  maxFull: number; // Max fullness, absent if we don't know
  drunk: number; // Current liver used
  maxDrunk?: number; // Max liver, absent if we don't know
  caged: boolean; // Just so you can parse it quickly without checking the 'status'
  status?: BusyStatus; // If absent, means not doing anything
};

export type DietStatus = {
  possibleAdvsToday: number; // Possible adventures we can get from our diet
  food: number; // Count of total fullness our current supply can provide
  fullnessAdvs: number; // Total adventures our food would give
  drink: number; // Count of total drunkness our current supply can provide
  drunknessAdvs: number; // Total adventures our drinks would give
};

export type RequestResponse = {
  status: RequestStatus; // Used when its a request that is possibly blocking
  details: string;
};

export type ExploredStatus = {
  caged: boolean; // If we're caged in the end
  advsUsed: number; // Adventures taken
  advsLeft: number; // Adventures remaining
  grates: number; // Grates opened
  totalGrates: number; // Total grates open
  valves: number; // Valves twisted
  totalValves: number; // Total valves twisted
  chews: number; // Amount of cages chewed out
};

export type Settings = {
  maintainAdventures: number;
  openEverything: boolean;
  openEverythingWhileAdventuresAbove: number;
  whiteboardCaged: string;
  whiteboardUncaged: string;
};

export type KOLCredentials = {
  sessionCookies: string;
  pwdhash: string;
};

export type KoLUser = {
  name: string;
  id: string;
};

export type KOLMessage = {
  who?: KoLUser;
  type?: string;
  msg?: string;
  link?: string;
  time: string;
};

export type PrivateMessage = {
  who: KoLUser;
  msg: string;
  apiRequest: boolean;
  reply: (message: string) => Promise<void>;
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

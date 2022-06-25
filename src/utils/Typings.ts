export type CageTask = {
  requester: KoLUser;
  clan: KoLClan;
  started: number;
  apiResponses: boolean;
};

export type SavedSettings = {
  validAtTurn: number;
  maxDrunk: number;
  cageTask?: CageTask;
};

export type Diet = {
  type: "food" | "drink";
  id: number; // Item ID
  name: string; // Name
  level: number; // Level required to consume
  fullness: number; // Full/Drunk of the item
  estAdvs: number; // Underestimate of the adventures given
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
  turnsPlayed: number;
  adventures: number;
  full: number;
  drunk: number;
  rollover: number;
  equipment: Map<EquipSlot, number>;
  familiar?: number;
  meat: number;
  level: number;
};

export type CageTask = {
  requester: KoLUser;
  clan: KoLClan;
  started: number;
  apiResponses: boolean;
  autoRelease: boolean;
};

export type ClanWhiteboard = {
  text: string;
  editable: boolean;
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
  whiteboardMessageCaged?: string;
  whiteboardMessageUncaged?: string;
  whiteboardMessageAutoEscape?: string;
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
  channel: string;
  time: string;
};

export type ChatMessage = {
  private: boolean;
  who: KoLUser;
  msg: string;
  apiRequest: boolean;
  reply: (message: string) => Promise<void>;
};

export type KoLClan = {
  name: string;
  id: string;
};

export type CombatMacro = {
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

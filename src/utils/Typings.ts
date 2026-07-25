export type CageTask = {
  requester: KoLUser;
  clan: KoLClan;
  started: number;
  apiResponses: boolean;
  autoRelease: boolean;
};

export type SavedSettings = {
  validAtTurn: number;
  maxDrunk: number;
  cageTask?: CageTask;
  knownSkills: number[];
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
  whiteboardMessageCaged?: string;
  whiteboardMessageUncaged?: string;
  whiteboardMessageAutoEscape?: string;
  delayBetweenClanRepeats?: number;
};

export type LastClanRequest = {
  user: KoLUser;
  clan: KoLClan;
  date: number;
  expiresAfter: number;
};

export type KoLUser = {
  name: string;
  id: number;
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
  id: number;
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
  | "container"
  | "cardsleeve";

export type KoLStatus = {
  turnsPlayed: number;
  adventures: number;
  full: number;
  drunk: number;
  rollover: number;
  hp: number;
  mp: number;
  maxHP: number;
  maxMP: number;
  equipment: Map<EquipSlot, number>;
  familiar?: number;
  level: number;
  effects: KoLEffect[];
};

export type KoLEffect = {
  name: string;
  duration: number;
  id: number;
};

export type KoLSkill = {
  name: string;
  skillId: number;
  effectId: number;
  mpCost: number;
};

export type BuffySkill = {
  name: string;
  effectId: number;
  mpCost: number;
};

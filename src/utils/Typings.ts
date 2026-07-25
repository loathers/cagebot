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

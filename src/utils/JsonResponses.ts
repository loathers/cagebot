export type HoboStatus = "Diving" | "Caged" | "Releasable";
export type RequestStatus = "Accepted" | "Busy" | "Error" | "Seen" | "Issue" | "Notification";
export type RequestStatusDetails =
  | "already_in_use"
  | "rollover"
  | "invalid_clan"
  | "already_caged"
  | "clan_ambiguous"
  | "not_whitelisted"
  | "unsuccessful_whitelist"
  | "no_hobo_access"
  | "doing_cage"
  | "lack_barrel_edibles"
  | "lack_edibles:<Item Ids>"
  | "your_clan_unbaited"
  | "remember_to_unbait";

export type BusyResponse = {
  elapsed?: number; // Seconds in current task, absent if we don't know
  player?: number; // Who requested the task, absent if we don't know
  clan?: number; // Clan we're trapped in, absent if not caged or we don't know
  /**
   * Diving = If we're currently sewer diving
   *
   * Caged = Caged and requester can't release
   *
   * Releasable = Caged, but requester can release
   */
  state: HoboStatus;
};

export type StatusResponse = {
  type: "status";
  advs: number; // Adventures remaining
  full: number; // Current fullness used
  maxFull: number; // Max fullness, absent if we don't know
  drunk: number; // Current liver used
  maxDrunk?: number; // Max liver, absent if we don't know for sure. Best assumed 14.
  caged: boolean; // Just so you can parse it quickly without checking the 'status'
  status?: BusyResponse; // If absent, means not doing anything
};

export type DietResponse = {
  type: "diet";
  possibleAdvsToday: number; // Possible adventures we can get from our diet
  food: number; // Count of total fullness our current supply can provide
  fullnessAdvs: number; // Total adventures our food would give
  drink: number; // Count of total drunkness our current supply can provide
  drunknessAdvs: number; // Total adventures our drinks would give
};

export type RequestResponse = {
  type: "notify";
  status: RequestStatus; // Used when its a request that is possibly blocking
  details?: string; // The details about why we sent this response
};

export type ExploredResponse = {
  type: "explored";
  caged: boolean; // If we're caged in the end
  advsUsed: number; // Adventures taken
  advsLeft: number; // Adventures remaining
  grates: number; // Grates opened
  totalGrates: number; // Total grates open
  valves: number; // Valves twisted
  totalValves: number; // Total valves twisted
  chews: number; // Amount of cages chewed out
};

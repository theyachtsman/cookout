import type { PitDurationKey, Round, RoundSummary } from "@cookout/shared";

/** Shared client shapes for The Pit API (mirrors apps/server pit routes). */
export interface PitPoolView {
  pot: number;
  participants: number;
  carryIn: number;
}

export interface PitCard {
  round: Round;
  prediction: PitPoolView;
  trading: PitPoolView;
  summary: RoundSummary | null;
  mcap: number;
}

export interface PitDurationDef {
  key: PitDurationKey;
  name: string;
  icon: string;
  minutes: number;
  tagline: string;
}

export interface PitConfigView {
  predictionFee: number;
  tradingFee: number;
  startingStack: number;
  maxConcurrent: number;
  durations: PitDurationDef[];
}

export interface PitFeed {
  live: PitCard[];
  lobby: PitCard[];
  queue: PitCard[];
  results: PitCard[];
  carry: { prediction: number; trading: number };
  config: PitConfigView;
}

/** Short pETH formatter used across the Pit UI. */
export const pdotEth = (n: number, dp = 2): string => `${n.toFixed(dp)} pETH`;

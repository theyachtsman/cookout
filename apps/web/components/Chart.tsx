"use client";

import type { Candle, Trade } from "@cookout/shared";
import { api } from "../lib/api";
import { ChartCanvas } from "./ChartCanvas";

/**
 * Live round chart — the real product wrapper around the shared ChartCanvas
 * renderer, adding trader-tag resolution from the API for the big-trade bubbles.
 * (The landing-page demo renders the same ChartCanvas with simulated data, so
 * the demo chart is a pixel-identical representation of the real one.)
 */
interface Props {
  candles: Candle[];
  trades: Trade[];
  livePrice?: number;
  openPrice?: number;
  supply?: number;
  bigTradeEth?: number;
  cooking?: boolean;
  endReason?: string;
  graduated?: boolean;
  /** USD peg so the live tag shows $ market cap. */
  ethUsd?: number;
  /** The viewer's address: their own trades pin as lime-ringed bubbles. */
  highlightAddress?: string;
}

export function Chart(props: Props) {
  return (
    <ChartCanvas
      {...props}
      showTimeframes
      resolveTag={(address, tag) => {
        api<{ displayName?: string; avatarUrl?: string }>(`/api/profile/${address}`)
          .then((p) => {
            if (p.displayName) tag.name = p.displayName;
            if (p.avatarUrl) {
              const img = new Image();
              img.onload = () => (tag.img = img);
              img.src = p.avatarUrl;
            }
          })
          .catch(() => {});
      }}
    />
  );
}

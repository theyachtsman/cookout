/**
 * On-chain round orchestration (Phase 2).
 *
 * The chain is the source of truth for chain-backed rounds; this service is
 * the bridge that (a) creates rounds through the deployed RoundFactory, (b)
 * mirrors chain events into the exact same Round/Trade/PoolState shapes the
 * paper engine produces — so the WS layer, XP, quests, leaderboards, and
 * jackpot bookkeeping all work unchanged — and (c) fires the permissionless
 * settle()/resolve() transactions at the right times.
 *
 * Money never flows through the server for these rounds: players trade from
 * their own wallets against the per-round contracts. The operator key only
 * pays gas for createRound/settle/resolve.
 *
 * Config (all required to enable, except scale):
 *   CHAIN_RPC          e.g. https://rpc.testnet.chain.robinhood.com
 *   CHAIN_ID           e.g. 46630
 *   CHAIN_FACTORY      deployed RoundFactory address
 *   CHAIN_OPERATOR_KEY hex private key that pays gas (testnet: throwaway)
 *   CHAIN_SCALE        multiplier on the tier configs' ETH sizes (default
 *                      0.01 so faucet-funded testnet wallets can play)
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatEther,
  http,
  parseAbi,
  parseEther,
  type Address as HexAddress,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BOND_TARGET_USD, TIER_CONFIGS } from "@cookout/shared";
import type { AuctionIntent, AuctionResult, Round, RiskTier, TokenConcept } from "@cookout/shared";
import type { RoundEngine } from "./engine.js";
import { Err } from "./engine.js";
import type { Store } from "./store.js";

const FACTORY_ABI = parseAbi([
  "function createRound((string name,string symbol,uint256 totalSupply,uint64 queueClosesAt,uint64 endTime,uint256 auctionMaxRaiseWei,uint16 auctionFeeBps,uint16 tradeFeeBps,uint256 mcapTargetWei,uint256 graduationMcapWei,uint256 graduationMinVolumeWei,uint256 graduationMinHolders,address feeRecipient,address creator) p) payable returns (address,address,address)",
  "event RoundCreated(uint256 indexed id, address indexed creator, address token, address pool, address auction)",
]);

const AUCTION_ABI = parseAbi([
  "event IntentSubmitted(uint256 indexed id, address indexed who, uint256 amount, uint256 maxPriceWad)",
  "event IntentCancelled(uint256 indexed id, address indexed who, uint256 amount)",
  "event Settled(uint256 clearingPriceWad, uint256 totalRaisedWei, uint256 totalTokensSold, uint256 eligibleDemandWei)",
  "function settle()",
  "function settled() view returns (bool)",
  "function clearingPriceWad() view returns (uint256)",
  "function totalRaisedWei() view returns (uint256)",
  "function settledFillWei() view returns (uint256)",
  "function totalTokensSold() view returns (uint256)",
  "function eligibleDemandWei() view returns (uint256)",
]);

const POOL_ABI = parseAbi([
  "event Bought(address indexed who, uint256 ethIn, uint256 tokensOut, uint256 fee)",
  "event Sold(address indexed who, uint256 tokensIn, uint256 ethOut, uint256 fee)",
  "event Resolved(bool graduated, uint256 finalMcapWei, uint256 redemptionPriceWad)",
  "function resolve()",
  "function phase() view returns (uint8)",
  "function endTime() view returns (uint64)",
  "function getReserves() view returns (uint256, uint256)",
]);

/** Minimal structural views of the viem clients (only the methods this
 *  service uses). The repo has two viem copies (hardhat brings its own), and
 *  their full generic client types are "unrelated" to tsc — structural
 *  typing sidesteps that while keeping every call site checked. */
interface PubClient {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: { address: HexAddress; fromBlock: bigint; toBlock: bigint }): Promise<Log[]>;
  readContract(args: {
    address: HexAddress;
    abi: unknown;
    functionName: string;
  }): Promise<unknown>;
  waitForTransactionReceipt(args: {
    hash: `0x${string}`;
  }): Promise<{ blockNumber: bigint; logs: Log[] }>;
}
interface WalClient {
  writeContract(args: {
    chain: unknown;
    account: unknown;
    address: HexAddress;
    abi: unknown;
    functionName: string;
    value?: bigint;
    args?: unknown[];
  }): Promise<`0x${string}`>;
}

/** Settle/resolve are only sent this many ms after the on-chain deadline, so
 *  the chain's own clock has certainly passed it. */
const DEADLINE_SLACK_MS = 5_000;
/** Extra seconds added to the on-chain endTime beyond queueClose+duration so
 *  a slow settle() doesn't eat live-trading time. */
const SETTLE_SLACK_S = 60;

const wad = (x: bigint): number => Number(formatEther(x));

export class ChainService {
  readonly enabled: boolean;
  readonly scale: number;
  private pub!: PubClient;
  private wallet!: WalClient;
  private account!: ReturnType<typeof privateKeyToAccount>;
  private factory!: HexAddress;
  private chain!: ReturnType<typeof defineChain>;
  private busy = false;
  /** Per-round in-flight action guard (settle/resolve sent once). */
  private inflight = new Set<string>();

  constructor(
    private store: Store,
    private engine: RoundEngine,
  ) {
    const rpc = process.env.CHAIN_RPC;
    const id = Number(process.env.CHAIN_ID ?? 0);
    const factory = process.env.CHAIN_FACTORY as HexAddress | undefined;
    const key = process.env.CHAIN_OPERATOR_KEY as `0x${string}` | undefined;
    this.scale = Number(process.env.CHAIN_SCALE ?? 0.01);
    this.enabled = Boolean(rpc && id && factory && key);
    if (!this.enabled) return;

    this.chain = defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpc!] } },
    });
    this.pub = createPublicClient({
      chain: this.chain,
      transport: http(rpc),
    }) as unknown as PubClient;
    this.account = privateKeyToAccount(key!);
    this.wallet = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(rpc),
    }) as unknown as WalClient;
    this.factory = factory!;
  }

  get operatorAddress(): string {
    return this.enabled ? this.account.address : "";
  }

  /**
   * Deploy a full on-chain round via the factory and register it with the
   * store using the paper engine's Round shape plus the chain block. ETH
   * sizes in the tier config are multiplied by CHAIN_SCALE.
   */
  async scheduleChainRound(
    concept: TokenConcept,
    tier: RiskTier,
    scheduledAt: number,
    overrides?: Record<string, number>,
  ): Promise<Round> {
    if (!this.enabled) throw new Err(503, "chain service is not configured");
    const s = this.scale;
    const config = { ...TIER_CONFIGS[tier] };
    config.graduationMcap = (BOND_TARGET_USD / this.store.ethUsd) * s;
    config.auctionMaxRaise *= s;
    config.initialEthLiquidity *= s;
    config.graduationMinVolume *= s;
    config.maxPositionEth *= s;
    config.liveMaxPositionEth *= s;
    config.lowVolumeThreshold *= s;
    if (config.mcapTarget) config.mcapTarget *= s;
    if (concept.totalSupply) config.totalSupply = concept.totalSupply;
    // Admin overrides are absolute chain-unit values, applied after scaling
    // (used to run short smoke-test rounds against real testnets).
    if (overrides) Object.assign(config, overrides);
    // On-chain the whole supply seeds the pool (contract invariant).
    config.initialTokenLiquidity = config.totalSupply;

    const queueClosesAtS = Math.floor(
      (scheduledAt + (config.lobbySeconds + config.queueSeconds) * 1000) / 1000,
    );
    const endTimeS = queueClosesAtS + config.maxDurationSeconds + SETTLE_SLACK_S;

    const hash = await this.wallet.writeContract({
      chain: this.chain,
      account: this.account,
      address: this.factory,
      abi: FACTORY_ABI,
      functionName: "createRound",
      value: parseEther(String(config.initialEthLiquidity)),
      args: [
        {
          name: concept.name,
          symbol: concept.symbol,
          totalSupply: parseEther(String(config.totalSupply)),
          queueClosesAt: BigInt(queueClosesAtS),
          endTime: BigInt(endTimeS),
          auctionMaxRaiseWei: parseEther(String(config.auctionMaxRaise)),
          auctionFeeBps: config.auctionFeeBps,
          tradeFeeBps: config.tradeFeeBps,
          mcapTargetWei: parseEther(String(config.mcapTarget ?? 0)),
          graduationMcapWei: parseEther(String(config.graduationMcap)),
          graduationMinVolumeWei: parseEther(String(config.graduationMinVolume)),
          graduationMinHolders: BigInt(config.graduationMinHolders),
          feeRecipient: this.account.address,
          creator: (concept.creatorAddress || this.account.address) as HexAddress,
        },
      ],
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    const created = receipt.logs
      .map((l) => this.tryParse(FACTORY_ABI, l))
      .find((e) => e?.eventName === "RoundCreated");
    if (!created) throw new Err(502, "RoundCreated event missing from receipt");
    const { token, pool, auction } = created.args as {
      token: HexAddress;
      pool: HexAddress;
      auction: HexAddress;
    };

    const round: Round = {
      id: this.store.id(),
      conceptId: concept.id,
      token: {
        name: concept.name,
        symbol: concept.symbol,
        theme: concept.theme,
        artworkUrl: concept.artworkUrl,
      },
      creatorAddress: concept.creatorAddress,
      tier,
      state: "scheduled",
      config,
      scheduledAt,
      chain: {
        chainId: this.chain.id,
        token,
        pool,
        auction,
        createTx: hash,
        lastBlock: Number(receipt.blockNumber),
      },
    };
    concept.status = "scheduled";
    this.store.rounds.set(round.id, round);
    this.store.intents.set(round.id, []);
    return round;
  }

  /** Drive every chain round: mirror events, fire settle/resolve. Async and
   *  self-guarded — call from an interval without awaiting. */
  async tick(now: number): Promise<void> {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    try {
      for (const round of this.store.rounds.values()) {
        if (!round.chain) continue;
        if (round.state === "results" || round.state === "ended") continue;
        try {
          await this.tickRound(round, now);
        } catch (e) {
          console.error(`chain tick round ${round.id}:`, (e as Error).message);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async tickRound(round: Round, now: number): Promise<void> {
    const c = round.chain!;
    const latest = Number(await this.pub.getBlockNumber());
    if (latest <= c.lastBlock && round.state !== "queue_open") return;

    if (round.state === "queue_open" || round.state === "lobby" || round.state === "scheduled") {
      await this.mirrorAuctionPhase(round, latest, now);
    } else if (round.state === "live" || round.state === "settling") {
      await this.mirrorLivePhase(round, latest, now);
    }
    c.lastBlock = Math.max(c.lastBlock, latest);
  }

  private async mirrorAuctionPhase(round: Round, latest: number, now: number): Promise<void> {
    const c = round.chain!;
    const logs = await this.pub.getLogs({
      address: c.auction as HexAddress,
      fromBlock: BigInt(c.lastBlock + 1),
      toBlock: BigInt(latest),
    });
    const intents = this.store.intents.get(round.id)!;
    let dirty = false;
    let settledEvent: { clearingPriceWad: bigint } | undefined;
    for (const log of logs) {
      const ev = this.tryParse(AUCTION_ABI, log);
      if (!ev) continue;
      if (ev.eventName === "IntentSubmitted") {
        const a = ev.args as { id: bigint; who: HexAddress; amount: bigint; maxPriceWad: bigint };
        const intent: AuctionIntent = {
          id: String(a.id),
          roundId: round.id,
          // Arena (burner) wallets credit their owner's profile.
          userAddress: this.store.resolveArenaOwner(a.who),
          ethAmount: wad(a.amount),
          maxPrice: a.maxPriceWad > 0n ? wad(a.maxPriceWad) : undefined,
          submittedAt: now,
        };
        if (!intents.some((i) => i.id === intent.id)) intents.push(intent);
        this.store.trackActivity(intent.userAddress, "auctions_entered", 1, now);
        dirty = true;
      } else if (ev.eventName === "IntentCancelled") {
        const a = ev.args as { id: bigint };
        const idx = intents.findIndex((i) => i.id === String(a.id));
        if (idx !== -1) intents.splice(idx, 1);
        dirty = true;
      } else if (ev.eventName === "Settled") {
        settledEvent = ev.args as { clearingPriceWad: bigint };
      }
    }
    if (dirty) this.engine.emitLobbyPublic(round);

    if (settledEvent) {
      await this.applySettlement(round, now);
      return;
    }

    // Queue closed on-chain? Fire the permissionless settle() once.
    if (
      round.state === "queue_open" &&
      round.queueClosesAt &&
      now >= round.queueClosesAt + DEADLINE_SLACK_MS &&
      !this.inflight.has(`settle:${round.id}`)
    ) {
      this.inflight.add(`settle:${round.id}`);
      round.state = "settling";
      this.engine.emitStatePublic(round);
      try {
        const hash = await this.wallet.writeContract({
          chain: this.chain,
          account: this.account,
          address: c.auction as HexAddress,
          abi: AUCTION_ABI,
          functionName: "settle",
        });
        await this.pub.waitForTransactionReceipt({ hash });
        await this.applySettlement(round, Date.now());
      } catch (e) {
        // Someone else may have settled (it's permissionless) — re-check.
        const isSettled = await this.pub.readContract({
          address: c.auction as HexAddress,
          abi: AUCTION_ABI,
          functionName: "settled",
        });
        if (isSettled) await this.applySettlement(round, Date.now());
        else {
          this.inflight.delete(`settle:${round.id}`);
          round.state = "queue_open";
          throw e;
        }
      }
    }
  }

  /** Read the settled auction + reserves and hand the engine a paper-shaped
   *  AuctionResult (fills recomputed with the contract's own formulas). */
  private async applySettlement(round: Round, now: number): Promise<void> {
    const c = round.chain!;
    const auction = c.auction as HexAddress;
    const read = <T>(
      functionName:
        | "clearingPriceWad"
        | "totalRaisedWei"
        | "settledFillWei"
        | "totalTokensSold"
        | "eligibleDemandWei",
    ) =>
      this.pub.readContract({ address: auction, abi: AUCTION_ABI, functionName }) as Promise<T>;
    const [clearingWad, raisedWei, fillWei, tokensSold, demandWei] = await Promise.all([
      read<bigint>("clearingPriceWad"),
      read<bigint>("totalRaisedWei"),
      read<bigint>("settledFillWei"),
      read<bigint>("totalTokensSold"),
      read<bigint>("eligibleDemandWei"),
    ]);
    const [ethR, tokenR] = (await this.pub.readContract({
      address: c.pool as HexAddress,
      abi: POOL_ABI,
      functionName: "getReserves",
    })) as [bigint, bigint];
    const endTime = (await this.pub.readContract({
      address: c.pool as HexAddress,
      abi: POOL_ABI,
      functionName: "endTime",
    })) as bigint;

    const intents = this.store.intents.get(round.id) ?? [];
    const clearingPrice = wad(clearingWad);
    const fills = intents.map((i) => {
      const eligible =
        fillWei > 0n && (i.maxPrice === undefined || i.maxPrice >= clearingPrice);
      // Same floored pro-rata the contract's claim() pays out.
      const ethFilled = eligible ? (i.ethAmount * wad(raisedWei)) / wad(demandWei) : 0;
      const tokensOut = eligible && wad(fillWei) > 0 ? (wad(tokensSold) * ethFilled) / wad(fillWei) : 0;
      return {
        intentId: i.id,
        userAddress: i.userAddress,
        ethIn: i.ethAmount,
        ethFilled,
        tokensOut,
        refund: i.ethAmount - ethFilled,
      };
    });
    const result: AuctionResult = {
      roundId: round.id,
      clearingPrice,
      totalDemand: intents.reduce((s, i) => s + i.ethAmount, 0),
      totalRaised: wad(raisedWei),
      fillRatio: wad(demandWei) > 0 ? wad(raisedWei) / wad(demandWei) : 0,
      fills,
      poolAfter: {
        ethReserve: wad(ethR),
        tokenReserve: wad(tokenR),
        totalSupply: round.config.totalSupply,
      },
      settledAt: now,
      // For chain rounds the chain itself is the audit trail: anyone can
      // recompute the settlement from the auction's public intents.
      auditHash: `onchain:${c.chainId}:${auction}`,
    };
    const fee = wad(fillWei) - (wad(ethR) - round.config.initialEthLiquidity);
    this.engine.applyChainSettlement(round, result, Math.max(0, fee), Number(endTime) * 1000, now);
  }

  private async mirrorLivePhase(round: Round, latest: number, now: number): Promise<void> {
    const c = round.chain!;
    const logs = await this.pub.getLogs({
      address: c.pool as HexAddress,
      fromBlock: BigInt(c.lastBlock + 1),
      toBlock: BigInt(latest),
    });
    let sawTrade = false;
    let resolved: { graduated: boolean } | undefined;
    for (const log of logs) {
      const ev = this.tryParse(POOL_ABI, log);
      if (!ev) continue;
      if (ev.eventName === "Bought") {
        const a = ev.args as { who: HexAddress; ethIn: bigint; tokensOut: bigint; fee: bigint };
        this.engine.applyChainTrade(
          round,
          this.store.resolveArenaOwner(a.who),
          "buy",
          wad(a.ethIn),
          wad(a.tokensOut),
          wad(a.tokensOut) > 0 ? wad(a.ethIn) / wad(a.tokensOut) : 0,
          wad(a.fee),
          now,
        );
        sawTrade = true;
      } else if (ev.eventName === "Sold") {
        const a = ev.args as { who: HexAddress; tokensIn: bigint; ethOut: bigint; fee: bigint };
        this.engine.applyChainTrade(
          round,
          this.store.resolveArenaOwner(a.who),
          "sell",
          wad(a.ethOut),
          wad(a.tokensIn),
          wad(a.tokensIn) > 0 ? wad(a.ethOut) / wad(a.tokensIn) : 0,
          wad(a.fee),
          now,
        );
        sawTrade = true;
      } else if (ev.eventName === "Resolved") {
        resolved = ev.args as { graduated: boolean };
      }
    }

    if (sawTrade || resolved) {
      const [ethR, tokenR] = (await this.pub.readContract({
        address: c.pool as HexAddress,
        abi: POOL_ABI,
        functionName: "getReserves",
      })) as [bigint, bigint];
      if (round.pool) {
        round.pool.ethReserve = wad(ethR);
        round.pool.tokenReserve = wad(tokenR);
      }
    }

    if (resolved) {
      this.engine.applyChainEnd(round, resolved.graduated, now);
      return;
    }

    // Past the on-chain end time and still live? Fire permissionless resolve().
    if (
      round.state === "live" &&
      round.endsAt &&
      now >= round.endsAt + DEADLINE_SLACK_MS &&
      !this.inflight.has(`resolve:${round.id}`)
    ) {
      this.inflight.add(`resolve:${round.id}`);
      try {
        const hash = await this.wallet.writeContract({
          chain: this.chain,
          account: this.account,
          address: c.pool as HexAddress,
          abi: POOL_ABI,
          functionName: "resolve",
        });
        await this.pub.waitForTransactionReceipt({ hash });
        // The Resolved event lands in a block we haven't scanned; next tick
        // mirrors it (lastBlock cursor is behind the receipt's block).
      } catch (e) {
        const phase = (await this.pub.readContract({
          address: c.pool as HexAddress,
          abi: POOL_ABI,
          functionName: "phase",
        })) as number;
        this.inflight.delete(`resolve:${round.id}`);
        // 2 = Graduated, 3 = Redeem — someone else resolved; next tick mirrors.
        if (phase < 2) throw e;
      }
    }
  }

  private tryParse(
    abi: ReturnType<typeof parseAbi>,
    log: Log,
  ): { eventName: string; args: unknown } | undefined {
    try {
      return decodeEventLog({ abi, data: log.data, topics: log.topics }) as {
        eventName: string;
        args: unknown;
      };
    } catch {
      return undefined;
    }
  }
}

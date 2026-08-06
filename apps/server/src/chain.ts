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
  encodeAbiParameters,
  keccak256,
  toHex,
  parseAbi,
  parseEther,
  type Address as HexAddress,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { AuctionIntent, AuctionResult, BattleTier, PitChain, Round, RiskTier, TokenConcept } from "@cookout/shared";
import type { RoundEngine } from "./engine.js";
import { Err } from "./engine.js";
import type { Store } from "./store.js";

/** Operator gas floor. Below this the Command Center warns: an empty operator
 *  cannot settle or resolve, and unsettled escrow is stuck escrow. */
export const OPERATOR_MIN_BALANCE_ETH = 0.05;

const FACTORY_ABI = parseAbi([
  "function createRound((string name,string symbol,uint256 totalSupply,uint64 queueClosesAt,uint64 endTime,uint256 auctionMaxRaiseWei,uint16 auctionFeeBps,uint16 tradeFeeBps,uint256 mcapTargetWei,uint256 graduationMcapWei,uint256 graduationMinVolumeWei,uint256 graduationMinHolders,uint256 virtualEthReserve,address feeRecipient,address creator,address feeDestination) p) payable returns (address,address,address)",
  "event RoundCreated(uint256 indexed id, address indexed creator, address token, address pool, address auction, address locker, address feeSplitter)",
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

/** Chains we run on, by id — used for display only. */
const KNOWN_CHAIN_NAMES: Record<number, string> = {
  4663: "Robinhood Chain",
  46630: "Robinhood Chain Testnet",
};

/** Means "pay the creator's own address" to the factory. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const PIT_FACTORY_ABI = parseAbi([
  "function createPools(bytes32 matchId, uint16 predictionFeeBps, uint16 battleFeeBps, uint256[3] entryFees, uint64 closesAt, uint64 refundAfter) returns (address,address[3])",
  "function poolsFor(bytes32) view returns (address prediction, address battleEasy, address battleMedium, address battleHard, uint64 createdAt)",
]);

const PIT_POOL_ABI = parseAbi([
  "function resolve(uint8 result)",
  "function closeStaking()",
  "function stakeOf(address, uint8) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function resolved() view returns (bool)",
  "event Staked(address indexed who, uint8 indexed call, uint256 amount)",
]);

const PIT_BATTLE_ABI = parseAbi([
  "function resolve(address winner)",
  "function closeStaking()",
  "function buyIn(address) view returns (uint256)",
  "function pot() view returns (uint256)",
  "function entrants() view returns (uint256)",
  "function resolved() view returns (bool)",
  "event Entered(address indexed who, uint256 amount, uint256 pot)",
]);

const POOL_ABI = parseAbi([
  "event Bought(address indexed who, uint256 ethIn, uint256 tokensOut, uint256 fee)",
  "event Sold(address indexed who, uint256 tokensIn, uint256 ethOut, uint256 fee)",
  "event Resolved(bool graduated, uint256 finalMcapWei, uint256 redemptionPriceWad)",
  "function resolve()",
  "function migrate() returns (uint256)",
  "function phase() view returns (uint8)",
  "function migrated() view returns (bool)",
  "function endTime() view returns (uint64)",
  "function getReserves() view returns (uint256, uint256)",
  "function feesAccrued() view returns (uint256)",
  "function claimFees()",
]);

/** Minimal structural views of the viem clients (only the methods this
 *  service uses). The repo has two viem copies (hardhat brings its own), and
 *  their full generic client types are "unrelated" to tsc — structural
 *  typing sidesteps that while keeping every call site checked. */
interface PubClient {
  getBlockNumber(): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getBalance(args: { address: HexAddress }): Promise<bigint>;
  getLogs(args: { address: HexAddress; fromBlock: bigint; toBlock: bigint }): Promise<Log[]>;
  readContract(args: {
    address: HexAddress;
    abi: unknown;
    functionName: string;
    args?: readonly unknown[];
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
  /** Deployed PitPoolFactory, when CHAIN_PIT_FACTORY is configured. */
  private pitFactory?: HexAddress;
  /** Deployed GoonSquadNFT, when CHAIN_NFT is configured. */
  private nftContract?: HexAddress;
  /**
   * Signs mint vouchers. Deliberately separate from the operator key.
   *
   * The operator pays gas from a hot wallet that is topped up and rotated;
   * this one authorises minting and is immutable in the contract, so it can
   * never be rotated without invalidating every voucher already issued. They
   * want different lifetimes, so they are different keys. Falls back to the
   * operator only so the feature works before one is configured — the startup
   * log says so, loudly, because on mainnet that would mean the gas key can
   * also print the collection.
   */
  private nftSigner?: ReturnType<typeof privateKeyToAccount>;
  private pub!: PubClient;
  private wallet!: WalClient;
  private account!: ReturnType<typeof privateKeyToAccount>;
  private factory!: HexAddress;
  private chain!: ReturnType<typeof defineChain>;
  private busy = false;
  /** Last operator gas-balance check, so the poll costs one RPC a minute. */
  private lastBalanceCheck = 0;
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
    const pf = process.env.CHAIN_PIT_FACTORY;
    if (pf && /^0x[0-9a-fA-F]{40}$/.test(pf)) this.pitFactory = pf as HexAddress;
    const nft = process.env.CHAIN_NFT;
    if (nft && /^0x[0-9a-fA-F]{40}$/.test(nft)) this.nftContract = nft as HexAddress;
    const signerKey = process.env.CHAIN_NFT_SIGNER_KEY;
    if (signerKey && /^0x[0-9a-fA-F]{64}$/.test(signerKey))
      this.nftSigner = privateKeyToAccount(signerKey as `0x${string}`);
    this.enabled = Boolean(rpc && id && factory && key);
    if (!this.enabled) return;

    this.chain = defineChain({
      id,
      // Shown to players on the docs page, so give it the name they would
      // recognise rather than a slug. Overridable for any chain we have not
      // met yet.
      name: process.env.CHAIN_NAME || KNOWN_CHAIN_NAMES[id] || `chain-${id}`,
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
    const config = this.store.tierConfig(tier);
    config.graduationMcap = this.store.bondTargetEth() * s;
    config.auctionMaxRaise *= s;
    config.curveAnchorEth *= s;
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
      // Nothing. `curveAnchorEth` is the curve's virtual anchor now, not
      // money: it sets the opening price without the house funding it. It used
      // to be sent as msg.value and was unrecoverable — no path in RoundPool
      // returns principal — so every launch cost the platform its seed whether
      // the coin graduated or died.
      value: 0n,
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
          virtualEthReserve: parseEther(String(config.curveAnchorEth)),
          feeRecipient: this.account.address,
          // Chosen by the creator at launch and immutable from here: it is
          // burned into the FeeSplitter this call deploys.
          feeDestination: (concept.feeDestination ?? ZERO_ADDRESS) as HexAddress,
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
      await this.checkOperatorBalance(now);
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

  /**
   * Watch the operator's gas balance.
   *
   * This key pays for createRound, settle and resolve. If it runs dry, rounds
   * stop being created and — worse — stop being settled and resolved, which
   * strands player escrow behind a transaction nobody else is going to send.
   * So it is monitored like the piece of infrastructure it is, and surfaced on
   * the Command Center dashboard rather than discovered when a round hangs.
   */
  private async checkOperatorBalance(now: number): Promise<void> {
    if (now - this.lastBalanceCheck < 60_000) return;
    this.lastBalanceCheck = now;
    try {
      const wei = await this.pub.getBalance({ address: this.account.address });
      const balanceEth = Number(wei) / 1e18;
      const previous = this.store.chainStatus?.balanceEth;
      this.store.chainStatus = {
        operator: this.account.address,
        chainId: this.chain.id,
        balanceEth,
        low: balanceEth < OPERATOR_MIN_BALANCE_ETH,
        checkedAt: now,
      };
      // Log the crossing, not the state, so the audit trail has one line per
      // event instead of one a minute.
      if (balanceEth < OPERATOR_MIN_BALANCE_ETH && (previous ?? Infinity) >= OPERATOR_MIN_BALANCE_ETH)
        this.store.logAdmin(
          "chain",
          `operator ${this.account.address} is low on gas: ${balanceEth.toFixed(4)} ETH ` +
            `(below ${OPERATOR_MIN_BALANCE_ETH}). Round creation, settlement and resolution stop when it empties.`,
        );
    } catch {
      /* a failed balance read must never stop the mirror */
    }
  }

  /**
   * Deploy a Pit match's prize pools.
   *
   * Called when a chain-only Pit match opens its lobby. Failure is not fatal:
   * without pools the match simply has no on-chain money, which the rest of
   * the stack already handles because the paper site runs that way by design.
   * Better a Pit match with no pot than one whose escrow half-exists.
   */
  async createPitPools(
    round: Round,
    opts: {
      /** One entry price per tier, in ladder order: easy, medium, hard. */
      tiers: { tier: BattleTier; usd: number; wei: bigint }[];
      predictionFeeBps: number;
      battleFeeBps: number;
    },
  ): Promise<PitChain | null> {
    if (!this.enabled || !this.pitFactory) return null;
    const pit = round.pit;
    if (!pit) return null;

    // A Pit lobby closes when it fills, which nobody can know now — so this
    // is the DEADLINE by which that must have happened, and the server calls
    // closeStaking() at the real moment. Using scheduledAt here, as this did,
    // deployed a pool that was already closed: every bet reverted.
    const deadline =
      (round.scheduledAt ?? Date.now()) + (pit.queueMaxSeconds ?? 600) * 1000;
    const closesAt = Math.floor(deadline / 1000);
    const refundAfter = closesAt + 86_400;
    const matchId = keccak256(toHex(round.id));

    const hash = await this.wallet.writeContract({
      chain: this.chain,
      account: this.account,
      address: this.pitFactory,
      abi: PIT_FACTORY_ABI,
      functionName: "createPools",
      args: [
        matchId,
        opts.predictionFeeBps,
        opts.battleFeeBps,
        opts.tiers.map((t) => t.wei) as [bigint, bigint, bigint],
        BigInt(closesAt),
        BigInt(refundAfter),
      ],
    });
    await this.pub.waitForTransactionReceipt({ hash });
    const pools = (await this.pub.readContract({
      address: this.pitFactory,
      abi: PIT_FACTORY_ABI,
      functionName: "poolsFor",
      args: [matchId],
    })) as [HexAddress, HexAddress, HexAddress, HexAddress, bigint];
    const [prediction, ...battles] = pools;

    return {
      chainId: this.chain.id,
      predictionPool: prediction,
      battlePools: Object.fromEntries(
        opts.tiers.map((t, i) => [
          t.tier,
          { address: battles[i]!, entryWei: t.wei.toString(), entryUsd: t.usd },
        ]),
      ) as PitChain["battlePools"],
      closesAt: closesAt * 1000,
      refundAfter: refundAfter * 1000,
    };
  }

  /**
   * Shut staking because the match has started.
   *
   * The deadline in the contract is a backstop; this is the real event. Called
   * when the lobby fills, so a blitz that finishes long before the deadline
   * can still be resolved, and nobody can bet on a match already underway.
   */
  async closePitStaking(round: Round): Promise<void> {
    const pc = round.pitChain;
    if (!this.enabled || !pc) return;
    const targets: [string, string, unknown][] = [
      ["prediction", pc.predictionPool, PIT_POOL_ABI],
      ...Object.entries(pc.battlePools).map(
        ([tier, p]) => [`battle ${tier}`, p.address, PIT_BATTLE_ABI] as [string, string, unknown],
      ),
    ];
    for (const [label, address, abi] of targets) {
      try {
        const hash = await this.wallet.writeContract({
          chain: this.chain,
          account: this.account,
          address: address as HexAddress,
          abi,
          functionName: "closeStaking",
        });
        await this.pub.waitForTransactionReceipt({ hash });
      } catch (e) {
        // Not fatal: the deadline still closes it, and resolution tolerates
        // either route. Worth a line because it means late bets are possible.
        this.store.logAdmin(
          "chain",
          `could not close ${label} staking for ${round.token.symbol}: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Post a finished Pit match's outcome to its pools.
   *
   * The one place the platform acts as an oracle. Both calls are idempotent
   * against the chain — the pools refuse a second resolution — so a retry
   * after a dropped receipt cannot pay twice.
   */
  async resolvePitPools(
    round: Round,
    outcome: { call: 1 | 2 | 3; battleWinners?: Partial<Record<BattleTier, string>> },
  ): Promise<void> {
    const pc = round.pitChain;
    if (!this.enabled || !pc) return;

    const post = async (label: string, fn: () => Promise<HexAddress>) => {
      try {
        const hash = await fn();
        await this.pub.waitForTransactionReceipt({ hash });
        this.store.logAdmin("chain", `${label} for ${round.token.symbol} resolved on-chain (${hash})`);
        return hash;
      } catch (e) {
        // Loud, because unresolved pools hold real money. The refund window
        // means players are not trapped, but they should not need it.
        this.store.logAdmin(
          "chain",
          `FAILED to resolve ${label} for ${round.token.symbol}: ${(e as Error).message}. ` +
            `Retry before ${new Date(pc.refundAfter).toISOString()}, after which entrants can refund themselves.`,
        );
        return undefined;
      }
    };

    const tx = await post("prediction pool", () =>
      this.wallet.writeContract({
        chain: this.chain,
        account: this.account,
        address: pc.predictionPool as HexAddress,
        abi: PIT_POOL_ABI,
        functionName: "resolve",
        args: [outcome.call],
      }),
    );

    // Each tier is its own pot, so each gets its own winner — the best PnL
    // among that tier's entrants, not the match's best overall. A tier nobody
    // entered has no winner to name; its refund path covers it, and resolving
    // with a zero address would revert anyway.
    for (const [tier, pool] of Object.entries(pc.battlePools)) {
      const who = outcome.battleWinners?.[tier as BattleTier];
      if (!who) continue;
      await post(`battle pool (${tier})`, () =>
        this.wallet.writeContract({
          chain: this.chain,
          account: this.account,
          address: pool.address as HexAddress,
          abi: PIT_BATTLE_ABI,
          functionName: "resolve",
          args: [who as HexAddress],
        }),
      );
    }
    if (tx) pc.resolvedTx = tx;
  }

  /**
   * What a player has actually escrowed for this match, read from the pools.
   *
   * The server never takes the client's word for a chain entry. It cannot: the
   * stake goes straight from the player's wallet to the contract, so the only
   * honest source is the contract itself. A claim to have staked is worth
   * exactly nothing until this says otherwise.
   */
  async pitStakesOf(
    round: Round,
    address: string,
  ): Promise<{
    prediction: Record<1 | 2 | 3, bigint>;
    battle: Record<BattleTier, bigint>;
  } | null> {
    const pc = round.pitChain;
    if (!this.enabled || !pc) return null;
    const who = address as HexAddress;
    const tiers = Object.entries(pc.battlePools) as [BattleTier, { address: string }][];
    const [g, r, t, ...buyIns] = await Promise.all([
      this.pub.readContract({
        address: pc.predictionPool as HexAddress,
        abi: PIT_POOL_ABI,
        functionName: "stakeOf",
        args: [who, 1],
      }) as Promise<bigint>,
      this.pub.readContract({
        address: pc.predictionPool as HexAddress,
        abi: PIT_POOL_ABI,
        functionName: "stakeOf",
        args: [who, 2],
      }) as Promise<bigint>,
      this.pub.readContract({
        address: pc.predictionPool as HexAddress,
        abi: PIT_POOL_ABI,
        functionName: "stakeOf",
        args: [who, 3],
      }) as Promise<bigint>,
      ...tiers.map(
        ([, p]) =>
          this.pub.readContract({
            address: p.address as HexAddress,
            abi: PIT_BATTLE_ABI,
            functionName: "buyIn",
            args: [who],
          }) as Promise<bigint>,
      ),
    ]);
    return {
      prediction: { 1: g, 2: r, 3: t },
      battle: Object.fromEntries(
        tiers.map(([tier], i) => [tier, buyIns[i] ?? 0n]),
      ) as Record<BattleTier, bigint>,
    };
  }

  /**
   * Sign a mint voucher for a recruit the player owns.
   *
   * The signature is the whole authorisation: the contract mints nothing
   * without one. So this is the only place entitlement is checked, and it is
   * checked against the database — the record of what the crate actually gave
   * them — rather than anything the browser says.
   *
   * Bound to the player's address, the card, this chain and this contract, so
   * a leaked signature cannot be used by anyone else, for anything else, or
   * anywhere else. The contract spends it once.
   */
  async signMintVoucher(
    to: string,
    cardId: string,
    nonce: bigint,
  ): Promise<{ signature: string; contract: string; chainId: number } | null> {
    if (!this.enabled || !this.nftContract) return null;
    const digest = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "string" }, { type: "uint256" }],
        [BigInt(this.chain.id), this.nftContract, to as HexAddress, cardId, nonce],
      ),
    );
    const signature = await (this.nftSigner ?? this.account).signMessage({ message: { raw: digest } });
    return { signature, contract: this.nftContract, chainId: this.chain.id };
  }

  /** The collection contract, when one is configured. */
  get nftAddress(): string | undefined {
    return this.nftContract;
  }

  /**
   * Everything a player needs to verify us themselves.
   *
   * Read from the live config rather than written down anywhere, so the docs
   * page can never advertise an address the site has stopped using — a stale
   * contract link is worse than none, because someone will trust it.
   */
  get publicContracts():
    | {
        chainId: number;
        chainName: string;
        explorer?: string;
        roundFactory: string;
        pitFactory?: string;
        collection?: string;
        protocolFeeWallet?: string;
      }
    | null {
    if (!this.enabled) return null;
    return {
      chainId: this.chain.id,
      chainName: this.chain.name,
      explorer: process.env.CHAIN_EXPLORER || undefined,
      roundFactory: this.factory,
      pitFactory: this.pitFactory,
      collection: this.nftContract,
      protocolFeeWallet: process.env.CHAIN_PROTOCOL_FEE_WALLET || undefined,
    };
  }

  /** The address the contract's `signer` must be set to. Printed at startup so
   *  a mismatch is caught before a player hits a mint that can only revert. */
  get nftSignerAddress(): string | undefined {
    if (!this.enabled) return undefined;
    return (this.nftSigner ?? this.account).address;
  }

  /** True when vouchers are signed by the gas-paying operator key. */
  get nftSignerIsOperator(): boolean {
    return !this.nftSigner;
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
        const a0 = ev.args as { who: HexAddress; amount: bigint };
        this.store.recordChainLedger(this.store.resolveArenaOwner(a0.who), {
          kind: "pull_up",
          eth: -wad(a0.amount),
          symbol: round.token.symbol,
          roundId: round.id,
          txHash: log.transactionHash ?? undefined,
          chainId: c.chainId,
          at: now,
        });
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
        const a1 = ev.args as { who: HexAddress; amount: bigint };
        this.store.recordChainLedger(this.store.resolveArenaOwner(a1.who), {
          kind: "cancel",
          eth: wad(a1.amount),
          symbol: round.token.symbol,
          roundId: round.id,
          txHash: log.transactionHash ?? undefined,
          chainId: c.chainId,
          at: now,
        });
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
    const fee = wad(fillWei) - (wad(ethR) - round.config.curveAnchorEth);
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
        this.store.recordChainLedger(this.store.resolveArenaOwner(a.who), {
          kind: "buy",
          eth: -wad(a.ethIn),
          tokens: wad(a.tokensOut),
          symbol: round.token.symbol,
          roundId: round.id,
          txHash: log.transactionHash ?? undefined,
          chainId: c.chainId,
          at: now,
        });
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
        this.store.recordChainLedger(this.store.resolveArenaOwner(a.who), {
          kind: "sell",
          eth: wad(a.ethOut),
          tokens: wad(a.tokensIn),
          symbol: round.token.symbol,
          roundId: round.id,
          txHash: log.transactionHash ?? undefined,
          chainId: c.chainId,
          at: now,
        });
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
      // Graduated pools migrate to Uniswap v4 and lock their liquidity there.
      // migrate() is permissionless, but permissionless only means anyone MAY
      // fire it — nobody else has a reason to, exactly like settle and resolve.
      if (resolved.graduated) void this.migrateRound(round);
      // Take the round's trade fees. Same reasoning as migrate: claimFees() is
      // a permissionless pull and we are the only party with a reason to pull
      // it, because we are the feeRecipient paying this round's gas. Fires for
      // graduated and failed rounds alike — a round that died still charged
      // trade fees and still cost us four transactions.
      void this.claimRoundFees(round);
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

  /**
   * Collect a finished round's trade fees to the operator wallet.
   *
   * This is what pays for the operator's gas. Every round costs it four
   * transactions — create, settle, resolve, migrate — and the trade fee on
   * that round is its income; the pool names the operator as `feeRecipient`
   * precisely so the two net out. But `claimFees()` is not automatic: it is a
   * permissionless pull, and until this existed nobody pulled it, so every
   * round's fees sat in a finished pool while the wallet that paid for the
   * round only ever went down.
   *
   * Skipped when the fee is worth less than roughly what claiming it costs —
   * spending 40k gas to collect less than 40k gas of fees is just a slower way
   * to run the wallet dry. Uncollected dust stays claimable forever, so a
   * skipped claim loses nothing.
   */
  private async claimRoundFees(round: Round): Promise<void> {
    const c = round.chain;
    if (!c?.pool) return;
    const key = `fees:${round.id}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const accrued = (await this.pub.readContract({
        address: c.pool as HexAddress,
        abi: POOL_ABI,
        functionName: "feesAccrued",
      })) as bigint;
      if (accrued === 0n) return;
      // ~40k gas for the claim; only bother when the fee clears twice that,
      // so collecting is always meaningfully profitable rather than break-even.
      const floor = (await this.pub.getGasPrice()) * 80_000n;
      if (accrued < floor) return;

      const hash = await this.wallet.writeContract({
        chain: this.chain,
        account: this.account,
        address: c.pool as HexAddress,
        abi: POOL_ABI,
        functionName: "claimFees",
      });
      await this.pub.waitForTransactionReceipt({ hash });
      this.store.logAdmin(
        "chain",
        `collected ${formatEther(accrued)} ETH of ${round.token.symbol} trade fees to the operator (${hash})`,
      );
    } catch (e) {
      // Never worth failing a round over. The fees stay claimable by anyone,
      // forever, and the next finished round tries again.
      this.store.logAdmin(
        "chain",
        `fee collection failed for ${round.token.symbol}: ${(e as Error).message}. Still claimable.`,
      );
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Fire the one-way migration to Uniswap v4.
   *
   * Best-effort and self-guarded. A failure here is not a crisis: the pool
   * keeps trading on its own curve exactly as it did before, and migrate() can
   * be called again — by us on the next attempt, or by anyone at all.
   */
  private async migrateRound(round: Round): Promise<void> {
    const c = round.chain!;
    const key = `migrate:${round.id}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const alreadyDone = (await this.pub.readContract({
        address: c.pool as HexAddress,
        abi: POOL_ABI,
        functionName: "migrated",
      })) as boolean;
      if (alreadyDone) return;
      const hash = await this.wallet.writeContract({
        chain: this.chain,
        account: this.account,
        address: c.pool as HexAddress,
        abi: POOL_ABI,
        functionName: "migrate",
      });
      await this.pub.waitForTransactionReceipt({ hash });
      this.store.logAdmin(
        "chain",
        `${round.token.symbol} graduated and migrated to Uniswap v4 — liquidity locked (${hash})`,
      );
    } catch (e) {
      // Worth an operator's attention: the coin graduated but its liquidity is
      // still sitting in our pool rather than locked on Uniswap.
      this.store.logAdmin(
        "chain",
        `migration failed for ${round.token.symbol}: ${(e as Error).message}. The pool keeps trading; migrate() can be retried by anyone.`,
      );
    } finally {
      this.inflight.delete(key);
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArenaToken} from "./ArenaToken.sol";
import {RoundPool} from "./RoundPool.sol";

/// @title BatchAuction — uniform-price opening auction, settled fully on-chain
/// @notice Fairness properties (spec §6), enforced by construction:
///         1. The queue closes at a fixed timestamp, not on order arrival.
///         2. One clearing price for every fill; submission order is irrelevant.
///         3. Oversubscription resolves pro-rata — never price priority,
///            never first-N — so neither speed nor bid size buys position.
///         4. Settlement is one atomic transaction, callable by ANYONE after
///            close: the platform has no privileged role and cannot delay,
///            reorder, or censor it.
///         5. Every intent is public on-chain; the clearing computation is
///            deterministic integer math mirroring the open-source reference
///            (packages/shared/src/auction.ts), so anyone can recompute it.
/// @dev Clearing solves the fixed point A* = min(D(p(A*)), maxRaise) by
///      binary search, where p(A) = A / tokensOut(A·(1-fee)) against the
///      pool's pre-open reserves and D(p) is demand whose limit allows p.
///      O(60·n) — fine for L2 gas at arena queue sizes; claims are pull-based
///      so settlement cost never depends on distributing to n recipients.
contract BatchAuction {
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    /// @notice Floor on intent size. Kills dust intents whose pro-rata token
    ///         fill floors to zero, and prices out spamming settle()'s O(n)
    ///         demand loops with 1-wei intents.
    uint256 public constant MIN_INTENT_WEI = 0.001 ether;

    struct Intent {
        address who;
        uint128 amount; // wei escrowed
        uint128 maxPriceWad; // 0 = market; else max wei per 1e18 token units
        bool claimed;
    }

    RoundPool public immutable pool;
    ArenaToken public immutable token;
    uint64 public immutable closesAt;
    uint256 public immutable maxRaiseWei;
    uint16 public immutable feeBps;
    address public immutable feeRecipient;

    Intent[] public intents;
    bool public settled;
    uint256 public clearingPriceWad;
    /// @notice The clearing fixed point A* — the fill formula's numerator.
    uint256 public totalRaisedWei;
    /// @notice Exact sum of floored per-intent fills; what actually entered the curve (+fee).
    uint256 public settledFillWei;
    uint256 public eligibleDemandWei;
    uint256 public totalTokensSold;
    bool private locked;

    event IntentSubmitted(uint256 indexed id, address indexed who, uint256 amount, uint256 maxPriceWad);
    event IntentCancelled(uint256 indexed id, address indexed who, uint256 amount);
    event Settled(uint256 clearingPriceWad, uint256 totalRaisedWei, uint256 totalTokensSold, uint256 eligibleDemandWei);
    event Claimed(uint256 indexed id, address indexed who, uint256 ethFilled, uint256 tokensOut, uint256 refund);

    modifier nonReentrant() {
        require(!locked, "reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor(
        RoundPool pool_,
        ArenaToken token_,
        uint64 closesAt_,
        uint256 maxRaiseWei_,
        uint16 feeBps_,
        address feeRecipient_
    ) {
        require(feeBps_ < BPS, "fee");
        pool = pool_;
        token = token_;
        closesAt = closesAt_;
        maxRaiseWei = maxRaiseWei_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
    }

    function intentCount() external view returns (uint256) {
        return intents.length;
    }

    function submit(uint128 maxPriceWad) external payable returns (uint256 id) {
        require(block.timestamp < closesAt, "queue closed");
        require(msg.value >= MIN_INTENT_WEI && msg.value <= type(uint128).max, "value");
        id = intents.length;
        intents.push(Intent(msg.sender, uint128(msg.value), maxPriceWad, false));
        emit IntentSubmitted(id, msg.sender, msg.value, maxPriceWad);
    }

    function cancel(uint256 id) external nonReentrant {
        require(block.timestamp < closesAt, "queue closed");
        Intent storage it = intents[id];
        require(it.who == msg.sender && !it.claimed, "not yours");
        it.claimed = true; // reuse flag: cancelled intents are settled-as-empty
        uint256 amount = it.amount;
        it.amount = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "refund");
        emit IntentCancelled(id, msg.sender, amount);
    }

    /// @notice Settle the auction. Permissionless after close; runs once.
    function settle() external nonReentrant {
        require(block.timestamp >= closesAt, "not closed");
        require(!settled, "settled");
        settled = true;

        (uint256 ethReserve, uint256 tokenReserve) = pool.getReserves();

        uint256 totalDemand;
        for (uint256 i = 0; i < intents.length; i++) totalDemand += intents[i].amount;

        // Binary search the fixed point A* = min(D(p(A*)), maxRaise).
        // wei granularity needs full 64-bit convergence: loop until lo == hi.
        uint256 lo = 0;
        uint256 hi = totalDemand < maxRaiseWei ? totalDemand : maxRaiseWei;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2; // bias up so lo converges to the largest valid A
            uint256 p = _priceWadAt(mid, ethReserve, tokenReserve);
            uint256 d = _demandAt(p);
            uint256 g = d < maxRaiseWei ? d : maxRaiseWei;
            if (mid <= g) lo = mid;
            else hi = mid - 1;
        }
        uint256 raise = lo;

        // Everything below computes into locals and commits to storage only on
        // the success path: no ETH may leave escrow unless the aggregate buy
        // provably mints tokens. Any guard failing falls through to the
        // zero-fill settle, where claim() refunds every intent in full.
        if (raise > 0) {
            uint256 priceWad = _priceWadAt(raise, ethReserve, tokenReserve);
            // Sentinel = the raise would buy zero token units. Market intents
            // (maxPriceWad == 0) accept any price including the sentinel, so
            // without this check their ETH would enter the pool for nothing.
            if (priceWad != type(uint256).max) {
                uint256 d = _demandAt(priceWad);
                // Sum the exact floored per-intent fills; settling on this sum
                // (not on raise) keeps escrow accounting exact to the wei, so
                // every refund is always covered.
                uint256 filled;
                for (uint256 i = 0; i < intents.length; i++) {
                    Intent storage it = intents[i];
                    if (it.maxPriceWad == 0 || it.maxPriceWad >= priceWad) {
                        filled += (uint256(it.amount) * raise) / d;
                    }
                }
                if (filled > 0) {
                    uint256 fee = (filled * feeBps) / BPS;
                    uint256 net = filled - fee;
                    // Mirror the pool's own curve math on the same reserves:
                    // commit only if the buy mints at least one token unit.
                    // (With honest constructors this always holds — the check
                    // exists so escrow solvency never depends on invariants
                    // maintained in other contracts.)
                    uint256 predicted =
                        tokenReserve - (ethReserve * tokenReserve) / (ethReserve + net);
                    if (predicted > 0) {
                        clearingPriceWad = priceWad;
                        totalRaisedWei = raise;
                        eligibleDemandWei = d;
                        settledFillWei = filled;
                        totalTokensSold = pool.auctionBuy{value: net}();
                        if (fee > 0) {
                            (bool ok, ) = feeRecipient.call{value: fee}("");
                            require(ok, "fee transfer");
                        }
                        emit Settled(priceWad, raise, totalTokensSold, d);
                        return;
                    }
                }
            }
        }
        pool.auctionBuy(); // opens continuous trading with no aggregate buy
        emit Settled(0, 0, 0, 0);
    }

    /// @notice Pull-based claims: tokens + refund for eligible intents, full
    ///         refund for excluded ones. Callable per intent by its owner.
    function claim(uint256 id) external nonReentrant {
        require(settled, "not settled");
        Intent storage it = intents[id];
        require(it.who == msg.sender && !it.claimed, "claimed");
        it.claimed = true;

        uint256 amount = it.amount;
        uint256 ethFilled;
        uint256 tokensOut;
        // totalTokensSold > 0 is guaranteed by settle()'s zero-token guards
        // whenever settledFillWei > 0; kept here so no state, however reached,
        // can charge ETH for zero tokens at the whole-auction level.
        bool eligible = settledFillWei > 0 && totalTokensSold > 0 &&
            (it.maxPriceWad == 0 || it.maxPriceWad >= clearingPriceWad);
        if (eligible) {
            // Same floored formula settle() summed, so Σ ethFilled ==
            // settledFillWei exactly and every refund is covered. Token dust
            // from flooring stays here (bounded by n wei-units).
            ethFilled = (amount * totalRaisedWei) / eligibleDemandWei;
            tokensOut = (totalTokensSold * ethFilled) / settledFillWei;
            if (tokensOut > 0) require(token.transfer(msg.sender, tokensOut), "token transfer");
        }
        uint256 refund = amount - ethFilled;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "refund");
        }
        emit Claimed(id, msg.sender, ethFilled, tokensOut, refund);
    }

    /// @dev Average execution price (gross of fee) for an aggregate raise A.
    function _priceWadAt(uint256 raise, uint256 ethReserve, uint256 tokenReserve)
        internal
        view
        returns (uint256)
    {
        if (raise == 0) return (ethReserve * WAD) / tokenReserve;
        uint256 net = raise - (raise * feeBps) / BPS;
        uint256 k = ethReserve * tokenReserve;
        uint256 tokensOut = tokenReserve - k / (ethReserve + net);
        if (tokensOut == 0) return type(uint256).max;
        return (raise * WAD) / tokensOut;
    }

    function _demandAt(uint256 priceWad) internal view returns (uint256 demand) {
        for (uint256 i = 0; i < intents.length; i++) {
            Intent storage it = intents[i];
            if (it.maxPriceWad == 0 || it.maxPriceWad >= priceWad) demand += it.amount;
        }
    }
}

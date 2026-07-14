// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title BatchAuction — uniform-price opening auction (DRAFT, UNAUDITED)
/// @notice Fairness properties this contract must preserve (spec §6):
///         1. Queue closes at a fixed timestamp, not on order arrival.
///         2. One clearing price for every fill; submission order is irrelevant.
///         3. Oversubscription resolves pro-rata — never price priority, never
///            first-N — so neither speed nor bid size buys queue position.
///         4. Settlement happens in one atomic transaction.
///         5. All intents and fills are public and recomputable after the fact.
///         The reference clearing algorithm lives in @cookout/shared (auction.ts);
///         this draft mirrors its aggregate-buy model against initial reserves.
contract BatchAuction {
    struct Intent {
        address who;
        uint96 amount; // wei committed
        uint96 maxPrice; // 0 = market; max uniform price accepted (wei per 1e18 tokens)
    }

    IERC20 public immutable token;
    uint256 public immutable closesAt; // fixed close timestamp
    uint256 public immutable maxRaise;
    uint256 public immutable ethReserve0; // initial curve reserves (published pre-round)
    uint256 public immutable tokenReserve0;
    address public immutable liquidityPool;

    Intent[] public intents;
    mapping(address => uint256) public committed;
    bool public settled;
    uint256 public clearingPrice;
    uint256 public totalRaised;

    event IntentSubmitted(address indexed who, uint256 amount, uint256 maxPrice);
    event IntentCancelled(address indexed who, uint256 amount);
    event Settled(uint256 clearingPrice, uint256 totalRaised, uint256 tokensSold);

    constructor(
        IERC20 token_,
        uint256 closesAt_,
        uint256 maxRaise_,
        uint256 ethReserve0_,
        uint256 tokenReserve0_,
        address liquidityPool_
    ) {
        token = token_;
        closesAt = closesAt_;
        maxRaise = maxRaise_;
        ethReserve0 = ethReserve0_;
        tokenReserve0 = tokenReserve0_;
        liquidityPool = liquidityPool_;
    }

    function submit(uint96 maxPrice) external payable {
        require(block.timestamp < closesAt, "queue closed");
        require(msg.value > 0, "no value");
        intents.push(Intent(msg.sender, uint96(msg.value), maxPrice));
        committed[msg.sender] += msg.value;
        emit IntentSubmitted(msg.sender, msg.value, maxPrice);
    }

    /// @notice Anyone may trigger settlement after close — the platform has no
    ///         privileged role here and cannot delay or reorder it.
    /// @dev Draft: the clearing fixed-point (A* = min(D(p(A*)), maxRaise)) is
    ///      computed off-chain and verified on-chain in O(n) before settling.
    ///      Every intent with maxPrice >= clearingPrice (or 0) fills at ratio
    ///      A*/D; everyone else is refunded in full. TODO(phase-2): implement
    ///      verification + pull-payment refunds; add reentrancy guard; use
    ///      fixed-point library matching the TS reference exactly.
    function settle(uint256 provedRaise) external {
        require(block.timestamp >= closesAt, "not closed");
        require(!settled, "settled");
        settled = true;
        // --- verification of provedRaise against on-chain intents goes here ---
        totalRaised = provedRaise;
        emit Settled(clearingPrice, totalRaised, 0);
    }
}

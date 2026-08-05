// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArenaToken} from "./ArenaToken.sol";
import {BatchAuction} from "./BatchAuction.sol";
import {RoundPool, IPositionManagerLike, IPermit2Like} from "./RoundPool.sol";
import {IPositionManagerLike as ILockerPositionManager} from "./CookoutLpLocker.sol";
import {LockerFactory} from "./LockerFactory.sol";

/// @title RoundFactory — template-only round deployment (spec §5.2)
/// @notice The single entry point for creating a round on-chain: token, pool,
///         and auction all deploy from fixed bytecode in one transaction, so
///         "creators supply metadata, never code" is enforced by construction.
///         The factory holds no post-deploy rights over any round it creates.
contract RoundFactory {
    /// @notice Hard cap on both fee streams. Creation is permissionless, so
    ///         without this a round with a ~100% sell fee is a honeypot that
    ///         passes every other trust property. 5% leaves ample headroom
    ///         over the 1% the platform actually charges.
    uint16 public constant MAX_FEE_BPS = 500;

    /// @notice Supply bounds. The floor (one whole 18-decimal token) makes the
    ///         dust-reserve pathologies — auction fills that floor to zero
    ///         tokens, sentinel clearing prices — unreachable by construction.
    ///         The ceiling keeps the pool's k = ethReserve·tokenReserve far
    ///         from uint256 overflow at any plausible ETH reserve.
    uint256 public constant MIN_SUPPLY = 1e18;
    uint256 public constant MAX_SUPPLY = 1e33;
    uint16 private constant BPS = 10_000;

    /// @dev Custom errors rather than require strings. This contract embeds the
    ///      creation bytecode of everything it deploys, which leaves very little
    ///      room for anything else — and revert strings are stored verbatim.
    error BadFeeWallet();
    error BadFeeSplit();
    error NoLiquidity();
    error BadSupply();
    error FeeTooHigh();
    error BadFeeRecipient();
    error QueueClosesInPast();
    error EndsBeforeQueueCloses();
    error SeedFailed();

    struct RoundAddresses {
        address token;
        address pool;
        address auction;
        address creator;
        uint64 createdAt;
        /// @notice Holds the v4 position forever once the round graduates.
        address locker;
        /// @notice Splits that position's fees between creator and protocol.
        address feeSplitter;
    }

    /// @notice Uniswap v4 plumbing every round inherits. Immutable, so no round
    ///         can be pointed at a different PositionManager than any other.
    IPositionManagerLike public immutable positionManager;
    IPermit2Like public immutable permit2;
    /// @notice Deploys each round's locker + splitter. Immutable; see
    ///         LockerFactory for why it isn't inlined here.
    LockerFactory public immutable lockerFactory;
    /// @notice Where the protocol's share of post-graduation LP fees is paid.
    address public immutable protocolFeeWallet;
    /// @notice Protocol share of those fees; the creator takes the rest.
    uint16 public immutable protocolFeeBps;

    constructor(
        IPositionManagerLike positionManager_,
        IPermit2Like permit2_,
        LockerFactory lockerFactory_,
        address protocolFeeWallet_,
        uint16 protocolFeeBps_
    ) {
        if (protocolFeeWallet_ == address(0)) revert BadFeeWallet();
        if (protocolFeeBps_ > BPS) revert BadFeeSplit();
        positionManager = positionManager_;
        permit2 = permit2_;
        lockerFactory = lockerFactory_;
        protocolFeeWallet = protocolFeeWallet_;
        protocolFeeBps = protocolFeeBps_;
    }

    RoundAddresses[] public rounds;

    event RoundCreated(
        uint256 indexed id,
        address indexed creator,
        address token,
        address pool,
        address auction,
        address locker,
        address feeSplitter
    );

    struct RoundParams {
        string name;
        string symbol;
        uint256 totalSupply; // all of it seeds the pool
        uint64 queueClosesAt;
        uint64 endTime;
        uint256 auctionMaxRaiseWei;
        uint16 auctionFeeBps;
        uint16 tradeFeeBps;
        uint256 mcapTargetWei;
        uint256 graduationMcapWei;
        uint256 graduationMinVolumeWei;
        uint256 graduationMinHolders;
        address feeRecipient;
        address creator;
        /// @notice Where the creator's share of post-graduation LP fees goes.
        ///         Chosen at launch and immutable from here on. Zero means the
        ///         creator's own address.
        address feeDestination;
    }

    function roundCount() external view returns (uint256) {
        return rounds.length;
    }

    /// @notice Deploys a full round. msg.value seeds pool liquidity.
    function createRound(RoundParams calldata p)
        external
        payable
        returns (address tokenAddr, address poolAddr, address auctionAddr)
    {
        if (msg.value == 0) revert NoLiquidity();
        if (p.totalSupply < MIN_SUPPLY || p.totalSupply > MAX_SUPPLY) revert BadSupply();
        if (p.tradeFeeBps > MAX_FEE_BPS || p.auctionFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (p.feeRecipient == address(0)) revert BadFeeRecipient();
        if (p.queueClosesAt <= block.timestamp) revert QueueClosesInPast();
        if (p.endTime <= p.queueClosesAt) revert EndsBeforeQueueCloses();
        ArenaToken token = new ArenaToken(p.name, p.symbol, p.totalSupply, address(this));
        // Deployed up front, not at graduation: the pool needs an immutable
        // destination for its liquidity, and "decided later" is exactly the
        // discretion this design is supposed to not have.
        (address locker, address splitter) = lockerFactory.deployFor(
            ILockerPositionManager(address(positionManager)),
            p.feeDestination == address(0) ? p.creator : p.feeDestination,
            protocolFeeWallet,
            protocolFeeBps
        );
        RoundPool pool = new RoundPool(
            token,
            p.feeRecipient,
            p.tradeFeeBps,
            p.endTime,
            p.mcapTargetWei,
            p.graduationMcapWei,
            p.graduationMinVolumeWei,
            p.graduationMinHolders,
            positionManager,
            permit2,
            locker
        );
        BatchAuction auction = new BatchAuction(
            pool,
            token,
            p.queueClosesAt,
            p.auctionMaxRaiseWei,
            p.auctionFeeBps,
            p.feeRecipient
        );
        pool.initAuction(address(auction));
        if (!token.transfer(address(pool), p.totalSupply)) revert SeedFailed();
        pool.initialize{value: msg.value}();

        uint256 id = rounds.length;
        rounds.push(
            RoundAddresses(
                address(token),
                address(pool),
                address(auction),
                p.creator,
                uint64(block.timestamp),
                locker,
                splitter
            )
        );
        emit RoundCreated(
            id,
            p.creator,
            address(token),
            address(pool),
            address(auction),
            locker,
            splitter
        );
        return (address(token), address(pool), address(auction));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PitPool} from "./PitPool.sol";
import {PitBattlePool} from "./PitBattlePool.sol";

/// @title PitPoolFactory — one deployed address the server creates Pit pools from
/// @notice Pit matches are created by the platform rather than by players, so
///         unlike RoundFactory this is not permissionless: only the resolver
///         may create pools. That is not a trust concession, it is the point —
///         pools created by anyone else would carry this resolver's name while
///         escrowing money for a match that does not exist.
///
///         The factory itself holds nothing and can do nothing to a pool once
///         created. Every guarantee lives in PitPool and PitBattlePool; this
///         only fixes the resolver and the fee recipient at deploy time so a
///         per-match call cannot quietly point either somewhere else.
contract PitPoolFactory {
    /// @notice The only address that may create pools, and the oracle that will
    ///         resolve every one of them. Immutable.
    address public immutable resolver;
    /// @notice Where every pool's house cut goes. Immutable, so a per-match
    ///         call can never redirect fees.
    address public immutable feeRecipient;

    /// @dev One battle pool per difficulty tier, because a tier is a price and
    ///      a pool can only hold one. Sharing a pool across tiers would make
    ///      "everyone in this tier pays the same" meaningless — a $5 entrant
    ///      would be playing for a pot fed by $100 entrants, which is the very
    ///      thing the fixed ladder was introduced to stop.
    struct Pools {
        address prediction;
        address battleEasy;
        address battleMedium;
        address battleHard;
        uint64 createdAt;
    }

    /// @notice Pools by the server's match id, so the mirror can find them
    ///         again without trusting an address handed to it later.
    mapping(bytes32 => Pools) public poolsFor;

    event PitPoolsCreated(
        bytes32 indexed matchId,
        address prediction,
        address[3] battles,
        uint256[3] entryFees,
        uint64 closesAt,
        uint64 refundAfter
    );

    error NotResolver();
    error AlreadyCreated();
    error BadConfig();

    constructor(address resolver_, address feeRecipient_) {
        if (resolver_ == address(0) || feeRecipient_ == address(0)) revert BadConfig();
        resolver = resolver_;
        feeRecipient = feeRecipient_;
    }

    /**
     * @notice Create every pool for one match: the prediction pool, and one
     *         battle pool per difficulty tier.
     *
     * `entryFees` are the tiers' fixed entries, already converted from USD to
     * wei by the caller — a contract has no price feed, and a per-match
     * constant is exactly what makes an entry un-repriceable once players have
     * committed to it.
     */
    function createPools(
        bytes32 matchId,
        uint16 predictionFeeBps,
        uint16 battleFeeBps,
        uint256[3] calldata entryFees,
        uint64 closesAt,
        uint64 refundAfter
    ) external returns (address prediction, address[3] memory battles) {
        if (msg.sender != resolver) revert NotResolver();
        if (poolsFor[matchId].createdAt != 0) revert AlreadyCreated();

        prediction = address(
            new PitPool(resolver, feeRecipient, predictionFeeBps, closesAt, refundAfter)
        );
        for (uint256 i = 0; i < 3; i++) {
            battles[i] = address(
                new PitBattlePool(
                    resolver,
                    feeRecipient,
                    battleFeeBps,
                    entryFees[i],
                    closesAt,
                    refundAfter
                )
            );
        }
        poolsFor[matchId] = Pools(
            prediction,
            battles[0],
            battles[1],
            battles[2],
            uint64(block.timestamp)
        );
        emit PitPoolsCreated(matchId, prediction, battles, entryFees, closesAt, refundAfter);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Graduation — criteria-based liquidity migration (DRAFT, UNAUDITED)
/// @notice At round end, if the pre-published criteria (market cap, holder
///         count, volume) are met, round liquidity migrates into a permanently
///         locked DEX pool: holders keep their tokens and the token keeps
///         trading ("Arena Alumni"). If not, the pool enters uniform batch
///         redemption: every remaining holder exits at one price,
///         E*O/(T+O) pro-rata — no exit-order advantage.
///
///         Trust requirements (spec §13) this contract must make verifiable:
///         - No platform address holds withdraw rights over round liquidity.
///         - The criteria and this code are published before the round opens.
///         - Migration/redemption is callable by anyone once conditions hold —
///           execution is non-discretionary.
contract Graduation {
    uint256 public immutable graduationMcap;
    uint256 public immutable minHolders;
    uint256 public immutable minVolume;
    bool public resolved;
    bool public graduated;

    event Graduated(address lockedPool);
    event RedemptionOpened(uint256 uniformPrice);

    constructor(uint256 mcap_, uint256 holders_, uint256 volume_) {
        graduationMcap = mcap_;
        minHolders = holders_;
        minVolume = volume_;
    }

    /// @dev TODO(phase-2): wire to the round's AMM pool + oracle-free on-chain
    ///      measurements (reserves, holder count via token, cumulative volume),
    ///      deploy the locked LP position (non-transferable, no owner), and
    ///      implement claim-based uniform redemption for the failure path.
    function resolve() external {
        require(!resolved, "resolved");
        resolved = true;
        // --- criteria checks + migration/redemption go here ---
    }
}

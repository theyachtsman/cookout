// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CookoutLpLocker, IPositionManagerLike} from "./CookoutLpLocker.sol";
import {FeeSplitter} from "./FeeSplitter.sol";

/// @title LockerFactory — deploys a round's fee splitter and LP locker
/// @notice Split out of RoundFactory purely for bytecode size: a factory that
///         deploys five contract types embeds all five, and RoundFactory was
///         over the 24,576-byte contract limit. Nothing here is configurable
///         and nothing is stored — it is a constructor call in contract form,
///         so moving it out costs no trust: the addresses it returns are used
///         immediately by the caller and verifiable on-chain.
contract LockerFactory {
    /// @notice Deploy the pair for one round. Anyone may call it; the result is
    ///         only meaningful to whoever uses the returned addresses.
    function deployFor(
        IPositionManagerLike positionManager,
        address creatorFeeDestination,
        address protocolFeeWallet,
        uint16 protocolFeeBps
    ) external returns (address locker, address splitter) {
        FeeSplitter s = new FeeSplitter(creatorFeeDestination, protocolFeeWallet, protocolFeeBps);
        CookoutLpLocker l = new CookoutLpLocker(positionManager, address(s));
        return (address(l), address(s));
    }
}

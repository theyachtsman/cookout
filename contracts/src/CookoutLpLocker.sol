// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The slice of Uniswap's v4 PositionManager this locker touches.
///         Declared locally rather than pulling the whole dependency, matching
///         how the rest of this repo talks to external contracts.
interface IPositionManagerLike {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory poolKey, uint256 info);
}

/// @notice v4's pool identifier. Only `currency0`/`currency1` are read here,
///         but the full struct is needed for the ABI decode to line up.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// @title CookoutLpLocker — permanent liquidity, forwardable fees
/// @notice Holds a graduated coin's Uniswap v4 LP position forever. The
///         position enters once and can never leave; the only thing this
///         contract can do with it is collect trading fees and forward them to
///         one immutable address.
///
///         Trust properties, verifiable by reading this file top to bottom:
///         - There is no function that transfers or approves the position NFT,
///           no owner, no admin, no timelock, no upgrade path, and no way to
///           execute an arbitrary call. Not "disabled" — absent.
///         - `collectFees` decreases liquidity by exactly zero. That is v4's
///           idiom for a fee-only collection: it settles the accrued fee
///           deltas and touches no principal.
///         - The fee destination is immutable and set at construction.
///
/// @dev Modelled on Uniswap's PositionFeesForwarder, deliberately without the
///      TimelockedPositionRecipient it inherits. That base exposes
///      `approveOperator()`, which after a timelock hands a named operator
///      blanket approval over the position — and with it the ability to
///      withdraw the liquidity. Configuring that timelock to never elapse
///      would work, but it leaves a reader auditing an escape hatch and
///      checking a constructor argument to convince themselves it is shut. A
///      lock nobody has to take on faith is worth the sixty lines.
contract CookoutLpLocker {
    /// @dev v4-periphery Actions. DECREASE_LIQUIDITY with zero liquidity is a
    ///      fee collection; TAKE_PAIR closes the resulting deltas to a payee.
    uint8 private constant ACTION_DECREASE_LIQUIDITY = 0x01;
    uint8 private constant ACTION_TAKE_PAIR = 0x11;

    /// @notice Uniswap v4's PositionManager, which custodies the position NFT.
    IPositionManagerLike public immutable positionManager;
    /// @notice Where collected fees go. Immutable — typically a FeeSplitter
    ///         paying the coin's creator and the protocol.
    address public immutable feeRecipient;

    event FeesCollected(uint256 indexed tokenId, address indexed to);
    event PositionLocked(uint256 indexed tokenId);

    error BadRecipient();
    error NotThePositionManager();

    constructor(IPositionManagerLike positionManager_, address feeRecipient_) {
        // Zero would send every fee this position ever earns to nowhere, and
        // nothing here can correct it afterwards.
        if (feeRecipient_ == address(0)) revert BadRecipient();
        if (address(positionManager_) == address(0)) revert BadRecipient();
        positionManager = positionManager_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Collect this position's accrued trading fees and forward them.
    /// @dev Permissionless on purpose: anyone may trigger a collection, but the
    ///      payee is fixed at construction, so calling it can only ever move
    ///      fees to the address the coin's creator chose at launch. Nobody has
    ///      to stay alive for the creator to keep getting paid.
    function collectFees(uint256 tokenId) external {
        (PoolKey memory poolKey, ) = positionManager.getPoolAndPositionInfo(tokenId);

        bytes memory actions = abi.encodePacked(ACTION_DECREASE_LIQUIDITY, ACTION_TAKE_PAIR);
        bytes[] memory params = new bytes[](2);
        // (tokenId, liquidity = 0, amount0Min = 0, amount1Min = 0, hookData)
        // Zero liquidity is what makes this a fee collection and not a
        // withdrawal — the principal is never part of the delta.
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, feeRecipient);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        emit FeesCollected(tokenId, feeRecipient);
    }

    /// @notice Accept the position NFT. This is the only way in, and there is
    ///         no way out.
    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external returns (bytes4) {
        // Only the PositionManager's own NFTs; anything else would be an
        // unrelated token stuck here forever with no way to retrieve it.
        if (msg.sender != address(positionManager)) revert NotThePositionManager();
        emit PositionLocked(tokenId);
        return this.onERC721Received.selector;
    }

    /// @notice Fees are taken as native ETH when a pool's currency0 is ETH.
    ///         They are forwarded by TAKE_PAIR, so nothing should rest here —
    ///         this exists only so a collection cannot revert on transfer.
    receive() external payable {}
}

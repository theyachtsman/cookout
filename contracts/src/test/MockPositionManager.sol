// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PoolKey} from "../CookoutLpLocker.sol";

/// @dev TEST ONLY — never deployed. Stands in for Uniswap's v4 PositionManager
///      so the locker's fee-collection encoding can be asserted without pulling
///      the whole v4 dependency tree into this repo. Records the last
///      modifyLiquidities payload so the suite can prove the locker asks for a
///      zero-liquidity decrease (a fee collection) and never a withdrawal.
contract MockPositionManager {
    PoolKey private key;
    bytes public lastUnlockData;
    uint256 public calls;

    function setPoolKey(address currency0, address currency1) external {
        key = PoolKey(currency0, currency1, 3000, 60, address(0));
    }

    function getPoolAndPositionInfo(uint256) external view returns (PoolKey memory, uint256) {
        return (key, 0);
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external payable {
        lastUnlockData = unlockData;
        calls++;
    }

    /// @notice Decode what the locker asked for, so a test can read it back.
    function decodeLast()
        external
        view
        returns (bytes memory actions, uint256 tokenId, uint256 liquidity, address payee)
    {
        bytes[] memory params;
        (actions, params) = abi.decode(lastUnlockData, (bytes, bytes[]));
        (tokenId, liquidity, , , ) = abi.decode(
            params[0],
            (uint256, uint256, uint128, uint128, bytes)
        );
        (, , payee) = abi.decode(params[1], (address, address, address));
    }

    /// @notice Drive the locker's ERC721 receive hook as the PositionManager.
    function sendPositionTo(address locker, uint256 tokenId) external returns (bytes4) {
        return
            IERC721ReceiverLike(locker).onERC721Received(address(this), address(this), tokenId, "");
    }
}

interface IERC721ReceiverLike {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

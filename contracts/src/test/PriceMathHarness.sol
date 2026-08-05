// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PriceMath} from "../libraries/PriceMath.sol";

/// @dev TEST ONLY — exposes the library so its arithmetic can be checked
///      against values computed independently, without a pool in the way.
contract PriceMathHarness {
    function sqrt(uint256 x) external pure returns (uint256) {
        return PriceMath.sqrt(x);
    }

    function mulDiv(uint256 a, uint256 b, uint256 d) external pure returns (uint256) {
        return PriceMath.mulDiv(a, b, d);
    }

    function sqrtPriceX96FromReserves(uint256 r0, uint256 r1) external pure returns (uint160) {
        return PriceMath.sqrtPriceX96FromReserves(r0, r1);
    }

    function fullRangeLiquidity(uint160 p, uint256 a0, uint256 a1) external pure returns (uint128) {
        return PriceMath.fullRangeLiquidity(p, a0, a1);
    }
}

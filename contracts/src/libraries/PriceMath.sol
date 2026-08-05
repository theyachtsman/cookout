// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Deployed as an external library and linked, not inlined. Its code is
///      only reachable from migrate(), which runs once per round, so the
///      delegatecall costs nothing on any hot path — and keeping it out of
///      RoundPool's bytecode keeps RoundFactory, which embeds RoundPool whole,
///      under the 24,576-byte contract limit.
/// @title PriceMath — converting a constant-product pool into a v4 position
/// @notice The arithmetic that decides what a graduated coin is worth the
///         instant it moves to Uniswap. Getting it wrong doesn't revert — it
///         opens the new pool at the wrong price and hands the difference to
///         whoever arbitrages it first. Kept in its own library so it can be
///         tested against known values without deploying anything.
library PriceMath {
    /// @dev v4 prices are sqrt(token1/token0) in Q64.96 fixed point.
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    /// @dev Widest tick range that is a multiple of tickSpacing 60. v4's own
    ///      bounds are ±887272; these are those aligned inward, which is what
    ///      "full range" means for a 60-spaced pool. Hardcoded — along with
    ///      their sqrt ratios below — so this library needs no TickMath, whose
    ///      bit-by-bit approximation is the last thing worth reimplementing.
    int24 internal constant MIN_TICK_SPACING_60 = -887220;
    int24 internal constant MAX_TICK_SPACING_60 = 887220;
    /// @dev sqrtPriceX96 at those ticks.
    uint160 internal constant MIN_SQRT_RATIO_SPACING_60 = 4310618292;
    uint160 internal constant MAX_SQRT_RATIO_SPACING_60 =
        1457652066949847389969617340386294118487833376468;

    error ZeroReserve();
    error PriceOutOfRange();

    /// @notice Babylonian integer square root, rounding down.
    function sqrt(uint256 x) public pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    /// @notice floor(a·b / d) at full 512-bit intermediate precision.
    /// @dev Remco Bloemen's mulDiv. Needed because the liquidity formulas
    ///      multiply two Q96 values before dividing, which overflows uint256
    ///      long before the result would.
    function mulDiv(uint256 a, uint256 b, uint256 d) public pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(d > 0, "div0");
                return prod0 / d;
            }
            require(d > prod1, "overflow");

            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, d)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = d & (~d + 1);
            assembly {
                d := div(d, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            uint256 inv = (3 * d) ^ 2;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            result = prod0 * inv;
        }
    }

    /**
     * @notice The v4 opening price for a constant-product pool's reserves.
     * @param reserve0 Reserve of currency0 (native ETH in our pools).
     * @param reserve1 Reserve of currency1 (the round token).
     *
     * @dev sqrtPriceX96 = sqrt(reserve1/reserve0) · 2^96. Computed as
     *      sqrt(reserve1 · 2^96 / reserve0) · 2^48 rather than
     *      sqrt(reserve1 · 2^192 / reserve0), because the latter overflows for
     *      any realistic token reserve. Splitting the shift across the square
     *      root costs about half a bit of precision and cannot overflow: the
     *      largest supply the factory allows is 1e33, and 1e33 · 2^96 is still
     *      three orders of magnitude inside uint256.
     */
    function sqrtPriceX96FromReserves(uint256 reserve0, uint256 reserve1)
        public
        pure
        returns (uint160)
    {
        if (reserve0 == 0 || reserve1 == 0) revert ZeroReserve();
        uint256 ratioX96 = mulDiv(reserve1, Q96, reserve0);
        uint256 price = sqrt(ratioX96) << 48;
        // v4 rejects a price outside its own bounds; catching it here names the
        // cause instead of surfacing an opaque revert from the PoolManager.
        if (price <= MIN_SQRT_RATIO_SPACING_60 || price >= MAX_SQRT_RATIO_SPACING_60)
            revert PriceOutOfRange();
        return uint160(price);
    }

    /**
     * @notice Liquidity for a full-range position holding both amounts.
     *
     * @dev The standard getLiquidityForAmounts, specialised to a price that is
     *      always strictly inside the range (full range, and the price came
     *      from these very reserves). Returns the smaller of the two sides —
     *      the larger one simply contributes less than it could, which is
     *      correct: minting more would require tokens the pool doesn't have.
     */
    function fullRangeLiquidity(
        uint160 sqrtPriceX96,
        uint256 amount0,
        uint256 amount1
    ) public pure returns (uint128) {
        uint256 sqrtA = MIN_SQRT_RATIO_SPACING_60;
        uint256 sqrtB = MAX_SQRT_RATIO_SPACING_60;
        uint256 p = sqrtPriceX96;

        // amount0 side: L = amount0 · (sqrtP·sqrtB / Q96) / (sqrtB − sqrtP)
        uint256 intermediate = mulDiv(p, sqrtB, Q96);
        uint256 liquidity0 = mulDiv(amount0, intermediate, sqrtB - p);
        // amount1 side: L = amount1 · Q96 / (sqrtP − sqrtA)
        uint256 liquidity1 = mulDiv(amount1, Q96, p - sqrtA);

        uint256 l = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        require(l <= type(uint128).max, "liquidity overflow");
        return uint128(l);
    }
}

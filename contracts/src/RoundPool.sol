// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArenaToken} from "./ArenaToken.sol";
import {PriceMath} from "./libraries/PriceMath.sol";

/// @notice v4's pool identifier.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// @notice The slice of Uniswap v4's PositionManager migration uses.
interface IPositionManagerLike {
    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external payable returns (int24);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function nextTokenId() external view returns (uint256);
}

/// @notice Permit2, which v4's PositionManager pulls ERC20s through.
interface IPermit2Like {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @title RoundPool — the round's constant-product market + resolution rules
/// @notice Trust properties (spec §13), enforced by construction:
///         - There is NO function that withdraws pool liquidity to anyone.
///           ETH only leaves along the curve (sell), via uniform redemption
///           after a non-graduated round, or as the published fee stream.
///         - resolve() is permissionless: once the end condition holds,
///           anyone can trigger it. Graduation criteria are immutable and
///           measured entirely on-chain (reserves, cumulative volume, the
///           token's holder count).
///         - Graduation migrates the whole pool to Uniswap v4 and locks the
///           position forever. migrate() is permissionless, one-way, and every
///           destination is immutable: the PositionManager and the locker are
///           fixed at construction, so there is no "migration key" and nobody
///           chooses where the liquidity goes. If it reverts, the pool simply
///           keeps trading here, which is the behaviour it had before.
contract RoundPool {
    enum Phase {
        Pending, // seeded, waiting for the batch auction to open trading
        Live, // continuous trading
        Graduated, // criteria met at resolution — trades forever
        Redeem // criteria missed — uniform redemption open
    }

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;

    ArenaToken public immutable token;
    address public immutable feeRecipient;
    uint16 public immutable tradeFeeBps;
    uint64 public immutable endTime;
    uint256 public immutable mcapTargetWei; // 0 = disabled
    uint256 public immutable graduationMcapWei;
    uint256 public immutable graduationMinVolumeWei;
    uint256 public immutable graduationMinHolders;

    address public auction; // set once by the factory
    address private immutable deployer;

    /// @notice Uniswap v4 plumbing, fixed at construction. These being
    ///         immutable is the whole safety argument for migrate(): nobody can
    ///         point migration at a PositionManager or a recipient of their
    ///         choosing, because there is no setter to point it with.
    IPositionManagerLike public immutable positionManager;
    IPermit2Like public immutable permit2;
    /// @notice Where the LP position goes, and stays. A CookoutLpLocker.
    address public immutable lpLocker;
    /// @notice v4 pool parameters for the migrated pool. 0.3% / 60 spacing, and
    ///         explicitly NO hook: a graduated pool should be a plain pool that
    ///         nobody, including us, can tax or halt.
    uint24 public constant MIGRATION_FEE = 3000;
    int24 public constant MIGRATION_TICK_SPACING = 60;

    /// @notice Set once migrate() succeeds. Also the tokenId of the locked position.
    uint256 public migratedPositionId;
    bool public migrated;

    Phase public phase;
    uint256 public ethReserve;
    uint256 public tokenReserve;
    uint256 public cumulativeVolumeWei;
    uint256 public feesAccrued;
    /// @notice Uniform redemption price (wei per 1e18 token units), set at resolution.
    uint256 public redemptionPriceWad;

    bool private locked;

    event TradingOpened(uint256 ethReserve, uint256 tokenReserve);
    event Bought(address indexed who, uint256 ethIn, uint256 tokensOut, uint256 fee);
    event Sold(address indexed who, uint256 tokensIn, uint256 ethOut, uint256 fee);
    event Resolved(bool graduated, uint256 finalMcapWei, uint256 redemptionPriceWad);
    event Redeemed(address indexed who, uint256 tokensIn, uint256 ethOut);
    event Migrated(
        uint256 indexed tokenId,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 ethAmount,
        uint256 tokenAmount
    );

    modifier nonReentrant() {
        require(!locked, "reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor(
        ArenaToken token_,
        address feeRecipient_,
        uint16 tradeFeeBps_,
        uint64 endTime_,
        uint256 mcapTargetWei_,
        uint256 graduationMcapWei_,
        uint256 graduationMinVolumeWei_,
        uint256 graduationMinHolders_,
        IPositionManagerLike positionManager_,
        IPermit2Like permit2_,
        address lpLocker_
    ) {
        require(tradeFeeBps_ < BPS, "fee");
        positionManager = positionManager_;
        permit2 = permit2_;
        lpLocker = lpLocker_;
        token = token_;
        feeRecipient = feeRecipient_;
        tradeFeeBps = tradeFeeBps_;
        endTime = endTime_;
        mcapTargetWei = mcapTargetWei_;
        graduationMcapWei = graduationMcapWei_;
        graduationMinVolumeWei = graduationMinVolumeWei_;
        graduationMinHolders = graduationMinHolders_;
        deployer = msg.sender;
    }

    /// @notice One-time wiring by the factory during round creation.
    function initAuction(address auction_) external {
        require(msg.sender == deployer && auction == address(0), "init");
        auction = auction_;
    }

    /// @notice Factory seeds initial liquidity (tokens already transferred in).
    function initialize() external payable {
        require(msg.sender == deployer && ethReserve == 0, "init");
        uint256 tokens = token.balanceOf(address(this));
        require(msg.value > 0 && tokens > 0, "seed");
        ethReserve = msg.value;
        tokenReserve = tokens;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (ethReserve, tokenReserve);
    }

    function spotPriceWad() public view returns (uint256) {
        return (ethReserve * WAD) / tokenReserve;
    }

    function mcapWei() public view returns (uint256) {
        return (ethReserve * token.totalSupply()) / tokenReserve;
    }

    /// @notice The batch auction's aggregate buy: fee is handled by the
    ///         auction; the net raise enters the curve at once, then
    ///         continuous trading opens. Callable exactly once.
    function auctionBuy() external payable nonReentrant returns (uint256 tokensOut) {
        require(msg.sender == auction && phase == Phase.Pending, "auction only");
        if (msg.value > 0) {
            tokensOut = _curveOut(msg.value);
            ethReserve += msg.value;
            tokenReserve -= tokensOut;
            require(token.transfer(msg.sender, tokensOut), "transfer");
            cumulativeVolumeWei += msg.value;
        }
        phase = Phase.Live;
        emit TradingOpened(ethReserve, tokenReserve);
    }

    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        require(phase == Phase.Live || phase == Phase.Graduated, "not trading");
        require(msg.value > 0, "no value");
        uint256 fee = (msg.value * tradeFeeBps) / BPS;
        uint256 net = msg.value - fee;
        feesAccrued += fee;
        tokensOut = _curveOut(net);
        require(tokensOut >= minTokensOut, "slippage");
        ethReserve += net;
        tokenReserve -= tokensOut;
        cumulativeVolumeWei += msg.value;
        require(token.transfer(msg.sender, tokensOut), "transfer");
        emit Bought(msg.sender, msg.value, tokensOut, fee);
        _autoResolve();
    }

    function sell(uint256 tokensIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        require(phase == Phase.Live || phase == Phase.Graduated, "not trading");
        require(tokensIn > 0, "no tokens");
        require(token.transferFrom(msg.sender, address(this), tokensIn), "transferFrom");
        uint256 k = ethReserve * tokenReserve;
        uint256 newTokenReserve = tokenReserve + tokensIn;
        uint256 newEthReserve = k / newTokenReserve;
        uint256 grossOut = ethReserve - newEthReserve;
        uint256 fee = (grossOut * tradeFeeBps) / BPS;
        ethOut = grossOut - fee;
        require(ethOut >= minEthOut, "slippage");
        feesAccrued += fee;
        ethReserve = newEthReserve;
        tokenReserve = newTokenReserve;
        cumulativeVolumeWei += grossOut;
        _pay(msg.sender, ethOut);
        emit Sold(msg.sender, tokensIn, ethOut, fee);
        _autoResolve();
    }

    /// @notice Permissionless resolution once the end condition holds.
    function resolve() external nonReentrant {
        require(phase == Phase.Live, "not live");
        require(_endConditionMet(), "round not over");
        _resolve();
    }

    /// @notice Uniform redemption for non-graduated rounds: every holder
    ///         exits at the same price, E·O/(T+O) split pro-rata — the exact
    ///         rule the paper engine uses, with no exit-order advantage.
    function redeem(uint256 tokensIn) external nonReentrant returns (uint256 ethOut) {
        require(phase == Phase.Redeem, "not redeeming");
        require(token.transferFrom(msg.sender, address(this), tokensIn), "transferFrom");
        ethOut = (tokensIn * redemptionPriceWad) / WAD;
        ethReserve -= ethOut;
        tokenReserve += tokensIn;
        _pay(msg.sender, ethOut);
        emit Redeemed(msg.sender, tokensIn, ethOut);
    }

    /// @notice Published fee stream — the only ETH that ever leaves outside
    ///         curve math and redemption.
    function claimFees() external nonReentrant {
        uint256 amount = feesAccrued;
        feesAccrued = 0;
        _pay(feeRecipient, amount);
    }

    /**
     * @notice Move a graduated pool's entire liquidity to Uniswap v4 and lock it.
     *
     * Permissionless and one-way. Deliberately NOT called from _resolve(): a
     * resolution can be triggered by an ordinary trade, and burying a pool
     * migration inside someone's buy would make them pay for it and would fail
     * their trade if anything here reverted. Splitting it means the worst case
     * is that migration doesn't happen yet and the pool keeps trading exactly
     * as it does today.
     *
     * The ETH and tokens leave this contract, which is the one exception to
     * "no function withdraws liquidity" — and it is bounded by construction:
     * the only possible destination is a v4 pool for this token, and the only
     * possible owner of the resulting position is the immutable locker.
     */
    function migrate() external nonReentrant returns (uint256 tokenId) {
        require(phase == Phase.Graduated, "not graduated");
        require(!migrated, "migrated");
        require(address(positionManager) != address(0), "no migration target");
        migrated = true;

        uint256 ethAmount = ethReserve;
        uint256 tokenAmount = tokenReserve;
        require(ethAmount > 0 && tokenAmount > 0, "empty");
        // Book the pool empty before any external call. Fees already accrued
        // stay claimable; they were never part of the curve's reserves.
        ethReserve = 0;
        tokenReserve = 0;

        // Native ETH is address(0), which sorts below every token address, so
        // currency0 is always ETH and currency1 always the round token.
        PoolKey memory key = PoolKey({
            currency0: address(0),
            currency1: address(token),
            fee: MIGRATION_FEE,
            tickSpacing: MIGRATION_TICK_SPACING,
            hooks: address(0)
        });

        uint160 sqrtPriceX96 = PriceMath.sqrtPriceX96FromReserves(ethAmount, tokenAmount);
        positionManager.initializePool(key, sqrtPriceX96);

        uint128 liquidity = PriceMath.fullRangeLiquidity(sqrtPriceX96, ethAmount, tokenAmount);
        require(liquidity > 0, "no liquidity");

        // v4's PositionManager pulls ERC20s through Permit2, so the token needs
        // an allowance on Permit2 and Permit2 needs one for the manager.
        require(token.approve(address(permit2), tokenAmount), "approve");
        permit2.approve(address(token), address(positionManager), uint160(tokenAmount), type(uint48).max);

        tokenId = positionManager.nextTokenId();
        bytes memory actions = abi.encodePacked(uint8(0x02), uint8(0x0d), uint8(0x14)); // MINT_POSITION, SETTLE_PAIR, SWEEP
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            key,
            PriceMath.MIN_TICK_SPACING_60,
            PriceMath.MAX_TICK_SPACING_60,
            liquidity,
            ethAmount,   // amount0Max
            tokenAmount, // amount1Max
            lpLocker,    // the position goes straight to the locker, never here
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        // Rounding means the mint takes slightly less than the maxima; SWEEP
        // returns the dust rather than leaving it stuck in the PositionManager.
        params[2] = abi.encode(key.currency0, address(this));

        positionManager.modifyLiquidities{value: ethAmount}(
            abi.encode(actions, params),
            block.timestamp
        );

        migratedPositionId = tokenId;
        emit Migrated(tokenId, sqrtPriceX96, liquidity, ethAmount, tokenAmount);
    }

    function _endConditionMet() internal view returns (bool) {
        if (block.timestamp >= endTime) return true;
        if (mcapTargetWei != 0 && mcapWei() >= mcapTargetWei) return true;
        return false;
    }

    function _autoResolve() internal {
        if (phase == Phase.Live && mcapTargetWei != 0 && mcapWei() >= mcapTargetWei) {
            _resolve();
        }
    }

    function _resolve() internal {
        uint256 finalMcap = mcapWei();
        bool graduated = finalMcap >= graduationMcapWei &&
            cumulativeVolumeWei >= graduationMinVolumeWei &&
            token.holderCount() >= graduationMinHolders;
        if (graduated) {
            phase = Phase.Graduated;
            emit Resolved(true, finalMcap, 0);
        } else {
            phase = Phase.Redeem;
            uint256 circulating = token.totalSupply() - token.balanceOf(address(this));
            if (circulating > 0) {
                redemptionPriceWad = (ethReserve * WAD) / (tokenReserve + circulating);
            }
            emit Resolved(false, finalMcap, redemptionPriceWad);
        }
    }

    function _curveOut(uint256 ethInNet) internal view returns (uint256) {
        uint256 k = ethReserve * tokenReserve;
        return tokenReserve - k / (ethReserve + ethInNet);
    }

    /// @notice Accepts the dust SWEEP returns after migration.
    /// @dev Minting rounds the required amounts up, so the pool sends the v4
    ///      PositionManager slightly more ETH than the position consumes and
    ///      sweeps the remainder back. Without this the sweep reverts with an
    ///      empty error from inside the PoolManager, which is a genuinely awful
    ///      thing to debug. Stray ETH is inert here: the curve prices off
    ///      `ethReserve`, not this contract's balance.
    receive() external payable {}

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "eth transfer");
    }
}

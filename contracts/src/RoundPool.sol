// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArenaToken} from "./ArenaToken.sol";

/// @title RoundPool — the round's constant-product market + resolution rules
/// @notice Trust properties (spec §13), enforced by construction:
///         - There is NO function that withdraws pool liquidity to anyone.
///           ETH only leaves along the curve (sell), via uniform redemption
///           after a non-graduated round, or as the published fee stream.
///         - resolve() is permissionless: once the end condition holds,
///           anyone can trigger it. Graduation criteria are immutable and
///           measured entirely on-chain (reserves, cumulative volume, the
///           token's holder count).
///         - Graduated pools simply keep trading forever ("Arena Alumni") —
///           there is no migration key because there is nothing to migrate
///           away from and nobody who could hold such a key.
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
        uint256 graduationMinHolders_
    ) {
        require(tradeFeeBps_ < BPS, "fee");
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

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "eth transfer");
    }
}

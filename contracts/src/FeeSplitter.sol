// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FeeSplitter — immutable two-way split of graduated-pool trading fees
/// @notice Sits behind the LP locker as its `feeRecipient`. The locker can only
///         ever collect fees and forward them to one address, so this is how a
///         graduated coin pays both its creator and the protocol.
///
///         Trust properties, enforced by construction:
///         - Both recipients and the split are immutable. There is no owner, no
///           setter, no upgrade path, and no way to execute arbitrary calls.
///         - Accounting is pull-based (the PaymentSplitter pattern): each party
///           withdraws its own share. A recipient that reverts on receive can
///           strand only its own money, never the other party's. A push-both
///           design would let one bad creator address brick protocol fees, and
///           the creator address is arbitrary user input.
///         - Fees arrive as BOTH pool currencies — native ETH and the round
///           token — because the locker closes its deltas with TAKE_PAIR. Each
///           currency is accounted separately.
contract FeeSplitter {
    uint256 private constant BPS = 10_000;

    /// @notice The coin creator's destination, chosen at launch. Immutable.
    address public immutable creator;
    /// @notice The protocol treasury. Immutable.
    address public immutable protocol;
    /// @notice The protocol's share in basis points; the creator takes the rest.
    uint16 public immutable protocolBps;

    /// @notice ETH already withdrawn, per account and in total.
    mapping(address => uint256) public releasedEth;
    uint256 public totalReleasedEth;
    /// @notice ERC20 already withdrawn, per token per account and in total.
    mapping(address => mapping(address => uint256)) public releasedToken;
    mapping(address => uint256) public totalReleasedToken;

    event EthReleased(address indexed to, uint256 amount);
    event TokenReleased(address indexed token, address indexed to, uint256 amount);

    error NotARecipient();
    error NothingOwed();
    error BadRecipient();
    error BadSplit();
    error TransferFailed();

    constructor(address creator_, address protocol_, uint16 protocolBps_) {
        // A zero address here would burn that side's fees forever, and nothing
        // downstream can correct it: every field on this contract is immutable.
        if (creator_ == address(0) || protocol_ == address(0)) revert BadRecipient();
        if (protocolBps_ > BPS) revert BadSplit();
        creator = creator_;
        protocol = protocol_;
        protocolBps = protocolBps_;
    }

    /// @notice This account's share of `total` lifetime fees, in bps terms.
    function shareOf(address account, uint256 total) public view returns (uint256) {
        if (account == protocol) return (total * protocolBps) / BPS;
        if (account == creator) return total - (total * protocolBps) / BPS;
        revert NotARecipient();
    }

    /// @notice ETH this account can withdraw right now.
    function pendingEth(address account) public view returns (uint256) {
        uint256 lifetime = address(this).balance + totalReleasedEth;
        return shareOf(account, lifetime) - releasedEth[account];
    }

    /// @notice ERC20 this account can withdraw right now.
    function pendingToken(address token, address account) public view returns (uint256) {
        uint256 lifetime = _balanceOf(token, address(this)) + totalReleasedToken[token];
        return shareOf(account, lifetime) - releasedToken[token][account];
    }

    /// @notice Withdraw `account`'s ETH. Permissionless: anyone may trigger a
    ///         payout, but it can only ever go to that account's own address.
    function releaseEth(address account) external {
        uint256 amount = pendingEth(account);
        if (amount == 0) revert NothingOwed();
        releasedEth[account] += amount;
        totalReleasedEth += amount;
        (bool ok, ) = account.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit EthReleased(account, amount);
    }

    /// @notice Withdraw `account`'s balance of one ERC20 (the round token).
    function releaseToken(address token, address account) external {
        uint256 amount = pendingToken(token, account);
        if (amount == 0) revert NothingOwed();
        releasedToken[token][account] += amount;
        totalReleasedToken[token] += amount;
        _transfer(token, account, amount);
        emit TokenReleased(token, account, amount);
    }

    function _balanceOf(address token, address who) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, who) // balanceOf(address)
        );
        if (!ok || data.length < 32) revert TransferFailed();
        return abi.decode(data, (uint256));
    }

    function _transfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer(address,uint256)
        );
        // Tolerate the non-standard tokens that return nothing on success.
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    /// @notice Fees arrive here from the LP locker.
    receive() external payable {}
}

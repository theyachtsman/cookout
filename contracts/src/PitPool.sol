// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PitPool — escrow and pari-mutuel payout for one Pit match
/// @notice Pit matches are simulated: nothing about them happens on-chain, so
///         unlike a launchpad round there is no reserve, volume or holder count
///         a contract could read to decide who won. The outcome has to be told
///         to this contract by the platform.
///
///         That makes the platform an oracle, which is a privileged role the
///         rest of this system deliberately does not have. This contract exists
///         to bound that role as tightly as the situation allows:
///
///         - **The pot can never reach the operator.** Fees are capped at
///           construction and paid to addresses fixed at construction. There is
///           no function that sends staked principal anywhere but to players.
///         - **The oracle can only pick a winner, never an amount.** Payouts are
///           computed here from the stakes, pro-rata. Posting an outcome does
///           not let anyone choose who gets how much.
///         - **Refusing to resolve is not a way to keep the money.** After
///           `refundAfter`, anyone can open refunds and every player reclaims
///           their own stake in full, fees included. A silent or hostile
///           operator can delay payment; it cannot take it.
///         - **Resolution happens once.** No re-resolving after seeing claims.
///
///         What this cannot fix: a dishonest outcome. If the platform posts the
///         wrong winner, the wrong people get paid. That risk is inherent to
///         settling a simulated match with real money, and it should be
///         described honestly rather than papered over.
contract PitPool {
    uint256 private constant BPS = 10_000;
    /// @notice Ceiling on the house's cut, enforced at construction. Without
    ///         it a pool could be deployed that returns almost nothing.
    uint16 public constant MAX_FEE_BPS = 1_000;

    /// @notice The three calls a player can back. NONE means "not resolved".
    enum Call {
        NONE,
        GRADUATE,
        RUG,
        TIMER
    }

    /// @notice Who may post the outcome. Immutable — an oracle that can be
    ///         reassigned is an oracle with an extra attack surface.
    address public immutable resolver;
    /// @notice Where the house cut goes. Immutable, and never the resolver's
    ///         choice at payout time.
    address public immutable feeRecipient;
    uint16 public immutable feeBps;
    /// @notice Staking closes here; resolution cannot happen before it.
    uint64 public immutable closesAt;
    /// @notice Staking is shut early once the match actually starts. A Pit
    ///         lobby closes when it fills, which nobody can know at deploy
    ///         time — `closesAt` is only the deadline by which it must have
    ///         happened. Without this the pool either takes bets after the
    ///         match began, or refuses resolution of a match that finished
    ///         before the deadline. One-way, and strictly less power than
    ///         naming the outcome, which the resolver already has.
    bool public stakingClosed;
    /// @notice After this, anyone may open refunds. The bound on the oracle.
    uint64 public immutable refundAfter;

    Call public outcome;
    bool public resolved;
    bool public refunding;
    /// @notice Pot after fees, fixed at resolution so claims cannot race it.
    uint256 public payoutPot;
    uint256 public winningStake;

    mapping(address => mapping(Call => uint256)) public stakeOf;
    mapping(Call => uint256) public totalOn;
    mapping(address => bool) public claimed;
    uint256 public totalStaked;

    event Staked(address indexed who, Call indexed call, uint256 amount);
    event Resolved(Call indexed outcome, uint256 payoutPot, uint256 winningStake, uint256 fee);
    event Claimed(address indexed who, uint256 amount);
    event Unstaked(address indexed who, uint256 amount);
    event RefundsOpened(uint64 at);
    event Refunded(address indexed who, uint256 amount);

    error NotResolver();
    error StakingOpen();
    error BadCall();
    error Closed();
    error NotClosed();
    error AlreadyResolved();
    error NotResolvedYet();
    error AlreadyClaimed();
    error NothingToClaim();
    error TooEarly();
    error Refunding();
    error BadConfig();
    error TransferFailed();

    bool private locked;
    modifier nonReentrant() {
        if (locked) revert TransferFailed();
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address resolver_,
        address feeRecipient_,
        uint16 feeBps_,
        uint64 closesAt_,
        uint64 refundAfter_
    ) {
        if (resolver_ == address(0) || feeRecipient_ == address(0)) revert BadConfig();
        if (feeBps_ > MAX_FEE_BPS) revert BadConfig();
        // The refund window must actually open after staking closes, or the
        // protection is decorative.
        if (refundAfter_ <= closesAt_) revert BadConfig();
        resolver = resolver_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        closesAt = closesAt_;
        refundAfter = refundAfter_;
    }

    /// @notice Back a call with ETH. Staking again on the same call adds to it.
    function stake(Call call) external payable {
        if (call == Call.NONE) revert BadCall();
        if (stakingClosed || block.timestamp >= closesAt) revert Closed();
        if (msg.value == 0) revert BadCall();
        stakeOf[msg.sender][call] += msg.value;
        totalOn[call] += msg.value;
        totalStaked += msg.value;
        emit Staked(msg.sender, call, msg.value);
    }

    /**
     * @notice Post the match outcome and fix the payout.
     *
     * The only thing the resolver supplies is which call won. Everything paid
     * out is derived here from stakes already on-chain, so this cannot be used
     * to direct money at a chosen address.
     */
    function resolve(Call result) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        if (result == Call.NONE) revert BadCall();
        if (!stakingClosed && block.timestamp < closesAt) revert NotClosed();
        if (resolved) revert AlreadyResolved();
        if (refunding) revert Refunding();
        resolved = true;
        outcome = result;

        uint256 won = totalOn[result];
        winningStake = won;
        // Nobody backed the winner: everyone gets their stake back rather than
        // the house keeping a pot it did not win.
        if (won == 0) {
            refunding = true;
            emit RefundsOpened(uint64(block.timestamp));
            return;
        }
        uint256 fee = (totalStaked * feeBps) / BPS;
        payoutPot = totalStaked - fee;
        if (fee > 0) _pay(feeRecipient, fee);
        emit Resolved(result, payoutPot, won, fee);
    }

    /// @notice Claim a winning share: your stake's fraction of the whole pot.
    function claim() external nonReentrant {
        if (refunding) revert Refunding();
        if (!resolved) revert NotResolvedYet();
        if (claimed[msg.sender]) revert AlreadyClaimed();
        uint256 mine = stakeOf[msg.sender][outcome];
        if (mine == 0) revert NothingToClaim();
        claimed[msg.sender] = true;
        uint256 amount = (payoutPot * mine) / winningStake;
        _pay(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /**
     * @notice Take a stake back before the match starts.
     *
     * The paper Pit lets a player pull a bet while the lobby is still open, so
     * this one does too — otherwise the UI offers a withdrawal the chain
     * silently refuses, the money stays escrowed, and re-entering fails
     * because the contract still has their old stake. Safe by timing: nothing
     * is known about the outcome yet, so leaving costs nobody anything.
     */
    function unstake() external nonReentrant {
        if (stakingClosed || block.timestamp >= closesAt) revert Closed();
        uint256 total;
        for (uint8 c = 1; c <= 3; c++) {
            uint256 mine = stakeOf[msg.sender][Call(c)];
            if (mine == 0) continue;
            stakeOf[msg.sender][Call(c)] = 0;
            totalOn[Call(c)] -= mine;
            total += mine;
        }
        if (total == 0) revert NothingToClaim();
        totalStaked -= total;
        _pay(msg.sender, total);
        emit Unstaked(msg.sender, total);
    }

    /// @notice Shut staking because the match has started. Resolver-only and
    ///         one-way: it cannot be reopened, and it cannot be used to keep
    ///         anyone's money — every path out of this contract is unchanged.
    function closeStaking() external {
        if (msg.sender != resolver) revert NotResolver();
        stakingClosed = true;
    }

    /**
     * @notice Open refunds because the match was never resolved.
     *
     * Permissionless and time-gated: this is what stops "never resolve" from
     * being a way to keep the pot. Anyone can call it once the window passes,
     * so it does not depend on the operator being alive or willing.
     */
    function openRefunds() external {
        if (resolved) revert AlreadyResolved();
        if (refunding) revert Refunding();
        if (block.timestamp < refundAfter) revert TooEarly();
        refunding = true;
        emit RefundsOpened(uint64(block.timestamp));
    }

    /// @notice Take your stake back, in full and fee-free, when refunding.
    function refund() external nonReentrant {
        if (!refunding) revert NotResolvedYet();
        if (claimed[msg.sender]) revert AlreadyClaimed();
        uint256 total = stakeOf[msg.sender][Call.GRADUATE] +
            stakeOf[msg.sender][Call.RUG] +
            stakeOf[msg.sender][Call.TIMER];
        if (total == 0) revert NothingToClaim();
        claimed[msg.sender] = true;
        _pay(msg.sender, total);
        emit Refunded(msg.sender, total);
    }

    /// @notice What `who` would receive right now, for the UI to show honestly.
    function pending(address who) external view returns (uint256) {
        if (claimed[who]) return 0;
        if (refunding)
            return
                stakeOf[who][Call.GRADUATE] + stakeOf[who][Call.RUG] + stakeOf[who][Call.TIMER];
        if (!resolved || winningStake == 0) return 0;
        return (payoutPot * stakeOf[who][outcome]) / winningStake;
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

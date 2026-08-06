// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PitBattlePool — winner-take-all buy-in pot for Battle the Goon Squad
/// @notice Every real player pays the same fixed entry; whoever finishes with
///         the highest PnL takes the pot. The match is simulated, so — exactly
///         as with PitPool — the platform has to name the winner, and this
///         contract's job is bounding what naming a winner can do.
///
///         The entry is a single immutable amount rather than a player-chosen
///         buy-in, and that is a fairness rule, not a convenience. With free
///         choice, someone entering for a tenth of what everyone else risked
///         still takes the whole pot on a win — the small entrant gets the same
///         upside for a fraction of the downside. A fixed entry per difficulty
///         tier means everyone in a given battle risked exactly the same thing,
///         so the pot is always entrants x entryFee and winning it is the same
///         bet for all of them.
///
///         Bounds that hold:
///         - **The winner must have bought in.** The resolver cannot name an
///           address that never entered, which is the difference between
///           picking a winner and inventing one. This is the important one: a
///           winner-take-all pot resolved by an oracle is otherwise a single
///           address away from being drained to anywhere.
///         - **The pot cannot reach the operator.** Fees are capped at
///           construction and paid to a fixed address; nothing else leaves
///           except to the named winner.
///         - **The amount is not the oracle's to choose.** It is the pot,
///           minus the fee fixed at construction.
///         - **Never resolving is not a way to keep the money.** After
///           `refundAfter` anyone can open refunds and every entrant takes
///           their buy-in back, fee-free.
///         - **Resolution happens once.**
///
///         Bound that does not hold, stated plainly: winner-take-all is more
///         abusable by a dishonest oracle than a pari-mutuel pool. There, a
///         false outcome still has to pay whoever happened to back it; here,
///         naming one entrant hands them everything. An operator willing to
///         enter its own wallet and name it takes the pot. Nothing on-chain
///         can prevent that while the result comes from a simulation — it is
///         a reason to publish entries and results, not a solved problem.
contract PitBattlePool {
    uint256 private constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000;

    /// @notice Who names the winner. Immutable.
    address public immutable resolver;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;
    /// @notice What it costs to enter, exactly. Set from the match's difficulty
    ///         tier at deployment and never negotiable — see the header.
    uint256 public immutable entryFee;
    /// @notice Buy-ins close here; the winner cannot be named before it.
    uint64 public immutable closesAt;
    /// @notice Staking is shut early once the match actually starts. A Pit
    ///         lobby closes when it fills, which nobody can know at deploy
    ///         time — `closesAt` is only the deadline by which it must have
    ///         happened. Without this the pool either takes bets after the
    ///         match began, or refuses resolution of a match that finished
    ///         before the deadline. One-way, and strictly less power than
    ///         naming the outcome, which the resolver already has.
    bool public stakingClosed;
    /// @notice After this, anyone may open refunds.
    uint64 public immutable refundAfter;

    address public winner;
    bool public resolved;
    bool public refunding;
    bool public paid;
    uint256 public pot;

    mapping(address => uint256) public buyIn;
    mapping(address => bool) public refunded;
    uint256 public entrants;

    event Entered(address indexed who, uint256 amount, uint256 pot);
    event Resolved(address indexed winner, uint256 prize, uint256 fee);
    event Claimed(address indexed winner, uint256 amount);
    event Exited(address indexed who, uint256 amount);
    event RefundsOpened(uint64 at);
    event Refunded(address indexed who, uint256 amount);

    error NotResolver();
    error StakingOpen();
    error Closed();
    error NotClosed();
    error AlreadyResolved();
    error NotResolvedYet();
    error NotTheWinner();
    error AlreadyPaid();
    error NotAnEntrant();
    error WrongEntryFee();
    error AlreadyEntered();
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
        uint256 entryFee_,
        uint64 closesAt_,
        uint64 refundAfter_
    ) {
        if (resolver_ == address(0) || feeRecipient_ == address(0)) revert BadConfig();
        if (feeBps_ > MAX_FEE_BPS) revert BadConfig();
        if (entryFee_ == 0) revert BadConfig();
        if (refundAfter_ <= closesAt_) revert BadConfig();
        entryFee = entryFee_;
        resolver = resolver_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        closesAt = closesAt_;
        refundAfter = refundAfter_;
    }

    /// @notice Enter the battle, for exactly the entry fee.
    /// @dev Rejects both under- and overpayment rather than refunding change:
    ///      an entry that quietly cost more than the tier advertised would
    ///      break the very property the fixed fee exists to guarantee. One
    ///      entry per address, since a second buys no extra claim on a prize
    ///      decided by PnL — it would only be a donation to the winner.
    function enter() external payable {
        if (stakingClosed || block.timestamp >= closesAt) revert Closed();
        if (msg.value != entryFee) revert WrongEntryFee();
        if (buyIn[msg.sender] != 0) revert AlreadyEntered();
        buyIn[msg.sender] = msg.value;
        entrants += 1;
        pot += msg.value;
        emit Entered(msg.sender, msg.value, pot);
    }

    /**
     * @notice Name the player who finished with the highest PnL.
     *
     * The winner must be someone who actually bought in. That check is the
     * whole reason this is a bounded oracle rather than a withdrawal function
     * with extra steps.
     */
    function resolve(address winner_) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        if (!stakingClosed && block.timestamp < closesAt) revert NotClosed();
        if (resolved) revert AlreadyResolved();
        if (refunding) revert Refunding();
        if (buyIn[winner_] == 0) revert NotAnEntrant();
        resolved = true;
        winner = winner_;

        uint256 fee = (pot * feeBps) / BPS;
        if (fee > 0) _pay(feeRecipient, fee);
        emit Resolved(winner_, pot - fee, fee);
    }

    /// @notice The winner takes the pot. Pull-based: a winner whose address
    ///         reverts strands only their own prize, and cannot wedge anything.
    function claim() external nonReentrant {
        if (refunding) revert Refunding();
        if (!resolved) revert NotResolvedYet();
        if (msg.sender != winner) revert NotTheWinner();
        if (paid) revert AlreadyPaid();
        paid = true;
        uint256 amount = pot - (pot * feeBps) / BPS;
        _pay(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /**
     * @notice Leave before the match starts and take the entry back.
     *
     * Without this, "withdraw" in the UI cleared the entry while the contract
     * kept the money — and the next attempt to enter reverted, because from
     * the pool's point of view they had never left.
     */
    function exit() external nonReentrant {
        if (stakingClosed || block.timestamp >= closesAt) revert Closed();
        uint256 mine = buyIn[msg.sender];
        if (mine == 0) revert NotAnEntrant();
        buyIn[msg.sender] = 0;
        entrants -= 1;
        pot -= mine;
        _pay(msg.sender, mine);
        emit Exited(msg.sender, mine);
    }

    /// @notice Shut staking because the match has started. Resolver-only and
    ///         one-way: it cannot be reopened, and it cannot be used to keep
    ///         anyone's money — every path out of this contract is unchanged.
    function closeStaking() external {
        if (msg.sender != resolver) revert NotResolver();
        stakingClosed = true;
    }

    /// @notice Open refunds because the battle was never resolved.
    ///         Permissionless once the window passes.
    function openRefunds() external {
        if (resolved) revert AlreadyResolved();
        if (refunding) revert Refunding();
        if (block.timestamp < refundAfter) revert TooEarly();
        refunding = true;
        emit RefundsOpened(uint64(block.timestamp));
    }

    /// @notice Take your buy-in back, in full, when refunding.
    function refund() external nonReentrant {
        if (!refunding) revert NotResolvedYet();
        if (refunded[msg.sender]) revert AlreadyPaid();
        uint256 mine = buyIn[msg.sender];
        if (mine == 0) revert NothingToClaim();
        refunded[msg.sender] = true;
        _pay(msg.sender, mine);
        emit Refunded(msg.sender, mine);
    }

    /// @notice What `who` can take right now, so the UI never overpromises.
    function pending(address who) external view returns (uint256) {
        if (refunding) return refunded[who] ? 0 : buyIn[who];
        if (!resolved || who != winner || paid) return 0;
        return pot - (pot * feeBps) / BPS;
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

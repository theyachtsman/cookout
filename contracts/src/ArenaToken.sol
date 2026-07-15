// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArenaToken — platform-audited round token template
/// @notice Every Cookout round token deploys from this exact bytecode via the
///         RoundFactory. Creators supply metadata only. There is no owner, no
///         mint, no pause, no blacklist; the full fixed supply is minted at
///         construction and never changes. The token also maintains an
///         on-chain holder count so graduation criteria are verifiable
///         without an indexer.
contract ArenaToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    /// @notice Number of nonzero-balance addresses (graduation criterion).
    uint256 public holderCount;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient) {
        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        balanceOf[recipient] = supply_;
        holderCount = 1;
        emit Transfer(address(0), recipient, supply_);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        return _transfer(from, to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "zero recipient");
        uint256 fromBal = balanceOf[from];
        require(fromBal >= value, "balance");
        unchecked {
            balanceOf[from] = fromBal - value;
        }
        uint256 toBalBefore = balanceOf[to];
        balanceOf[to] = toBalBefore + value;
        if (value > 0 && from != to) {
            if (balanceOf[from] == 0) holderCount--;
            if (toBalBefore == 0) holderCount++;
        }
        emit Transfer(from, to, value);
        return true;
    }
}

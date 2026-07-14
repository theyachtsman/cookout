// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArenaToken — platform-audited round token template (DRAFT, UNAUDITED)
/// @notice Every Cookout round token deploys from this exact bytecode. Creators
///         supply metadata only (name/symbol); there is no owner, no mint, no
///         pause, no blacklist, and the full fixed supply is minted at
///         construction to the round's BatchAuction + liquidity contracts.
contract ArenaToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @param auction   round BatchAuction (receives the auction allocation)
    /// @param liquidity round liquidity manager (receives the pool allocation)
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        address auction,
        uint256 auctionAllocation,
        address liquidity
    ) {
        require(auctionAllocation <= supply_, "alloc>supply");
        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        balanceOf[auction] = auctionAllocation;
        balanceOf[liquidity] = supply_ - auctionAllocation;
        emit Transfer(address(0), auction, auctionAllocation);
        emit Transfer(address(0), liquidity, supply_ - auctionAllocation);
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
        require(balanceOf[from] >= value, "balance");
        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
